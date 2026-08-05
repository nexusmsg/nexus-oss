package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// JobExecutor implements ports.JobHandler by dispatching each job to the
// handler for its type: outbound messages through the message sender, and
// session lifecycle jobs through the device manager and store.
type JobExecutor struct {
	provider     ports.OutboundSenderProvider
	sessionStore ports.SessionStore
	manager      ports.DeviceManager
	logger       *log.Logger
}

var _ ports.JobHandler = (*JobExecutor)(nil)

// qrCodeTTL is how long a stored pairing QR code remains valid.
const qrCodeTTL = 5 * time.Minute

func NewJobExecutor(provider ports.OutboundSenderProvider, sessionStore ports.SessionStore, manager ports.DeviceManager) *JobExecutor {
	return &JobExecutor{provider: provider, sessionStore: sessionStore, manager: manager, logger: log.Default()}
}

func (e *JobExecutor) Handle(ctx context.Context, job domain.Job) (domain.JobResult, error) {
	switch job.Type {
	case domain.JobTypePairing:
		return e.handlePairing(ctx, job)
	case domain.JobTypeLogout:
		return e.handleLogout(ctx, job)
	default:
		return e.handleSendMessage(ctx, job)
	}
}

// ensureDevice fetches the session for the job's phone number and provisions a
// device for it. A job whose session no longer exists fails with a clear error
// instead of resolving a sender or pair flow against a missing device.
func (e *JobExecutor) ensureDevice(ctx context.Context, jobKind string, phoneNumberID string) (*domain.Session, error) {
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

// handlePairing marks the session as pairing, generates a QR code, persists it,
// then returns the session to the ready (created) state.
func (e *JobExecutor) handlePairing(ctx context.Context, job domain.Job) (domain.JobResult, error) {
	if _, err := e.ensureDevice(ctx, "pairing", job.PhoneNumberID); err != nil {
		return domain.JobResult{}, err
	}
	if err := e.sessionStore.UpdateStatus(ctx, job.PhoneNumberID, domain.SessionStatusPairing); err != nil {
		return domain.JobResult{}, fmt.Errorf("executor: mark session pairing: %w", err)
	}
	qrCode, err := e.manager.Pair(ctx, job.PhoneNumberID)
	if err != nil {
		// A device that is already paired has no QR flow to run; treat the job
		// as a success so it does not retry forever.
		if errors.Is(err, ports.ErrAlreadyPaired) {
			e.logger.Printf("executor: device %q already paired; treating pairing job as success", job.PhoneNumberID)
			if statusErr := e.sessionStore.UpdateStatus(ctx, job.PhoneNumberID, domain.SessionStatusCreated); statusErr != nil {
				return domain.JobResult{}, fmt.Errorf("executor: reset status after already-paired: %w", statusErr)
			}
			return domain.JobResult{}, nil
		}
		// Return the session to ready state so a later retry can pair again.
		if statusErr := e.sessionStore.UpdateStatus(ctx, job.PhoneNumberID, domain.SessionStatusCreated); statusErr != nil {
			return domain.JobResult{}, fmt.Errorf("executor: reset status after pair failure: %w", statusErr)
		}
		return domain.JobResult{}, fmt.Errorf("executor: pair device %q: %w", job.PhoneNumberID, err)
	}
	if err := e.sessionStore.StoreQrCode(ctx, job.PhoneNumberID, qrCode, time.Now().Add(qrCodeTTL)); err != nil {
		return domain.JobResult{}, fmt.Errorf("executor: store qr code: %w", err)
	}
	if err := e.sessionStore.UpdateStatus(ctx, job.PhoneNumberID, domain.SessionStatusCreated); err != nil {
		return domain.JobResult{}, fmt.Errorf("executor: reset status after pairing: %w", err)
	}
	return domain.JobResult{}, nil
}

// handleLogout disconnects the device and marks the session logged out.
func (e *JobExecutor) handleLogout(ctx context.Context, job domain.Job) (domain.JobResult, error) {
	if _, err := e.ensureDevice(ctx, "logout", job.PhoneNumberID); err != nil {
		return domain.JobResult{}, err
	}
	if err := e.manager.Logout(ctx, job.PhoneNumberID); err != nil {
		return domain.JobResult{}, fmt.Errorf("executor: logout device %q: %w", job.PhoneNumberID, err)
	}
	if err := e.sessionStore.UpdateStatus(ctx, job.PhoneNumberID, domain.SessionStatusLoggedOut); err != nil {
		return domain.JobResult{}, fmt.Errorf("executor: update logout status: %w", err)
	}
	return domain.JobResult{}, nil
}

func (e *JobExecutor) handleSendMessage(ctx context.Context, job domain.Job) (domain.JobResult, error) {
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

	// Lazy-provision the device so jobs arriving after boot (e.g. from the API
	// POST /sessions) work without a restart.
	if _, err := e.ensureDevice(ctx, "send", job.PhoneNumberID); err != nil {
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
