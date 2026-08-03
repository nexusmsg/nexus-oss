package ports

import (
	"context"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

type MessageSender interface {
	Send(context.Context, domain.OutboundMessage) (domain.SendResult, error)
}

type OutboundMessageService interface {
	Send(context.Context, domain.OutboundMessage) (domain.OutboundResponse, error)
}
