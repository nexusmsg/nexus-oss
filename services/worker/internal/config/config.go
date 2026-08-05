package config

import (
	"fmt"
	"os"
	"time"
)

type Config struct {
	SupabaseDSN       string
	MigrationsDir     string
	StoreDSN          string
	BusinessAccountID string
	APIURL            string
	InternalToken     string
	PollInterval      time.Duration
	MaxAttempts       int
	WebhookConfigTTL  time.Duration
	HeartbeatInterval time.Duration
}

func Load() (*Config, error) {
	pollInterval, err := getEnvDuration("POLL_INTERVAL", "1s")
	if err != nil {
		return nil, err
	}
	webhookConfigTTL, err := getEnvDuration("WEBHOOK_CONFIG_TTL", "30s")
	if err != nil {
		return nil, err
	}
	heartbeatInterval, err := getEnvDuration("HEARTBEAT_INTERVAL", "10s")
	if err != nil {
		return nil, err
	}
	return &Config{
		SupabaseDSN:       getEnv("SUPABASE_DSN", ""),
		MigrationsDir:     getEnv("MIGRATIONS_DIR", "../../shared/db/migrations"),
		StoreDSN:          getEnv("WHATSMEOW_STORE_DSN", ""),
		BusinessAccountID: getEnv("BUSINESS_ACCOUNT_ID", ""),
		APIURL:            getEnv("API_URL", ""),
		InternalToken:     getEnv("INTERNAL_TOKEN", ""),
		PollInterval:      pollInterval,
		MaxAttempts:       getEnvInt("MAX_ATTEMPTS", 3),
		WebhookConfigTTL:  webhookConfigTTL,
		HeartbeatInterval: heartbeatInterval,
	}, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
			return n
		}
	}
	return fallback
}

func getEnvDuration(key, fallback string) (time.Duration, error) {
	raw := getEnv(key, fallback)
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("config: parse %s %q: %w", key, raw, err)
	}
	return d, nil
}
