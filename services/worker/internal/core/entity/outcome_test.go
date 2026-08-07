package entity

import (
	"errors"
	"testing"
	"time"
)

func TestClassify(t *testing.T) {
	cases := []struct {
		name                string
		job                 Job
		err                 error
		maxAttemptsFallback int
		want                JobOutcome
	}{
		{"success completes regardless of attempts", Job{Attempts: 3, MaxAttempts: 3}, nil, 3, JobOutcomeComplete},
		{"error retries below max attempts", Job{Attempts: 1, MaxAttempts: 3}, errors.New("boom"), 3, JobOutcomeRetry},
		{"error fails at max attempts", Job{Attempts: 3, MaxAttempts: 3}, errors.New("boom"), 3, JobOutcomeFail},
		{"error fails past max attempts", Job{Attempts: 4, MaxAttempts: 3}, errors.New("boom"), 3, JobOutcomeFail},
		{"no max_attempts uses the fallback cap", Job{Attempts: 3}, errors.New("boom"), 3, JobOutcomeFail},
		{"no max_attempts retries below the fallback", Job{Attempts: 1}, errors.New("boom"), 3, JobOutcomeRetry},
		{"custom fallback cap fails at the cap", Job{Attempts: 5}, errors.New("boom"), 5, JobOutcomeFail},
		{"job max_attempts overrides the fallback", Job{Attempts: 2, MaxAttempts: 2}, errors.New("boom"), 10, JobOutcomeFail},
		{"non-positive fallback never terminal", Job{Attempts: 100}, errors.New("boom"), 0, JobOutcomeRetry},
		{"negative max_attempts falls back to the cap", Job{Attempts: 3, MaxAttempts: -1}, errors.New("boom"), 3, JobOutcomeFail},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Classify(tc.job, JobResult{}, tc.err, tc.maxAttemptsFallback)
			if got != tc.want {
				t.Errorf("Classify() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestIsTerminalAttempt(t *testing.T) {
	cases := []struct {
		attempt     int
		maxAttempts int
		want        bool
	}{
		{0, 3, false},
		{1, 3, false},
		{2, 3, false},
		{3, 3, true},
		{4, 3, true},
		{1, 1, true},
		{0, 0, false},
		{3, 0, false},
		{100, 0, false},
	}

	for _, tc := range cases {
		if got := IsTerminalAttempt(tc.attempt, tc.maxAttempts); got != tc.want {
			t.Errorf("IsTerminalAttempt(%d, %d) = %v, want %v", tc.attempt, tc.maxAttempts, got, tc.want)
		}
	}
}

func TestBackoffForAttempt(t *testing.T) {
	cases := []struct {
		attempts int
		want     time.Duration
	}{
		{0, time.Second},
		{1, time.Second},
		{2, 2 * time.Second},
		{3, 4 * time.Second},
		{4, 8 * time.Second},
		{5, 16 * time.Second},
		{6, 30 * time.Second},
		{10, 30 * time.Second},
	}
	for _, tt := range cases {
		if got := BackoffForAttempt(tt.attempts); got != tt.want {
			t.Errorf("BackoffForAttempt(%d) = %v, want %v", tt.attempts, got, tt.want)
		}
	}
}
