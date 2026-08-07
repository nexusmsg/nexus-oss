package dto

import (
	"encoding/json"
	"fmt"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

// Parse decodes and validates a raw webhook-config response body. The error
// messages match the original adapter's inline logic byte-for-byte.
func Parse(raw []byte) (WebhookConfigDTO, error) {
	var cfg WebhookConfigDTO
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return WebhookConfigDTO{}, fmt.Errorf("apiconfig: decode webhook config response: %w", err)
	}
	if cfg.WebhookURL == "" {
		return WebhookConfigDTO{}, fmt.Errorf("apiconfig: webhook config response missing webhook_url")
	}
	return cfg, nil
}

// ToEntity maps a validated WebhookConfigDTO onto an entity.WebhookConfig.
// It re-validates the URL so the mapper is safe to call on its own.
func ToEntity(cfg WebhookConfigDTO) (entity.WebhookConfig, error) {
	if cfg.WebhookURL == "" {
		return entity.WebhookConfig{}, fmt.Errorf("apiconfig: webhook config response missing webhook_url")
	}
	return entity.WebhookConfig{URL: cfg.WebhookURL, Secret: cfg.WebhookSecret}, nil
}
