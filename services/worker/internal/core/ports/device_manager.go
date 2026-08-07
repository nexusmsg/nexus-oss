package ports

import (
	"context"
	"errors"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

// ErrAlreadyPaired reports that Pair was called on a device that already has a
// stored session. It lives in ports so the executor can errors.Is it without
// importing the adapter.
var ErrAlreadyPaired = errors.New("whatsmeow: device is already paired")

// ActiveDeviceProvider returns the phone number IDs of provisioned devices.
type ActiveDeviceProvider interface {
	ActiveDevices() []string
}

// DeviceManager provisions and drives per-device lifecycle. It replaces
// SessionRegistry.
type DeviceManager interface {
	// EnsureDevice provisions a device for the session. It is idempotent and
	// auto-connects devices that already have a stored session.
	EnsureDevice(ctx context.Context, session entity.Session) error
	// Pair generates a QR code for the given phone number ID.
	Pair(ctx context.Context, phoneNumberID string) (string, error)
	// Logout removes the device on successful logout.
	Logout(ctx context.Context, phoneNumberID string) error
	// ConnectStored connects every device with a stored session at boot.
	ConnectStored(ctx context.Context) error
	// ActiveDevices returns the provisioned phone number IDs (used by
	// heartbeat).
	ActiveDevices() []string
	Shutdown(ctx context.Context) error
}
