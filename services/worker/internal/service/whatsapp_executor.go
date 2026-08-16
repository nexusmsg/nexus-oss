package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
	"github.com/afikrim/waba-api-unofficial/internal/observability"
	"github.com/google/uuid"
)

// WhatsAppExecutor implements ports.JobHandler for the stateful half of the
// worker split: it reads jobs from whatsmeow_jobs, executes them on WhatsMeow,
// and writes the terminal status + result back to the originating jobs row
// (keyed by source_job_serial) so the API's synchronous-result contract is
// preserved.
type WhatsAppExecutor struct {
	provider     ports.OutboundSenderProvider
	sessionStore ports.SessionStore
	manager      ports.DeviceManager
	jobsStore    ports.JobStore
	emitter      *observability.Emitter
	logger       *log.Logger
}

var _ ports.JobHandler = (*WhatsAppExecutor)(nil)

// whatsmeowQRCodeTTL is how long a stored pairing QR code remains valid.
const whatsmeowQRCodeTTL = 5 * time.Minute

// NewWhatsAppExecutor builds the executor. jobsStore is the jobs-table Store
// used for result write-back; it may be nil (write-back is skipped) but
// cmd/whatsapp_worker always provides it. emitter is the shared fire-and-forget
// activity emitter; it is optional and nil-safe (a nil emitter degrades to a
// no-op).
func NewWhatsAppExecutor(provider ports.OutboundSenderProvider, sessionStore ports.SessionStore, manager ports.DeviceManager, jobsStore ports.JobStore, emitter *observability.Emitter, logger *log.Logger) *WhatsAppExecutor {
	if logger == nil {
		logger = log.Default()
	}
	return &WhatsAppExecutor{provider: provider, sessionStore: sessionStore, manager: manager, jobsStore: jobsStore, emitter: emitter, logger: logger}
}

func (e *WhatsAppExecutor) Handle(ctx context.Context, job entity.Job) (entity.JobResult, error) {
	var result entity.JobResult
	var err error
	switch job.Type {
	case entity.JobTypePairing:
		result, err = e.handlePairing(ctx, job)
	case entity.JobTypeLogout:
		result, err = e.handleLogout(ctx, job)
	default:
		result, err = e.handleSendMessage(ctx, job)
	}
	if err != nil {
		// Mirror the consumer's Fail-vs-RetryLater decision: when this
		// whatsmeow_jobs row is on its terminal attempt (attempts, already
		// incremented by the claim, >= max_attempts) the consumer will Fail it,
		// so also fail the originating jobs row. On retryable attempts the jobs
		// row stays 'claimed' and will be written back on a later retry.
		if job.SourceJobSerial != "" && e.jobsStore != nil && entity.IsTerminalAttempt(job.Attempts, job.MaxAttempts) {
			if failErr := e.jobsStore.Fail(ctx, job.SourceJobSerial, err); failErr != nil {
				e.logger.Printf("executor: write back failure for job %s: %v", job.SourceJobSerial, failErr)
			}
		}
		return result, err
	}
	// Send succeeded: write the result back to the originating jobs row so the
	// API can poll it to a wamid. A write-back error is logged, not propagated:
	// returning it would retry the whatsmeow_jobs row and duplicate the send.
	if job.SourceJobSerial != "" && e.jobsStore != nil {
		if completeErr := e.jobsStore.Complete(ctx, job.SourceJobSerial, result); completeErr != nil {
			e.logger.Printf("executor: write back result for job %s: %v", job.SourceJobSerial, completeErr)
		}
	}
	return result, nil
}

