package ports

import (
	"context"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

type WebhookForwarder interface {
	Forward(ctx context.Context, cfg entity.WebhookConfig, payload entity.WebhookPayload) error
}
