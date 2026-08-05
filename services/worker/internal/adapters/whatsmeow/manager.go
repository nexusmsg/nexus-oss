package whatsmeow

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// mgrCommandKind enumerates the commands the manager loop processes.
type mgrCommandKind int

const (
	mgrEnsureDevice mgrCommandKind = iota
	mgrPair
	mgrLogout
	mgrRemoveDevice
)

// mgrCommand is one command routed to the manager goroutine. Commands that
// need a result carry a response channel; the caller waits on it, never the
// manager loop.
type mgrCommand struct {
	kind          mgrCommandKind
	session       domain.Session
	phoneNumberID string
	ctx           context.Context
	resp          chan lifecycleResponse
}

// DeviceManager provisions and drives per-device lifecycle. One manager
// goroutine routes lifecycle commands to per-device actor goroutines, replacing
// the static env-driven registry with dynamic sessions-table provisioning.
type DeviceManager struct {
	mu      sync.RWMutex
	devices map[string]*deviceRef
	// numbers is a number -> phoneNumberID reverse index guarding against two
	// clients on the same store device.
	numbers map[string]string

	container      *sqlstore.Container
	messageService ports.MessageService
	fallbackBAID   string
	logger         *log.Logger

	cmds     chan mgrCommand
	loopDone chan struct{}
	ctx      context.Context
	cancel   context.CancelFunc
}

var _ ports.DeviceManager = (*DeviceManager)(nil)
var _ ports.OutboundSenderProvider = (*DeviceManager)(nil)

