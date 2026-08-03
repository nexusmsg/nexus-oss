package ports

import (
	"context"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

type WebhookForwarder interface {
	Forward(ctx context.Context, payload domain.WebhookPayload) error
}
