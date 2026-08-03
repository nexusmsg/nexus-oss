package ports

import (
	"context"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

type MessageService interface {
	Inbound(ctx context.Context, event *domain.InboundEvent) error
}
