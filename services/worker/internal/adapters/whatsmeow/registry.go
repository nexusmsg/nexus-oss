package whatsmeow

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"

	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// DeviceSpec declares one WhatsApp device managed by the registry. DisplayPhone
// defaults to Number when empty.
type DeviceSpec struct {
	PhoneNumberID string
	Number        string
	DisplayPhone  string
}

// Registry manages one whatsmeow client per phone number ID. It owns the
// connection lifecycle of every device and satisfies the outbound sender
// provider contract.
type Registry struct {
	mu      sync.RWMutex
	clients map[string]*Client
	logger  *log.Logger
}

var _ ports.OutboundSenderProvider = (*Registry)(nil)
var _ ports.SessionRegistry = (*Registry)(nil)

// NewRegistry resolves or creates one device per spec and wires each into its
// own Client, handler, and reconnect loop. Any spec that fails to initialize
// aborts the whole boot.
func NewRegistry(ctx context.Context, container *sqlstore.Container, specs []DeviceSpec, messageService ports.MessageService, businessAccountID string, logger *log.Logger) (*Registry, error) {
	if container == nil {
		return nil, errors.New("whatsmeow: registry container is nil")
	}
	if logger == nil {
		logger = log.Default()
	}
	if err := validateSpecs(specs); err != nil {
		return nil, err
	}
	r := &Registry{
		clients: make(map[string]*Client, len(specs)),
		logger:  logger,
	}
	for _, spec := range specs {
		device, err := resolveDevice(ctx, container, spec.Number)
		if err != nil {
			return nil, fmt.Errorf("whatsmeow: resolve device for %s: %w", spec.Number, err)
		}
		raw := whatsmeow.NewClient(device, waLog.Noop)
		// Reconnection is owned by the registry's Disconnected handler below,
		// so disable whatsmeow's built-in reconnect to avoid duplicate loops.
		raw.EnableAutoReconnect = false
		client := newClient(raw, spec.Number, logger)
		r.clients[spec.PhoneNumberID] = client

		displayPhone := spec.DisplayPhone
		if displayPhone == "" {
			displayPhone = spec.Number
		}
		handler := NewHandler(messageService, businessAccountID, spec.PhoneNumberID, displayPhone, logger)
		client.AddEventHandler(handler.Handle(ctx))
		client.AddEventHandler(r.reconnectHandler(ctx, client))
	}
	return r, nil
}

// Sender returns the message sender registered for phoneNumberID.
func (r *Registry) Sender(phoneNumberID string) (ports.MessageSender, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	client, ok := r.clients[phoneNumberID]
	if !ok {
		return nil, &ports.ErrSenderNotFound{PhoneNumberID: phoneNumberID}
	}
	return client, nil
}

// Pair generates a QR code for the given phone number via its client.
func (r *Registry) Pair(ctx context.Context, phoneNumberID string) (string, error) {
	client, err := r.client(phoneNumberID)
	if err != nil {
		return "", err
	}
	return client.Pair(ctx)
}

// Logout disconnects the device for the given phone number and clears its
// stored session.
func (r *Registry) Logout(ctx context.Context, phoneNumberID string) error {
	client, err := r.client(phoneNumberID)
	if err != nil {
		return err
	}
	return client.Logout(ctx)
}

// client returns the registered client for phoneNumberID.
func (r *Registry) client(phoneNumberID string) (*Client, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	client, ok := r.clients[phoneNumberID]
	if !ok {
		return nil, &ports.ErrSenderNotFound{PhoneNumberID: phoneNumberID}
	}
	return client, nil
}

// Connect connects every device, running QR pairing for devices without a
// stored session. Failures are collected per device so the remaining devices
// still connect.
func (r *Registry) Connect(ctx context.Context) error {
	var errs []error
	for _, client := range r.allClients() {
		if err := client.connect(ctx); err != nil {
			errs = append(errs, fmt.Errorf("whatsmeow: connect device %s: %w", client.number, err))
		}
	}
	return errors.Join(errs...)
}

// DisconnectAll drains every device's send queue and disconnects its client.
// It is a no-op when no devices are registered.
func (r *Registry) DisconnectAll() {
	for _, client := range r.allClients() {
		client.Disconnect()
		r.logger.Printf("whatsmeow: disconnected device %s", client.number)
	}
}

// reconnectHandler reconnects a device after an unexpected disconnect with a
// bounded backoff while ctx is alive.
func (r *Registry) reconnectHandler(ctx context.Context, client *Client) func(any) {
	return func(evt any) {
		if _, ok := evt.(*events.Disconnected); !ok {
			return
		}
		r.logger.Printf("whatsmeow: device %s disconnected, reconnecting", client.number)
		go client.reconnectLoop(ctx)
	}
}

// allClients snapshots the registered clients for stable iteration.
func (r *Registry) allClients() []*Client {
	r.mu.RLock()
	defer r.mu.RUnlock()
	clients := make([]*Client, 0, len(r.clients))
	for _, client := range r.clients {
		clients = append(clients, client)
	}
	return clients
}

// validateSpecs rejects empty or duplicate device specs before any client is
// constructed, failing fast at boot.
func validateSpecs(specs []DeviceSpec) error {
	seen := make(map[string]struct{}, len(specs))
	for _, spec := range specs {
		if spec.PhoneNumberID == "" {
			return errors.New("whatsmeow: device spec phone number id is empty")
		}
		if spec.Number == "" {
			return fmt.Errorf("whatsmeow: device spec %q number is empty", spec.PhoneNumberID)
		}
		if _, ok := seen[spec.PhoneNumberID]; ok {
			return fmt.Errorf("whatsmeow: duplicate device spec for phone number id %q", spec.PhoneNumberID)
		}
		seen[spec.PhoneNumberID] = struct{}{}
	}
	return nil
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
