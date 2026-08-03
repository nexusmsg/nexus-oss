package ports

import (
	"context"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

// WebhookConfigProvider resolves the webhook forwarding config for a phone
// number ID.
type WebhookConfigProvider interface {
	Get(ctx context.Context, phoneNumberID string) (domain.WebhookConfig, error)
}
