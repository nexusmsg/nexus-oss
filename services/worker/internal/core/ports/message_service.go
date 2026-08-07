package ports

import (
	"context"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

type MessageService interface {
	Inbound(ctx context.Context, event *entity.InboundEvent) error
}
