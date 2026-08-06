package whatsmeow

import (
	"context"
	"errors"
	"log"
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// newTestManager builds a DeviceManager with empty maps so unit tests stay
// hermetic (no sqlstore container, no network).
func newTestManager() *DeviceManager {
	m := &DeviceManager{
		devices: make(map[string]*deviceRef),
		numbers: make(map[string]string),
		logger:  log.Default(),
	}
	return m
}

// addTestRef seeds a running actor for a phone number ID.
func (m *DeviceManager) addTestRef(phoneNumberID string, client *Client) *deviceRef {
	ref := newDeviceRef(client, phoneNumberID, m.removeDevice)
	m.devices[phoneNumberID] = ref
	go ref.run()
	return ref
}

func TestDeviceManagerSender(t *testing.T) {
	m := newTestManager()
	defer m.Shutdown(context.Background())
	clientA := newTestClient(nil)
	clientB := newTestClient(nil)
	m.addTestRef("phone-a", clientA)
	m.addTestRef("phone-b", clientB)

	sender, err := m.Sender("phone-a")
	if err != nil {
		t.Fatalf("Sender(phone-a) error = %v", err)
	}
	if sender != clientA {
		t.Fatalf("Sender(phone-a) = %p, want %p", sender, clientA)
	}
}

func TestDeviceManagerSenderNotFound(t *testing.T) {
	m := newTestManager()
	defer m.Shutdown(context.Background())

	_, err := m.Sender("unknown")
	var notFound *ports.ErrSenderNotFound
	if !errors.As(err, &notFound) {
		t.Fatalf("Sender(unknown) error = %v, want *ports.ErrSenderNotFound", err)
	}
	if notFound.PhoneNumberID != "unknown" {
		t.Fatalf("ErrSenderNotFound.PhoneNumberID = %q, want %q", notFound.PhoneNumberID, "unknown")
	}
}

func TestEnsureDeviceIdempotent(t *testing.T) {
	m := newTestManager()
	defer m.Shutdown(context.Background())
	client := newTestClient(nil)
	ref := m.addTestRef("phone-a", client)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	err := m.EnsureDevice(ctx, domain.Session{PhoneNumberID: "phone-a", Number: "628111111111"})
	if err != nil {
		t.Fatalf("EnsureDevice() error = %v, want nil", err)
	}
	// No double client: the ref must be unchanged.
	if got := m.devices["phone-a"]; got != ref {
		t.Fatalf("EnsureDevice replaced ref: got %p, want %p", got, ref)
	}
	if len(m.devices) != 1 {
		t.Fatalf("devices count = %d, want 1", len(m.devices))
	}
}

func TestEnsureDeviceRejectsDuplicateNumber(t *testing.T) {
	m := newTestManager()
	defer m.Shutdown(context.Background())
	client := newTestClient(nil)
	m.addTestRef("phone-a", client)
	m.numbers["628111111111"] = "phone-a"

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	err := m.EnsureDevice(ctx, domain.Session{PhoneNumberID: "phone-b", Number: "628111111111"})
	if err == nil {
		t.Fatal("EnsureDevice() = nil, want duplicate-number error")
	}
	if _, ok := m.devices["phone-b"]; ok {
		t.Fatal("EnsureDevice added a device for a duplicate number")
	}
}

func TestRemoveDeviceCleansMaps(t *testing.T) {
	m := newTestManager()
	defer m.Shutdown(context.Background())
	client := newTestClient(nil)
	ref := m.addTestRef("phone-a", client)
	m.numbers["628111111111"] = "phone-a"

	m.removeDevice("phone-a")

	if _, ok := m.devices["phone-a"]; ok {
		t.Fatal("removeDevice left devices map entry")
	}
	if _, ok := m.numbers[ref.number]; ok {
		t.Fatal("removeDevice left reverse index entry")
	}
}

func TestConnectStoredSkipsUnpairedDevices(t *testing.T) {
	// A device without a stored session must not be connected at startup (no
	// QR flow, no error); it waits for a pairing job.
	m := newTestManager()
	defer m.Shutdown(context.Background())
	client := newTestClient(nil)
	ref := m.addTestRef("phone-a", client)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := m.ConnectStored(ctx); err != nil {
		t.Fatalf("ConnectStored() error = %v, want nil (unpaired device skipped)", err)
	}
	if ref.connectPending.Load() {
		t.Fatal("ConnectStored requested a connect for an unpaired device")
	}
}

func TestShutdownEmptyIsNoOp(t *testing.T) {
	m := newTestManager()
	if err := m.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown() error = %v, want nil", err)
	}
}

func TestShutdownStopsActorsAndClosesClients(t *testing.T) {
	m := newTestManager()
	client := newTestClient(nil)
	m.addTestRef("phone-a", client)

	if err := m.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown() error = %v, want nil", err)
	}

	if !client.closed {
		t.Fatal("Shutdown did not close the client")
	}
}
