package ports

import "github.com/afikrim/waba-api-unofficial/internal/core/domain"

type WebhookForwarder interface {
	Forward(payload domain.WebhookPayload) error
}
