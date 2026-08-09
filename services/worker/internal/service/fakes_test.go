package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// fakeSenderProvider resolves MessageSenders from a keyed map and records how
// often the provider itself was consulted.
type fakeSenderProvider struct {
	senders map[string]ports.MessageSender
	calls   int
}

func (p *fakeSenderProvider) Sender(phoneNumberID string) (ports.MessageSender, error) {
	p.calls++
	sender, ok := p.senders[phoneNumberID]
	if !ok {
		return nil, &ports.ErrSenderNotFound{PhoneNumberID: phoneNumberID}
	}
	return sender, nil
}

// failingSender always fails a send with a stable transport error.
type failingSender struct{}

func (s *failingSender) Send(_ context.Context, _ entity.OutboundMessage) (entity.SendResult, error) {
	return entity.SendResult{}, errors.New("device offline")
}

// recordingSender records the message it was asked to send and returns a
// stable wamid, like the whatsmeow adapter does on success.
type recordingSender struct {
	message entity.OutboundMessage
}

func (s *recordingSender) Send(_ context.Context, message entity.OutboundMessage) (entity.SendResult, error) {
	s.message = message
	return entity.SendResult{ID: "wamid-123", Recipient: "628123456789"}, nil
}

// fakeSessionStore is an in-memory ports.SessionStore for hermetic tests.
type fakeSessionStore struct {
	sessions    map[string]*entity.Session
	statuses    map[string]string
	whatsappIDs map[string]string
	qrCodes     map[string]string
}

func newFakeSessionStore() *fakeSessionStore {
	return &fakeSessionStore{
		sessions:    map[string]*entity.Session{},
		statuses:    map[string]string{},
		whatsappIDs: map[string]string{},
		qrCodes:     map[string]string{},
	}
}

func (s *fakeSessionStore) UpdateStatus(_ context.Context, phoneNumberID, status string) error {
	s.statuses[phoneNumberID] = status
	return nil
}

func (s *fakeSessionStore) MarkConnected(_ context.Context, phoneNumberID, whatsappID string) error {
	s.statuses[phoneNumberID] = entity.SessionStatusConnected
	s.whatsappIDs[phoneNumberID] = whatsappID
	return nil
}

func (s *fakeSessionStore) UpdateHeartbeats(_ context.Context, _ []string) error { return nil }

func (s *fakeSessionStore) StoreQrCode(_ context.Context, phoneNumberID, qrCode string, _ time.Time) error {
	s.qrCodes[phoneNumberID] = qrCode
	return nil
}

func (s *fakeSessionStore) GetSessionID(_ context.Context, _ string) (int64, error) { return 0, nil }

func (s *fakeSessionStore) ListSessions(_ context.Context) ([]entity.Session, error) { return nil, nil }

func (s *fakeSessionStore) GetByPhoneNumberID(_ context.Context, phoneNumberID string) (*entity.Session, error) {
	return s.sessions[phoneNumberID], nil
}

// fakeDeviceManager is an in-memory ports.DeviceManager for hermetic tests.
type fakeDeviceManager struct {
	ensureErr error
	pairErr   error
	pairQR    string
	ensured   []entity.Session
	paired    []string
	loggedOut []string
}

func (m *fakeDeviceManager) EnsureDevice(_ context.Context, session entity.Session) error {
	m.ensured = append(m.ensured, session)
	return m.ensureErr
}

func (m *fakeDeviceManager) Pair(_ context.Context, phoneNumberID string) (string, error) {
	m.paired = append(m.paired, phoneNumberID)
	return m.pairQR, m.pairErr
}

func (m *fakeDeviceManager) Logout(_ context.Context, phoneNumberID string) error {
	m.loggedOut = append(m.loggedOut, phoneNumberID)
	return nil
}

func (m *fakeDeviceManager) ConnectStored(_ context.Context) error { return nil }

func (m *fakeDeviceManager) ActiveDevices() []string { return nil }

func (m *fakeDeviceManager) Shutdown(_ context.Context) error { return nil }

// fakeJobStore is an in-memory ports.JobStore shared by the service-layer
// tests. One instance plays one queue table ("jobs" and "whatsmeow_jobs" get
// separate instances). It records write operations for assertions and mirrors
// the real store's Claim (status -> claimed, attempts + 1) and Enqueue (fresh
// serial, pending, attempts 0, max_attempts 3).
type fakeJobStore struct {
	mu          sync.Mutex
	rows        map[string]*fakeJobRow
	enqueued    []entity.Job
	complete    []completeCall
	failed      []failCall
	retried     []retryCall
	enqueueErr  error
	completeErr error
	failErr     error
	nextSerial  int
}

// fakeJobRow is one queue row: the job as last written plus the terminal
// result the API contract reads back.
type fakeJobRow struct {
	job    entity.Job
	result entity.JobResult
}

// jobSnapshot is the read-only view Get returns for assertions.
type jobSnapshot struct {
	Status      string
	Attempts    int
	MaxAttempts int
	Result      entity.JobResult
	LastErr     string
}

type completeCall struct {
	serial string
	result entity.JobResult
}

type failCall struct {
	serial string
	err    error
}

type retryCall struct {
	serial string
	at     time.Time
	err    error
}

// newFakeJobStore seeds the store with pending jobs (tracked by serial) so
// Claim has something to hand out.
func newFakeJobStore(pending ...entity.Job) *fakeJobStore {
	s := &fakeJobStore{rows: map[string]*fakeJobRow{}}
	for _, job := range pending {
		s.Seed(job)
	}
	return s
}

