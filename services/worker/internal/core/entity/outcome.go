package entity

import "time"

// JobOutcome is the terminal disposition the queue consumer applies to a
// handled job.
type JobOutcome int

const (
	// JobOutcomeComplete marks the job succeeded and stores its result.
	JobOutcomeComplete JobOutcome = iota
	// JobOutcomeRetry returns the job to the pending queue with a backoff.
	JobOutcomeRetry
	// JobOutcomeFail marks the job permanently failed.
	JobOutcomeFail
	// JobOutcomeLeaveClaimed leaves the row claimed: the handler dispatched
	// the job to another queue that writes the terminal status back later.
	JobOutcomeLeaveClaimed
)

// baseBackoff and maxBackoff bound the exponential retry schedule.
const (
	baseBackoff = time.Second
	maxBackoff  = 30 * time.Second
)

// DefaultMaxAttempts is the queue's attempt cap applied to jobs whose row
// carries no max_attempts. It mirrors the consumer's MAX_ATTEMPTS env default.
const DefaultMaxAttempts = 3

// Classify mirrors the queue consumer's decision tree for a handled job:
//
//   - a nil error completes the job;
//   - an attempt at or past the effective max attempts fails the job;
//   - anything else retries with the attempt backoff.
//
// The ports.ErrDispatched case is intentionally not handled here: the queue
// consumer checks that sentinel itself and leaves the row claimed. This keeps
// the entity layer free of core/ports imports. maxAttemptsFallback is the
// consumer's attempt cap for jobs whose row carries no max_attempts (its
// MAX_ATTEMPTS env default). result is part of the signature for symmetry with
// the consumer call site; it never influences the decision.
func Classify(job Job, result JobResult, err error, maxAttemptsFallback int) JobOutcome {
	if err == nil {
		return JobOutcomeComplete
	}
	effectiveMax := maxAttemptsFallback
	if job.MaxAttempts > 0 {
		effectiveMax = job.MaxAttempts
	}
	if IsTerminalAttempt(job.Attempts, effectiveMax) {
		return JobOutcomeFail
	}
	return JobOutcomeRetry
}

// IsTerminalAttempt reports whether attempt is on or past the terminal attempt
// for maxAttempts. A job with maxAttempts <= 0 is never terminal here; the
// consumer's fallback cap covers those rows.
func IsTerminalAttempt(attempt, maxAttempts int) bool {
	return maxAttempts > 0 && attempt >= maxAttempts
}

// BackoffForAttempt returns the exponential backoff for an attempt count,
// starting at 1s for the first attempt and capped at 30s.
func BackoffForAttempt(attempts int) time.Duration {
	if attempts <= 0 {
		attempts = 1
	}
	backoff := baseBackoff << (attempts - 1)
	if backoff > maxBackoff {
		backoff = maxBackoff
	}
	return backoff
}
