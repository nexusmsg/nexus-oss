package queue

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// defaultHeartbeatInterval refreshes last_seen_at when none is configured.
const defaultHeartbeatInterval = 10 * time.Second

// Heartbeat refreshes last_seen_at for live sessions on a fixed interval so
// the API can tell active devices apart from stale ones.
type Heartbeat struct {
	pool     *pgxpool.Pool
	interval time.Duration
	logger   *log.Logger
}

func NewHeartbeat(pool *pgxpool.Pool, interval time.Duration, logger *log.Logger) *Heartbeat {
	if logger == nil {
		logger = log.Default()
	}
	if interval <= 0 {
		interval = defaultHeartbeatInterval
	}
	return &Heartbeat{pool: pool, interval: interval, logger: logger}
}

// Run refreshes every live session's last_seen_at each interval until ctx is
// canceled, returning nil on cancellation.
func (h *Heartbeat) Run(ctx context.Context) error {
	if h.pool == nil {
		return errors.New("queue heartbeat: pool is nil")
	}
	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			tag, err := h.pool.Exec(ctx, `
update sessions
set last_seen_at = now()
where deleted_at is null`)
			if err != nil {
				h.logger.Printf("queue heartbeat: update last_seen_at: %v", err)
				continue
			}
			h.logger.Printf("queue heartbeat: refreshed %d sessions", tag.RowsAffected())
		}
	}
}
