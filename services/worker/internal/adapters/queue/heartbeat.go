package queue

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// defaultHeartbeatInterval refreshes last_seen_at when none is configured.
const defaultHeartbeatInterval = 10 * time.Second

// Heartbeat refreshes last_seen_at for provisioned devices on a fixed interval
// so the API can tell active devices apart from stale ones.
type Heartbeat struct {
	sessionStore ports.SessionStore
	provider     ports.ActiveDeviceProvider
	interval     time.Duration
	logger       *log.Logger
}

func NewHeartbeat(sessionStore ports.SessionStore, provider ports.ActiveDeviceProvider, interval time.Duration, logger *log.Logger) *Heartbeat {
	if logger == nil {
		logger = log.Default()
	}
	if interval <= 0 {
		interval = defaultHeartbeatInterval
	}
	return &Heartbeat{sessionStore: sessionStore, provider: provider, interval: interval, logger: logger}
}

// Run refreshes last_seen_at for every provisioned device each interval until
// ctx is canceled, returning nil on cancellation.
func (h *Heartbeat) Run(ctx context.Context) error {
	if h.sessionStore == nil {
		return errors.New("queue heartbeat: session store is nil")
	}
	if h.provider == nil {
		return errors.New("queue heartbeat: device provider is nil")
	}
	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			ids := h.provider.ActiveDevices()
			if len(ids) == 0 {
				h.logger.Printf("queue heartbeat: no provisioned devices")
				continue
			}
			if err := h.sessionStore.UpdateHeartbeats(ctx, ids); err != nil {
				h.logger.Printf("queue heartbeat: update last_seen_at: %v", err)
				continue
			}
			h.logger.Printf("queue heartbeat: refreshed %d sessions", len(ids))
		}
	}
}
