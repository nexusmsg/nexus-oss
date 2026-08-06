package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// Dispatcher implements ports.JobHandler by validating each claimed jobs row
// and forwarding it to the whatsmeow_jobs queue, where the stateful whatsapp
// worker executes it and writes the result back. It is the stateless half of
// the split: it never imports or touches WhatsMeow, devices, or sessions.
type Dispatcher struct {
	dispatchStore ports.JobStore
	logger        *log.Logger
}

var _ ports.JobHandler = (*Dispatcher)(nil)

func NewDispatcher(dispatchStore ports.JobStore, logger *log.Logger) *Dispatcher {
	if logger == nil {
		logger = log.Default()
	}
	return &Dispatcher{dispatchStore: dispatchStore, logger: logger}
}

// Handle validates the job (send_message payloads only) and enqueues it into
// whatsmeow_jobs with source_job_serial set to the original jobs serial, then
// returns the sentinel ports.ErrDispatched so the consumer leaves the jobs row
// 'claimed' until the whatsapp worker writes the terminal result back.
func (d *Dispatcher) Handle(ctx context.Context, job domain.Job) (domain.JobResult, error) {
	if job.Type == domain.JobTypeSendMessage {
		var message domain.OutboundMessage
		if err := json.Unmarshal(job.Payload, &message); err != nil {
			return domain.JobResult{}, fmt.Errorf("dispatcher: unmarshal job payload: %w", err)
		}
		if err := validateOutboundMessage(message); err != nil {
			return domain.JobResult{}, err
		}
	}
	job.SourceJobSerial = job.Serial
	if _, err := d.dispatchStore.Enqueue(ctx, job); err != nil {
		return domain.JobResult{}, fmt.Errorf("dispatch to whatsmeow_jobs: %w", err)
	}
	d.logger.Printf("dispatcher: job %s dispatched to whatsmeow_jobs", job.Serial)
	return domain.JobResult{}, ports.ErrDispatched
}
