package whatsmeow

import (
	"errors"
	"log"
	"testing"

	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// newTestRegistry builds a registry from pre-built clients so unit tests stay
// hermetic (no sqlstore container, no network).
func newTestRegistry(logger *log.Logger, clients map[string]*Client) *Registry {
	if logger == nil {
		logger = log.Default()
	}
	return &Registry{clients: clients, logger: logger}
}

func TestRegistrySender(t *testing.T) {
	clientA := newTestClient(nil)
	clientB := newTestClient(nil)
	defer clientA.Disconnect()
	defer clientB.Disconnect()

	r := newTestRegistry(nil, map[string]*Client{
		"phone-a": clientA,
		"phone-b": clientB,
	})

	sender, err := r.Sender("phone-a")
	if err != nil {
		t.Fatalf("Sender(phone-a) error = %v", err)
	}
	if sender != clientA {
		t.Fatalf("Sender(phone-a) = %p, want %p", sender, clientA)
	}
	if _, err := r.Sender("phone-b"); err != nil {
		t.Fatalf("Sender(phone-b) error = %v", err)
	}
}

func TestRegistrySenderNotFound(t *testing.T) {
	r := newTestRegistry(nil, nil)

	_, err := r.Sender("unknown")
	var notFound *ports.ErrSenderNotFound
	if !errors.As(err, &notFound) {
		t.Fatalf("Sender(unknown) error = %v, want *ports.ErrSenderNotFound", err)
	}
	if notFound.PhoneNumberID != "unknown" {
		t.Fatalf("ErrSenderNotFound.PhoneNumberID = %q, want %q", notFound.PhoneNumberID, "unknown")
	}
}

func TestRegistryDisconnectAllEmpty(t *testing.T) {
	r := newTestRegistry(nil, nil)
	r.DisconnectAll() // must not panic
}

func TestRegistryDisconnectAllStopsClients(t *testing.T) {
	client := newTestClient(nil)
	r := newTestRegistry(nil, map[string]*Client{"phone-a": client})

	r.DisconnectAll()

	select {
	case <-client.workerDone:
	default:
		t.Fatal("DisconnectAll did not stop the client's send worker")
	}
}

func TestValidateSpecsDuplicatePhoneNumberID(t *testing.T) {
	err := validateSpecs([]DeviceSpec{
		{PhoneNumberID: "id-1", Number: "628111111111"},
		{PhoneNumberID: "id-1", Number: "628222222222"},
	})
	if err == nil {
		t.Fatal("validateSpecs() = nil, want duplicate phone number id error")
	}
}

func TestValidateSpecsEmptyFields(t *testing.T) {
	if err := validateSpecs([]DeviceSpec{{PhoneNumberID: "", Number: "628111111111"}}); err == nil {
		t.Fatal("validateSpecs() = nil, want empty phone number id error")
	}
	if err := validateSpecs([]DeviceSpec{{PhoneNumberID: "id-1", Number: ""}}); err == nil {
		t.Fatal("validateSpecs() = nil, want empty number error")
	}
}