// ensureDevice fetches the session for the job's phone number and provisions a
// device for it. A job whose session no longer exists fails with a clear error
// instead of resolving a sender or pair flow against a missing device.
func (e *WhatsAppExecutor) ensureDevice(ctx context.Context, jobKind string, phoneNumberID string) (*entity.Session, error) {
	if e.sessionStore == nil {
		return nil, errors.New("executor: session store is nil")
	}
	if e.manager == nil {
		return nil, errors.New("executor: device manager is nil")
	}
	session, err := e.sessionStore.GetByPhoneNumberID(ctx, phoneNumberID)
	if err != nil {
		return nil, fmt.Errorf("executor: load session for %s job %q: %w", jobKind, phoneNumberID, err)
	}
	if session == nil {
		return nil, fmt.Errorf("executor: %s job for %q: session not found", jobKind, phoneNumberID)
	}
	if err := e.manager.EnsureDevice(ctx, *session); err != nil {
		return nil, fmt.Errorf("executor: ensure device for %s job %q: %w", jobKind, phoneNumberID, err)
	}
	return session, nil
}

// handlePairing marks the session as pairing, generates a QR code, persists it
// tagged with the originating job's serial, then returns the session to the
// ready (created) state. The returned JobResult carries the QR row's serial so
// the API can correlate a job with the QR it generated (avoiding stale-QR
// reads when several pairing jobs overlap on the same session).
func (e *WhatsAppExecutor) handlePairing(ctx context.Context, job entity.Job) (entity.JobResult, error) {
	if _, err := e.ensureDevice(ctx, "pairing", job.PhoneNumberID); err != nil {
		return entity.JobResult{}, err
	}
	if err := e.sessionStore.UpdateStatus(ctx, job.PhoneNumberID, entity.SessionStatusPairing); err != nil {
		return entity.JobResult{}, fmt.Errorf("executor: mark session pairing: %w", err)
	}
	qrCode, err := e.manager.Pair(ctx, job.PhoneNumberID)
	if err != nil {
		// A device that is already paired has no QR flow to run; treat the job
		// as a success so it does not retry forever.
		if errors.Is(err, ports.ErrAlreadyPaired) {
			e.logger.Printf("executor: device %q already paired; treating pairing job as success", job.PhoneNumberID)
			if statusErr := e.sessionStore.UpdateStatus(ctx, job.PhoneNumberID, entity.SessionStatusCreated); statusErr != nil {
				return entity.JobResult{}, fmt.Errorf("executor: reset status after already-paired: %w", statusErr)
			}
			return entity.JobResult{}, nil
		}
		// Return the session to ready state so a later retry can pair again.
		if statusErr := e.sessionStore.UpdateStatus(ctx, job.PhoneNumberID, entity.SessionStatusCreated); statusErr != nil {
			return entity.JobResult{}, fmt.Errorf("executor: reset status after pair failure: %w", statusErr)
		}
		return entity.JobResult{}, fmt.Errorf("executor: pair device %q: %w", job.PhoneNumberID, err)
	}
	qrSerial, err := e.sessionStore.StoreQrCode(ctx, job.PhoneNumberID, qrCode, time.Now().Add(whatsmeowQRCodeTTL), job.SourceJobSerial)
	if err != nil {
		return entity.JobResult{}, fmt.Errorf("executor: store qr code: %w", err)
	}
	if err := e.sessionStore.UpdateStatus(ctx, job.PhoneNumberID, entity.SessionStatusCreated); err != nil {
		return entity.JobResult{}, fmt.Errorf("executor: reset status after pairing: %w", err)
	}
	return entity.JobResult{QrSerial: qrSerial}, nil
}

// handleLogout disconnects the device and marks the session logged out.
func (e *WhatsAppExecutor) handleLogout(ctx context.Context, job entity.Job) (entity.JobResult, error) {
	if _, err := e.ensureDevice(ctx, "logout", job.PhoneNumberID); err != nil {
		return entity.JobResult{}, err
	}
	if err := e.manager.Logout(ctx, job.PhoneNumberID); err != nil {
		return entity.JobResult{}, fmt.Errorf("executor: logout device %q: %w", job.PhoneNumberID, err)
	}
	if err := e.sessionStore.UpdateStatus(ctx, job.PhoneNumberID, entity.SessionStatusLoggedOut); err != nil {
		return entity.JobResult{}, fmt.Errorf("executor: update logout status: %w", err)
	}
	return entity.JobResult{}, nil
}

