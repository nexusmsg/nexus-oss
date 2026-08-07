package config

import (
	"fmt"
	"time"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

// Config holds worker configuration loaded from environment variables and an
// optional .env file. Required connection params (SUPABASE_DSN,
// WHATSMEOW_STORE_DSN) are validated by the callers with their own messages;
// everything here has a safe default.
type Config struct {
	SupabaseDSN       string        `env:"SUPABASE_DSN"`
	MigrationsDir     string        `env:"MIGRATIONS_DIR" envDefault:"../../shared/db/migrations"`
	StoreDSN          string        `env:"WHATSMEOW_STORE_DSN"`
	BusinessAccountID string        `env:"BUSINESS_ACCOUNT_ID"`
	APIURL            string        `env:"API_URL"`
	InternalToken     string        `env:"INTERNAL_TOKEN"`
	PollInterval      time.Duration `env:"POLL_INTERVAL" envDefault:"1s"`
	MaxAttempts       int           `env:"MAX_ATTEMPTS" envDefault:"3"`
	WebhookConfigTTL  time.Duration `env:"WEBHOOK_CONFIG_TTL" envDefault:"30s"`
	HeartbeatInterval time.Duration `env:"HEARTBEAT_INTERVAL" envDefault:"10s"`
}

func Load() (*Config, error) {
	// Load .env values if present; never fatal when absent.
	_ = godotenv.Load()

	cfg := &Config{}
	if err := env.Parse(cfg); err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}
	return cfg, nil
}
