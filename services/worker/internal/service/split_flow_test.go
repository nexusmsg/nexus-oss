package service

// Functional tests for the two-binary split contract:
//
//   - cmd/worker (Dispatcher) polls "jobs", forwards each row into
//     "whatsmeow_jobs" (source_job_serial = jobs.serial) and returns
//     ports.ErrDispatched so the jobs row stays 'claimed'.
//   - cmd/whatsapp_worker (WhatsAppExecutor) polls "whatsmeow_jobs", sends the
//     message, and writes the terminal status + result back to the originating
//     jobs row.
//
// Everything is wired in memory through the port fakes in fakes_test.go — no
// adapters, no network, no database. The claim -> handle -> outcome cycle the
// queue consumer adapter would drive is applied here with the entity-layer
// classifier so the split contract is exercised at the service layer only.

import (
	"context"
	"errors"
	"io"
	"log"
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

// claimLimit mirrors the queue consumer's per-poll claim limit.
const claimLimit = 10

// runQueueLoop drains a fake queue table: it claims due rows and feeds each to
// the handler, applying the same outcome classification the queue consumer
// adapter uses — but through the service layer and port fakes only. It stops
// when no due rows remain (rows retried into the future are skipped until due).
func runQueueLoop(t *testing.T, store *fakeJobStore, handler ports.JobHandler) {
	t.Helper()
	for {
		jobs, err := store.Claim(context.Background(), claimLimit)
		if err != nil {
			t.Fatalf("claim: %v", err)
		}
		if len(jobs) == 0 {
			return
		}
		for _, job := range jobs {
			result, err := handler.Handle(context.Background(), job)
			// Sentinel contract: a dispatched job is left 'claimed'; the
			// whatsapp worker writes the terminal status back later.
			if errors.Is(err, ports.ErrDispatched) {
				continue
			}
			switch entity.Classify(job, result, err, 3) {
			case entity.JobOutcomeComplete:
				if err := store.Complete(context.Background(), job.Serial, result); err != nil {
					t.Fatalf("complete %s: %v", job.Serial, err)
				}
			case entity.JobOutcomeRetry:
				nextAvailableAt := time.Now().Add(entity.BackoffForAttempt(job.Attempts))
				if err := store.RetryLater(context.Background(), job.Serial, nextAvailableAt, err); err != nil {
					t.Fatalf("retry %s: %v", job.Serial, err)
				}
			case entity.JobOutcomeFail:
				if err := store.Fail(context.Background(), job.Serial, err); err != nil {
					t.Fatalf("fail %s: %v", job.Serial, err)
				}
			}
		}
	}
}

func discardLogger() *log.Logger {
	return log.New(io.Discard, "", 0)
}

// newSendJob is the seeded pending jobs-table row the tests dispatch.
func newSendJob() entity.Job {
	return entity.Job{
		Serial:        "jobs-serial-1",
		PhoneNumberID: "phone-1",
		Type:          entity.JobTypeSendMessage,
		Status:        entity.JobStatusPending,
		MaxAttempts:   3,
	}
}

// failingExecutor wires the executor half to a sender that always fails, the
// originating jobs store for write-back, and a session for phone-1.
func failingExecutor(jobsStore *fakeJobStore) *WhatsAppExecutor {
	executor, _, _ := newTestExecutor(
		&fakeSenderProvider{senders: map[string]ports.MessageSender{"phone-1": &failingSender{}}},
		&entity.Session{PhoneNumberID: "phone-1"}, nil, jobsStore,
	)
	return executor
}

// ---------------------------------------------------------------------------
// The split flow tests.
// ---------------------------------------------------------------------------

// TestSplitFlowDispatchAndWriteBack is the main functional contract: the
// dispatcher leaves the jobs row 'claimed', the executor sends the message and
// writes the wamid back, and both rows reach their terminal state exactly once.
func TestSplitFlowDispatchAndWriteBack(t *testing.T) {
	logger := discardLogger()

	jobsStore := newFakeJobStore()
	job := newSendJob()
	job.Payload = validTextPayload()
	jobsStore.Seed(job)
	whatsmeowStore := newFakeJobStore()

	// Half 1: the stateless dispatcher forwards jobs -> whatsmeow_jobs.
	runQueueLoop(t, jobsStore, NewDispatcher(whatsmeowStore, logger))

	// The jobs row must be left 'claimed' (sentinel contract), and a
	// whatsmeow_jobs row correlated by source_job_serial must appear.
	if snap := jobsStore.Get("jobs-serial-1"); snap.Status != entity.JobStatusClaimed {
		t.Fatalf("jobs row status = %q, want %q", snap.Status, entity.JobStatusClaimed)
	}
	if snap := jobsStore.Get("jobs-serial-1"); snap.Attempts != 1 {
		t.Errorf("jobs row attempts = %d, want 1", snap.Attempts)
	}
	whatsmeowSerial, whatsmeowJob, ok := whatsmeowStore.GetBySourceJobSerial("jobs-serial-1")
	if !ok {
		t.Fatal("whatsmeow_jobs row for jobs-serial-1 missing after dispatch")
	}
	if whatsmeowJob.SourceJobSerial != "jobs-serial-1" {
		t.Errorf("whatsmeow_jobs SourceJobSerial = %q, want jobs-serial-1", whatsmeowJob.SourceJobSerial)
	}
	if len(whatsmeowStore.enqueued) != 1 {
		t.Fatalf("Enqueue calls = %d, want 1", len(whatsmeowStore.enqueued))
	}

	// Half 2: the stateful executor sends and writes the result back.
	executor, _, _ := newTestExecutor(
		&fakeSenderProvider{senders: map[string]ports.MessageSender{"phone-1": &recordingSender{}}},
		&entity.Session{PhoneNumberID: "phone-1"}, nil, jobsStore,
	)
	runQueueLoop(t, whatsmeowStore, executor)

	// Terminal success: the jobs row is succeeded with the wamid the fake
	// sender produced, written back exactly once.
	snap := jobsStore.Get("jobs-serial-1")
	if snap.Status != entity.JobStatusSucceeded {
		t.Fatalf("jobs row status = %q, want %q", snap.Status, entity.JobStatusSucceeded)
	}
	if snap.Result.WA_MESSAGE_ID != "wamid-123" {
		t.Errorf("written-back wa_message_id = %q, want wamid-123", snap.Result.WA_MESSAGE_ID)
	}
	if got := len(jobsStore.complete); got != 1 {
		t.Fatalf("jobsStore.Complete calls = %d, want exactly 1", got)
	}
	if got := len(jobsStore.failed); got != 0 {
		t.Fatalf("jobsStore.Fail calls = %d, want 0", got)
	}

	// The whatsmeow_jobs row completed too.
	if snap := whatsmeowStore.Get(whatsmeowSerial); snap.Status != entity.JobStatusSucceeded {
		t.Errorf("whatsmeow_jobs row status = %q, want %q", snap.Status, entity.JobStatusSucceeded)
	}
}

// TestSplitFlowTerminalFailureWriteBack: when the whatsmeow_jobs row reaches
// its terminal attempt and the send fails, the executor must write 'failed'
// back to the originating jobs row (Fail exactly once, Complete never).
func TestSplitFlowTerminalFailureWriteBack(t *testing.T) {
	logger := discardLogger()

	jobsStore := newFakeJobStore()
	job := newSendJob()
	job.Payload = validTextPayload()
	jobsStore.Seed(job)
	whatsmeowStore := newFakeJobStore()

	// Dispatch the jobs row into whatsmeow_jobs first.
	runQueueLoop(t, jobsStore, NewDispatcher(whatsmeowStore, logger))
	whatsmeowSerial, _, ok := whatsmeowStore.GetBySourceJobSerial("jobs-serial-1")
	if !ok {
		t.Fatal("whatsmeow_jobs row for jobs-serial-1 missing after dispatch")
	}

	// Stage the whatsmeow row on its penultimate attempt (2 of 3): the next
	// claim increments to 3, making it terminal. The sender always fails.
	whatsmeowStore.SetAttempts(whatsmeowSerial, 2)
	runQueueLoop(t, whatsmeowStore, failingExecutor(jobsStore))

	// Terminal failure writes back to the jobs row.
	snap := jobsStore.Get("jobs-serial-1")
	if snap.Status != entity.JobStatusFailed || snap.LastErr == "" {
		t.Fatalf("jobs row = %+v, want failed with a recorded error", snap)
	}
	if got := len(jobsStore.failed); got != 1 {
		t.Fatalf("jobsStore.Fail calls = %d, want exactly 1", got)
	}
	if got := len(jobsStore.complete); got != 0 {
		t.Fatalf("jobsStore.Complete calls = %d, want 0", got)
	}

	// The whatsmeow row failed too (the consumer fails terminal rows).
	if snap := whatsmeowStore.Get(whatsmeowSerial); snap.Status != entity.JobStatusFailed {
		t.Errorf("whatsmeow_jobs row status = %q, want %q", snap.Status, entity.JobStatusFailed)
	}
}

// TestSplitFlowRetryableFailureLeavesJobsClaimed: a non-terminal whatsmeow
// failure is retried in whatsmeow_jobs and leaves the originating jobs row
// untouched ('claimed', no Complete, no Fail).
func TestSplitFlowRetryableFailureLeavesJobsClaimed(t *testing.T) {
	logger := discardLogger()

	jobsStore := newFakeJobStore()
	job := newSendJob()
	job.Payload = validTextPayload()
	jobsStore.Seed(job)
	whatsmeowStore := newFakeJobStore()

	runQueueLoop(t, jobsStore, NewDispatcher(whatsmeowStore, logger))
	whatsmeowSerial, _, ok := whatsmeowStore.GetBySourceJobSerial("jobs-serial-1")
	if !ok {
		t.Fatal("whatsmeow_jobs row for jobs-serial-1 missing after dispatch")
	}

	// Attempt 1 of 3: the claim makes it 2, still retryable. Sender always fails.
	whatsmeowStore.SetAttempts(whatsmeowSerial, 1)
	runQueueLoop(t, whatsmeowStore, failingExecutor(jobsStore))

	// The whatsmeow row is retried: back to pending with an error recorded and
	// scheduled in the future, so the loop stops before re-claiming it.
	snap := whatsmeowStore.Get(whatsmeowSerial)
	if snap.Status != entity.JobStatusPending || snap.LastErr == "" {
		t.Fatalf("whatsmeow_jobs row = %+v, want pending with a recorded error", snap)
	}
	if snap.Attempts != 2 {
		t.Errorf("whatsmeow_jobs attempts = %d, want 2", snap.Attempts)
	}

	// The jobs row stays claimed — no write-back for retryable failures.
	if got := len(jobsStore.complete); got != 0 {
		t.Fatalf("jobsStore.Complete calls = %d, want 0", got)
	}
	if got := len(jobsStore.failed); got != 0 {
		t.Fatalf("jobsStore.Fail calls = %d, want 0", got)
	}
	if snap := jobsStore.Get("jobs-serial-1"); snap.Status != entity.JobStatusClaimed {
		t.Fatalf("jobs row status = %q, want %q", snap.Status, entity.JobStatusClaimed)
	}
}