func (e *WhatsAppExecutor) handleSendMessage(ctx context.Context, job entity.Job) (entity.JobResult, error) {
	if e.provider == nil {
		return entity.JobResult{}, fmt.Errorf("executor: outbound sender provider is nil")
	}

	var message entity.OutboundMessage
	if err := json.Unmarshal(job.Payload, &message); err != nil {
		return entity.JobResult{}, fmt.Errorf("executor: unmarshal job payload: %w", err)
	}
	if err := validateOutboundMessage(message); err != nil {
		return entity.JobResult{}, err
	}

	// Lazy-provision the device so jobs arriving after boot (e.g. from the API
	// POST /sessions) work without a restart.
	if _, err := e.ensureDevice(ctx, "send", job.PhoneNumberID); err != nil {
		return entity.JobResult{}, err
	}

	sender, err := e.provider.Sender(job.PhoneNumberID)
	if err != nil {
		var notFound *ports.ErrSenderNotFound
		if errors.As(err, &notFound) {
			return entity.JobResult{}, fmt.Errorf("executor: no sender for phone number %q: %w", job.PhoneNumberID, err)
		}
		return entity.JobResult{}, fmt.Errorf("executor: resolve sender for phone number %q: %w", job.PhoneNumberID, err)
	}

	result, err := sender.Send(ctx, message)
	if err != nil {
		e.recordSendOutcome(ctx, job, message, "", fmt.Errorf("executor: send outbound message: %w", err))
		return entity.JobResult{}, fmt.Errorf("executor: send outbound message: %w", err)
	}
	e.recordSendOutcome(ctx, job, message, result.ID, nil)
	return entity.JobResult{WA_MESSAGE_ID: result.ID}, nil
}

// recordSendOutcome records a fire-and-forget activity row for a send
// operation, carrying the job_serial (from source_job_serial) and the wamid
// when the send succeeded (plan §4). The type must stay within the migration's
// CHECK-valid set ('api_request','whatsapp_event','webhook_delivery'); an
// outbound send IS a webhook-delivery event in the WABA sense (a message
// delivery to WhatsApp), so it is recorded as a webhook_delivery row with its
// own summary. The event is emitted through the shared Emitter, which detaches
// the write from ctx cancellation and swallows recorder errors — it never
// affects the send result returned to the consumer.
func (e *WhatsAppExecutor) recordSendOutcome(ctx context.Context, job entity.Job, message entity.OutboundMessage, wamid string, sendErr error) {
	status := entity.ActivityStatusOK
	outcome := "sent"
	if sendErr != nil {
		status = entity.ActivityStatusError
		outcome = sendErr.Error()
	}
	payload, err := json.Marshal(map[string]any{
		"job_serial":   nullIfEmptyJobSerial(job.SourceJobSerial),
		"wamid":        wamid,
		"outcome":      outcome,
		"to":           message.To,
		"message_type": string(message.Type),
	})
	if err != nil {
		e.logger.Printf("observability: marshal send outcome payload: %v", err)
		return
	}
	var jobSerial *uuid.UUID
	if js := parseJobSerial(job.SourceJobSerial); js != uuid.Nil {
		v := js
		jobSerial = &v
	}
	event := entity.ActivityEvent{
		Serial:            uuid.New(),
		Type:              entity.ActivityTypeWebhookDelivery,
		Status:            status,
		PhoneNumberID:     job.PhoneNumberID,
		BusinessAccountID: "",
		Summary:           fmt.Sprintf("send %s (job %s)", outcome, job.SourceJobSerial),
		JobSerial:         jobSerial,
		WAMessageID:       wamid,
		ResourceType:      "job",
		Payload:           payload,
	}
	e.emitter.Emit(ctx, event)
}

// nullIfEmptyJobSerial returns nil for an empty job serial so the jsonb keeps
// the key absent rather than an empty string.
func nullIfEmptyJobSerial(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// parseJobSerial parses a job serial string to a uuid; returns uuid.Nil when it
// is not a valid uuid (job serials are app-generated uuids).
func parseJobSerial(s string) uuid.UUID {
	if s == "" {
		return uuid.Nil
	}
	u, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil
	}
	return u
}
