package ports

import (
	"context"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
)

type MessageSender interface {
	Send(context.Context, entity.OutboundMessage) (entity.SendResult, error)
}
