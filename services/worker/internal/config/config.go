package config

import (
	"fmt"
	"os"
)

type WebhookConfig struct {
	URL                string
	Secret             string
	BusinessAccountID  string
	PhoneNumberID      string
	DisplayPhoneNumber string
}

type Config struct {
	Port         int
	APIAuthToken string
	Webhook      WebhookConfig
}

func Load() *Config {
	return &Config{
		Port:         getEnvInt("PORT", 8080),
		APIAuthToken: getEnv("API_AUTH_TOKEN", ""),
		Webhook: WebhookConfig{
			URL:                getEnv("WEBHOOK_URL", ""),
			Secret:             getEnv("WEBHOOK_SECRET", ""),
			BusinessAccountID:  getEnv("BUSINESS_ACCOUNT_ID", ""),
			PhoneNumberID:      getEnv("PHONE_NUMBER_ID", ""),
			DisplayPhoneNumber: getEnv("DISPLAY_PHONE_NUMBER", ""),
		},
	}
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
