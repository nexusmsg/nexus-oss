package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// JobExecutor implements ports.JobHandler by sending the job payload through
// the message sender registered for the job's phone number.
type JobExecutor struct {
	provider ports.OutboundSenderProvider
}

var _ ports.JobHandler = (*JobExecutor)(nil)

func NewJobExecutor(provider ports.OutboundSenderProvider) *JobExecutor {
	return &JobExecutor{provider: provider}
}

func (e *JobExecutor) Handle(ctx context.Context, job domain.Job) (domain.JobResult, error) {
	if e.provider == nil {
		return domain.JobResult{}, fmt.Errorf("executor: outbound sender provider is nil")
	}

	var message domain.OutboundMessage
	if err := json.Unmarshal(job.Payload, &message); err != nil {
		return domain.JobResult{}, fmt.Errorf("executor: unmarshal job payload: %w", err)
	}
	if err := validateOutboundMessage(message); err != nil {
		return domain.JobResult{}, err
	}

	sender, err := e.provider.Sender(job.PhoneNumberID)
	if err != nil {
		var notFound *ports.ErrSenderNotFound
		if errors.As(err, &notFound) {
			return domain.JobResult{}, fmt.Errorf("executor: no sender for phone number %q: %w", job.PhoneNumberID, err)
		}
		return domain.JobResult{}, fmt.Errorf("executor: resolve sender for phone number %q: %w", job.PhoneNumberID, err)
	}

	result, err := sender.Send(ctx, message)
	if err != nil {
		return domain.JobResult{}, fmt.Errorf("executor: send outbound message: %w", err)
	}
	return domain.JobResult{WA_MESSAGE_ID: result.ID}, nil
}