// NewDeviceManager starts the manager goroutine.
func NewDeviceManager(container *sqlstore.Container, messageService ports.MessageService, fallbackBusinessAccountID string, logger *log.Logger) *DeviceManager {
	if logger == nil {
		logger = log.Default()
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &DeviceManager{
		devices:        make(map[string]*deviceRef),
		numbers:        make(map[string]string),
		container:      container,
		messageService: messageService,
		fallbackBAID:   fallbackBusinessAccountID,
		logger:         logger,
		cmds:           make(chan mgrCommand),
		loopDone:       make(chan struct{}),
		ctx:            ctx,
		cancel:         cancel,
	}
}

// run is the manager goroutine. It processes commands one at a time and never
// waits on an actor response.
func (m *DeviceManager) run() {
	defer close(m.loopDone)
	for {
		select {
		case <-m.ctx.Done():
			return
		case cmd := <-m.cmds:
			switch cmd.kind {
			case mgrEnsureDevice:
				m.handleEnsure(cmd)
			case mgrPair:
				m.handlePair(cmd)
			case mgrLogout:
				m.handleLogout(cmd)
			case mgrRemoveDevice:
				m.removeDevice(cmd.phoneNumberID)
			}
		}
	}
}

// EnsureDevice provisions a device for the session. It is idempotent and
// auto-connects devices that already have a stored session.
func (m *DeviceManager) EnsureDevice(ctx context.Context, session domain.Session) error {
	resp := make(chan lifecycleResponse, 1)
	if err := m.send(mgrCommand{kind: mgrEnsureDevice, session: session, resp: resp}, ctx); err != nil {
		return err
	}
	return m.wait(resp, ctx).err
}

// handleEnsure provisions a device inside the manager loop. The idempotency
// and duplicate-number checks live here so they are serialized.
func (m *DeviceManager) handleEnsure(cmd mgrCommand) {
	if cmd.resp == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	session := cmd.session
	if _, ok := m.devices[session.PhoneNumberID]; ok {
		cmd.resp <- lifecycleResponse{} // idempotent no-op
		return
	}
	if other, ok := m.numbers[session.Number]; ok && other != session.PhoneNumberID {
		cmd.resp <- lifecycleResponse{err: fmt.Errorf("whatsmeow: number %s already registered to phone number id %s", session.Number, other)}
		return
	}
	device, err := resolveDevice(m.ctx, m.container, session.Number)
	if err != nil {
		cmd.resp <- lifecycleResponse{err: fmt.Errorf("whatsmeow: resolve device for %s: %w", session.Number, err)}
		return
	}
	raw := whatsmeow.NewClient(device, waLog.Noop)
	// Reconnection is owned by the actor, so disable whatsmeow's built-in
	// reconnect to avoid duplicate loops.
	raw.EnableAutoReconnect = false
	client := newClient(raw, session.Number, m.logger)

	baid := session.BusinessAccountID
	if baid == "" {
		baid = m.fallbackBAID
	}
	displayPhone := session.DisplayPhone
	if displayPhone == "" {
		displayPhone = session.Number
	}

	ref := newDeviceRef(client, session.PhoneNumberID, m.ctx, m.cmds)
	handler := NewHandler(m.messageService, baid, session.PhoneNumberID, displayPhone, m.logger)
	client.AddEventHandler(handler.Handle(m.ctx))
	client.AddEventHandler(m.disconnectedHandler(ref))

	m.devices[session.PhoneNumberID] = ref
	m.numbers[session.Number] = session.PhoneNumberID
	go ref.run()

	if client.hasSession() {
		ref.connectPending.Store(true)
		ref.wakeup()
	}
	cmd.resp <- lifecycleResponse{}
}

// Pair generates a QR code for the given phone number ID.
func (m *DeviceManager) Pair(ctx context.Context, phoneNumberID string) (string, error) {
	resp := make(chan lifecycleResponse, 1)
	if err := m.send(mgrCommand{kind: mgrPair, phoneNumberID: phoneNumberID, ctx: ctx, resp: resp}, ctx); err != nil {
		return "", err
	}
	r := m.wait(resp, ctx)
	return r.qr, r.err
}

// handlePair forwards a pair command to the device actor.
func (m *DeviceManager) handlePair(cmd mgrCommand) {
	if cmd.resp == nil {
		return
	}
	ref, ok := m.lookup(cmd.phoneNumberID)
	if !ok {
		cmd.resp <- lifecycleResponse{err: &ports.ErrSenderNotFound{PhoneNumberID: cmd.phoneNumberID}}
		return
	}
	select {
	case ref.lifecycle <- lifecycleCmd{kind: cmdPair, ctx: cmd.ctx, resp: cmd.resp}:
	case <-ref.ctx.Done():
		cmd.resp <- lifecycleResponse{err: &ports.ErrSenderNotFound{PhoneNumberID: cmd.phoneNumberID}}
	}
}

// Logout removes the device on successful logout.
func (m *DeviceManager) Logout(ctx context.Context, phoneNumberID string) error {
	resp := make(chan lifecycleResponse, 1)
	if err := m.send(mgrCommand{kind: mgrLogout, phoneNumberID: phoneNumberID, ctx: ctx, resp: resp}, ctx); err != nil {
		return err
	}
	return m.wait(resp, ctx).err
}

// handleLogout forwards a logout command to the device actor.
func (m *DeviceManager) handleLogout(cmd mgrCommand) {
	if cmd.resp == nil {
		return
	}
	ref, ok := m.lookup(cmd.phoneNumberID)
	if !ok {
		cmd.resp <- lifecycleResponse{err: &ports.ErrSenderNotFound{PhoneNumberID: cmd.phoneNumberID}}
		return
	}
	select {
	case ref.lifecycle <- lifecycleCmd{kind: cmdLogout, ctx: cmd.ctx, resp: cmd.resp}:
	case <-ref.ctx.Done():
		cmd.resp <- lifecycleResponse{err: &ports.ErrSenderNotFound{PhoneNumberID: cmd.phoneNumberID}}
	}
}

// ConnectStored connects every device with a stored session. Connect outcomes
// are async and logged by the actor.
func (m *DeviceManager) ConnectStored(ctx context.Context) error {
	for _, ref := range m.refsSnapshot() {
		if !ref.client.hasSession() {
			m.logger.Printf("whatsmeow: device %s has no stored session; waiting for a pairing job", ref.number)
			continue
		}
		ref.connectPending.Store(true)
		ref.wakeup()
	}
	return nil
}

// ActiveDevices returns the provisioned phone number IDs.
func (m *DeviceManager) ActiveDevices() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ids := make([]string, 0, len(m.devices))
	for id := range m.devices {
		ids = append(ids, id)
	}
	return ids
}

