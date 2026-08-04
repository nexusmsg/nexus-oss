package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

// Device is one WhatsApp device managed by the worker. It is the config
// package's own type; cmd maps it to the whatsmeow adapter's DeviceSpec.
type Device struct {
	PhoneNumberID string
	Number        string
	DisplayPhone  string
}

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
	Devices           []Device
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
	devices, err := parseDevices(getEnv("WABA_DEVICES", ""))
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
		Devices:           devices,
	}, nil
}

// parseDevices parses comma-separated `phone_number_id:number` pairs from
// WABA_DEVICES. An empty value yields no devices; malformed entries are
// rejected with an error naming the offending entry.
func parseDevices(raw string) ([]Device, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	entries := strings.Split(raw, ",")
	devices := make([]Device, 0, len(entries))
	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if strings.Count(entry, ":") != 1 {
			return nil, fmt.Errorf("config: malformed WABA_DEVICES entry %q: want phone_number_id:number", entry)
		}
		phoneNumberID, number, ok := strings.Cut(entry, ":")
		phoneNumberID = strings.TrimSpace(phoneNumberID)
		number = strings.TrimSpace(number)
		if !ok || phoneNumberID == "" || number == "" {
			return nil, fmt.Errorf("config: malformed WABA_DEVICES entry %q: want phone_number_id:number", entry)
		}
		devices = append(devices, Device{
			PhoneNumberID: phoneNumberID,
			Number:        number,
			// WABA_DEVICES carries no display phone; default to the number.
			DisplayPhone: number,
		})
	}
	return devices, nil
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