// Seed inserts a job row under its Serial. A blank status defaults to pending.
func (s *fakeJobStore) Seed(job entity.Job) {
	if job.Status == "" {
		job.Status = entity.JobStatusPending
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rows == nil {
		s.rows = map[string]*fakeJobRow{}
	}
	s.rows[job.Serial] = &fakeJobRow{job: job}
}

// Claim claims up to limit pending rows that are due (in serial order, for
// determinism), mirroring the real store: status -> claimed, attempts + 1.
func (s *fakeJobStore) Claim(_ context.Context, limit int) ([]entity.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	serials := make([]string, 0, len(s.rows))
	for serial := range s.rows {
		serials = append(serials, serial)
	}
	sort.Strings(serials)
	var claimed []entity.Job
	for _, serial := range serials {
		row := s.rows[serial]
		if row.job.Status == entity.JobStatusPending && !row.job.AvailableAt.After(time.Now()) {
			row.job.Status = entity.JobStatusClaimed
			row.job.Attempts++
			claimed = append(claimed, row.job)
			if len(claimed) >= limit {
				break
			}
		}
	}
	return claimed, nil
}

// Enqueue records the received job (as the dispatcher handed it over) and
// creates a fresh row under a new serial, like the real INSERT: status
// pending, attempts 0, max_attempts 3, source_job_serial preserved.
func (s *fakeJobStore) Enqueue(_ context.Context, job entity.Job) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.enqueueErr != nil {
		return "", s.enqueueErr
	}
	s.enqueued = append(s.enqueued, job)
	s.nextSerial++
	serial := fmt.Sprintf("wjs-%d", s.nextSerial)
	if job.MaxAttempts <= 0 {
		job.MaxAttempts = 3
	}
	job.Status = entity.JobStatusPending
	job.Attempts = 0
	job.Serial = serial // the new row has its own serial, like the real INSERT
	if s.rows == nil {
		s.rows = map[string]*fakeJobRow{}
	}
	s.rows[serial] = &fakeJobRow{job: job}
	return serial, nil
}

func (s *fakeJobStore) Complete(_ context.Context, serial string, result entity.JobResult) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.complete = append(s.complete, completeCall{serial: serial, result: result})
	if s.completeErr != nil {
		return s.completeErr
	}
	if row := s.rows[serial]; row != nil {
		row.job.Status = entity.JobStatusSucceeded
		row.job.LastError = ""
		row.result = result
	}
	return nil
}

func (s *fakeJobStore) Fail(_ context.Context, serial string, err error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failed = append(s.failed, failCall{serial: serial, err: err})
	if s.failErr != nil {
		return s.failErr
	}
	if row := s.rows[serial]; row != nil {
		row.job.Status = entity.JobStatusFailed
		if err != nil {
			row.job.LastError = err.Error()
		}
	}
	return nil
}

func (s *fakeJobStore) RetryLater(_ context.Context, serial string, at time.Time, err error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retried = append(s.retried, retryCall{serial: serial, at: at, err: err})
	row, ok := s.rows[serial]
	if !ok {
		return fmt.Errorf("retry: no row for serial %s", serial)
	}
	row.job.Status = entity.JobStatusPending
	row.job.AvailableAt = at
	if err != nil {
		row.job.LastError = err.Error()
	}
	return nil
}

// Get returns the current snapshot of a row (zero value when absent).
func (s *fakeJobStore) Get(serial string) jobSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	row, ok := s.rows[serial]
	if !ok {
		return jobSnapshot{}
	}
	return jobSnapshot{
		Status:      row.job.Status,
		Attempts:    row.job.Attempts,
		MaxAttempts: row.job.MaxAttempts,
		Result:      row.result,
		LastErr:     row.job.LastError,
	}
}

// GetBySourceJobSerial finds a whatsmeow_jobs row correlated to a jobs serial.
func (s *fakeJobStore) GetBySourceJobSerial(sourceSerial string) (string, entity.Job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for serial, row := range s.rows {
		if row.job.SourceJobSerial == sourceSerial {
			return serial, row.job, true
		}
	}
	return "", entity.Job{}, false
}

// SetAttempts rewrites a row's attempts directly — a test-only knob to stage a
// row on (or near) its terminal attempt before the executor consumer starts.
func (s *fakeJobStore) SetAttempts(serial string, attempts int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if row, ok := s.rows[serial]; ok {
		row.job.Attempts = attempts
	}
}

// newTestExecutor builds a WhatsAppExecutor with a fake session store
// (optionally seeded with a session), a fake device manager, and a fake job
// store for write-back assertions. A nil jobsStore becomes a nil interface so
// the executor's jobsStore-nil guard (not a typed-nil pointer) sees it.
func newTestExecutor(provider ports.OutboundSenderProvider, session *entity.Session, manager *fakeDeviceManager, jobsStore *fakeJobStore) (*WhatsAppExecutor, *fakeSessionStore, *fakeDeviceManager) {
	store := newFakeSessionStore()
	if session != nil {
		store.sessions[session.PhoneNumberID] = session
	}
	if manager == nil {
		manager = &fakeDeviceManager{}
	}
	var jobStorePort ports.JobStore
	if jobsStore != nil {
		jobStorePort = jobsStore
	}
	return NewWhatsAppExecutor(provider, store, manager, jobStorePort, nil), store, manager
}

// validTextPayload is a JSON payload that passes validateOutboundMessage.
func validTextPayload() []byte {
	payload, err := json.Marshal(entity.OutboundMessage{
		MessagingProduct: "whatsapp",
		To:               "628123456789",
		Type:             "text",
		Text:             &entity.Text{Body: "hello"},
	})
	if err != nil {
		panic(err)
	}
	return payload
}