// Sender returns the message sender for a phone number ID via a fast RLock map
// lookup, never a through-manager round trip.
func (m *DeviceManager) Sender(phoneNumberID string) (ports.MessageSender, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ref, ok := m.devices[phoneNumberID]
	if !ok {
		return nil, &ports.ErrSenderNotFound{PhoneNumberID: phoneNumberID}
	}
	return ref.client, nil
}

// Shutdown cancels the manager loop and every actor, disconnects each device,
// and waits for the actors to exit.
func (m *DeviceManager) Shutdown(ctx context.Context) error {
	m.cancel()
	for _, ref := range m.refsSnapshot() {
		ref.cancelPair()
		ref.client.Disconnect()
		<-ref.done
	}
	select {
	case <-m.loopDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// disconnectedHandler marks a device for reconnect after an unexpected
// disconnect. It must not block: whatsmeow dispatches it on a goroutine.
func (m *DeviceManager) disconnectedHandler(ref *deviceRef) func(any) {
	return func(evt any) {
		if _, ok := evt.(*events.Disconnected); !ok {
			return
		}
		m.logger.Printf("whatsmeow: device %s disconnected, reconnecting", ref.number)
		ref.connectPending.Store(true)
		ref.wakeup()
	}
}

// removeDevice removes a device and its reverse index entry. It is called by
// the manager loop, never by an actor.
func (m *DeviceManager) removeDevice(phoneNumberID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ref, ok := m.devices[phoneNumberID]
	if !ok {
		return
	}
	delete(m.devices, phoneNumberID)
	delete(m.numbers, ref.number)
}

// send routes a command to the manager loop.
func (m *DeviceManager) send(cmd mgrCommand, ctx context.Context) error {
	select {
	case m.cmds <- cmd:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-m.ctx.Done():
		return errors.New("whatsmeow: device manager is shut down")
	}
}

// wait blocks on a command response until it arrives or the caller's context
// or the manager shuts down.
func (m *DeviceManager) wait(resp chan lifecycleResponse, ctx context.Context) lifecycleResponse {
	select {
	case r := <-resp:
		return r
	case <-ctx.Done():
		return lifecycleResponse{err: ctx.Err()}
	case <-m.ctx.Done():
		return lifecycleResponse{err: errors.New("whatsmeow: device manager is shut down")}
	}
}

// lookup returns the device ref for a phone number ID.
func (m *DeviceManager) lookup(phoneNumberID string) (*deviceRef, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ref, ok := m.devices[phoneNumberID]
	return ref, ok
}

// refsSnapshot snapshots the registered device refs for stable iteration.
func (m *DeviceManager) refsSnapshot() []*deviceRef {
	m.mu.RLock()
	defer m.mu.RUnlock()
	refs := make([]*deviceRef, 0, len(m.devices))
	for _, ref := range m.devices {
		refs = append(refs, ref)
	}
	return refs
}

// resolveDevice returns the stored session for number, or a fresh unsaved
// device when no session exists yet. Stored sessions are matched by number so
// AD-JID device indices do not affect lookups.
func resolveDevice(ctx context.Context, container *sqlstore.Container, number string) (*store.Device, error) {
	devices, err := container.GetAllDevices(ctx)
	if err != nil {
		return nil, err
	}
	for _, device := range devices {
		if device.GetJID().User == number {
			return device, nil
		}
	}
	return container.NewDevice(), nil
}
