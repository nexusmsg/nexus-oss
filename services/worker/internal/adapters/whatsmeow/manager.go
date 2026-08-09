package whatsmeow

import (
	"context"
	"fmt"
	"log"
	"sync"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// EventHandlerFactory builds a per-device inbound event handler. It mirrors
// the whatsapp handler constructor's inputs and returns its Handle method
// value, which the manager registers on the whatsmeow client. The composition
// root injects it so this adapter never constructs handlers-layer types.
type EventHandlerFactory func(messageService ports.MessageService, businessAccountID, phoneNumberID, displayPhone string, logger *log.Logger) func(ctx context.Context) func(evt any)

// DeviceManager provisions and drives per-device lifecycle. It routes lifecycle
// commands directly to per-device actor goroutines, replacing the static
// env-driven registry with dynamic sessions-table provisioning.
type DeviceManager struct {
	mu      sync.RWMutex
	devices map[string]*deviceRef
	// numbers is a number -> phoneNumberID reverse index guarding against two
	// clients on the same store device.
	numbers map[string]string

	container      *sqlstore.Container
	messageService ports.MessageService
	sessionStore   ports.SessionStore
	fallbackBAID   string
	handlerFactory EventHandlerFactory
	logger         *log.Logger
}

var _ ports.DeviceManager = (*DeviceManager)(nil)
var _ ports.OutboundSenderProvider = (*DeviceManager)(nil)

// NewDeviceManager builds a manager. Every mutation is serialized by the
// manager's mutex, so no manager goroutine is needed. sessionStore records
// lifecycle status transitions; it may be nil, in which case status recording
// is skipped.
func NewDeviceManager(container *sqlstore.Container, messageService ports.MessageService, sessionStore ports.SessionStore, fallbackBusinessAccountID string, handlerFactory EventHandlerFactory, logger *log.Logger) *DeviceManager {
	if logger == nil {
		logger = log.Default()
	}
	return &DeviceManager{
		devices:        make(map[string]*deviceRef),
		numbers:        make(map[string]string),
		container:      container,
		messageService: messageService,
		sessionStore:   sessionStore,
		fallbackBAID:   fallbackBusinessAccountID,
		handlerFactory: handlerFactory,
		logger:         logger,
	}
}

// EnsureDevice provisions a device for the session. It is idempotent and
// auto-connects devices that already have a stored session. All mutation runs
// synchronously under the manager lock.
func (m *DeviceManager) EnsureDevice(ctx context.Context, session entity.Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.devices[session.PhoneNumberID]; ok {
		return nil // idempotent no-op
	}
	if other, ok := m.numbers[session.Number]; ok && other != session.PhoneNumberID {
		return fmt.Errorf("whatsmeow: number %s already registered to phone number id %s", session.Number, other)
	}
	device, err := resolveDevice(ctx, m.container, session.Number)
	if err != nil {
		return fmt.Errorf("whatsmeow: resolve device for %s: %w", session.Number, err)
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

	ref := newDeviceRef(client, session.PhoneNumberID, m.removeDevice)
	if m.handlerFactory == nil {
		return fmt.Errorf("whatsmeow: handler factory is nil")
	}
	handler := m.handlerFactory(m.messageService, baid, session.PhoneNumberID, displayPhone, m.logger)
	client.AddEventHandler(handler(ref.ctx))
	client.AddEventHandler(m.lifecycleHandler(ref))
	client.AddEventHandler(m.disconnectedHandler(ref))

	m.devices[session.PhoneNumberID] = ref
	m.numbers[session.Number] = session.PhoneNumberID
	go ref.run()

	if client.hasSession() {
		ref.connectPending.Store(true)
		ref.wakeup()
	}
	return nil
}

// Pair generates a QR code for the given phone number ID.
func (m *DeviceManager) Pair(ctx context.Context, phoneNumberID string) (string, error) {
	ref, ok := m.lookup(phoneNumberID)
	if !ok {
		return "", &ports.ErrSenderNotFound{PhoneNumberID: phoneNumberID}
	}
	resp := make(chan lifecycleResponse, 1)
	select {
	case ref.lifecycle <- lifecycleCmd{kind: cmdPair, ctx: ctx, resp: resp}:
	case <-ref.ctx.Done():
		return "", &ports.ErrSenderNotFound{PhoneNumberID: phoneNumberID}
	}
	select {
	case r := <-resp:
		return r.qr, r.err
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// Logout removes the device on successful logout.
func (m *DeviceManager) Logout(ctx context.Context, phoneNumberID string) error {
	ref, ok := m.lookup(phoneNumberID)
	if !ok {
		return &ports.ErrSenderNotFound{PhoneNumberID: phoneNumberID}
	}
	resp := make(chan lifecycleResponse, 1)
	select {
	case ref.lifecycle <- lifecycleCmd{kind: cmdLogout, ctx: ctx, resp: resp}:
	case <-ref.ctx.Done():
		return &ports.ErrSenderNotFound{PhoneNumberID: phoneNumberID}
	}
	select {
	case r := <-resp:
		return r.err
	case <-ctx.Done():
		return ctx.Err()
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

// Shutdown cancels every actor, waits for them to exit, and disconnects each
// device.
func (m *DeviceManager) Shutdown(ctx context.Context) error {
	for _, ref := range m.refsSnapshot() {
		ref.cancelPair()
		ref.cancel()
		<-ref.done
		ref.client.Disconnect()
	}
	return nil
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

// lifecycleHandler records session status transitions from whatsmeow lifecycle
// events. It must not block: whatsmeow dispatches it on a goroutine.
func (m *DeviceManager) lifecycleHandler(ref *deviceRef) func(any) {
	return func(evt any) {
		switch e := evt.(type) {
		case *events.PairSuccess:
			// The QR code was scanned and the handshake completed: the device
			// is now a real linked device.
			m.markConnected(ref, e.ID.String())
		case *events.Connected:
			// The QR-phase websocket connects before the device has a stored
			// session; only an authenticated device (Store.ID set) is really
			// connected, so boot reconnects and post-pair connects count,
			// plain QR websockets do not.
			if !ref.client.hasSession() {
				return
			}
			whatsappID := ""
			if id := ref.client.client.Store.ID; id != nil {
				whatsappID = id.String()
			}
			m.markConnected(ref, whatsappID)
		case *events.Disconnected:
			m.markDisconnected(ref)
		case *events.LoggedOut:
			m.markLoggedOut(ref)
		}
	}
}

// markConnected records the session as connected. It runs on whatsmeow's event
// goroutine and never blocks on anything but the session store write.
func (m *DeviceManager) markConnected(ref *deviceRef, whatsappID string) {
	if m.sessionStore == nil {
		return
	}
	if err := m.sessionStore.MarkConnected(context.Background(), ref.phoneNumberID, whatsappID); err != nil {
		m.logger.Printf("whatsmeow: mark device %s connected: %v", ref.phoneNumberID, err)
	}
}

// markDisconnected records the session as disconnected, but only when it was
// connected: a terminal state (logged_out) or a pairing/created state must not
// be clobbered by the socket close that follows a logout or failed pairing.
func (m *DeviceManager) markDisconnected(ref *deviceRef) {
	if m.sessionStore == nil {
		return
	}
	ctx := context.Background()
	session, err := m.sessionStore.GetByPhoneNumberID(ctx, ref.phoneNumberID)
	if err != nil {
		m.logger.Printf("whatsmeow: load session %s on disconnect: %v", ref.phoneNumberID, err)
		return
	}
	if session == nil || session.Status != entity.SessionStatusConnected {
		return
	}
	if err := m.sessionStore.UpdateStatus(ctx, ref.phoneNumberID, entity.SessionStatusDisconnected); err != nil {
		m.logger.Printf("whatsmeow: mark device %s disconnected: %v", ref.phoneNumberID, err)
	}
}

// markLoggedOut records that the device was unpaired remotely (from the phone).
// Client-initiated logouts are recorded by the executor instead.
func (m *DeviceManager) markLoggedOut(ref *deviceRef) {
	if m.sessionStore == nil {
		return
	}
	if err := m.sessionStore.UpdateStatus(context.Background(), ref.phoneNumberID, entity.SessionStatusLoggedOut); err != nil {
		m.logger.Printf("whatsmeow: mark device %s logged out: %v", ref.phoneNumberID, err)
	}
	m.logger.Printf("whatsmeow: device %s logged out remotely", ref.phoneNumberID)
}

// removeDevice removes a device and its reverse index entry. It is called by
// the actor (via the onRemoved callback) after a successful logout, so no
// manager lock is held when it runs.
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
