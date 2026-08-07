package dto

import (
	"strings"
	"testing"
	"time"
)

func TestParse(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		want    WebhookConfigDTO
		wantErr string // substring expected in the error, empty means success
	}{
		{
			name: "valid response",
			raw:  `{"webhook_url":"https://hooks.example.com/waba","webhook_secret":"s3cret"}`,
			want: WebhookConfigDTO{WebhookURL: "https://hooks.example.com/waba", WebhookSecret: "s3cret"},
		},
		{
			name: "valid response without secret",
			raw:  `{"webhook_url":"https://hooks.example.com/waba"}`,
			want: WebhookConfigDTO{WebhookURL: "https://hooks.example.com/waba"},
		},
		{
			name:    "malformed json",
			raw:     "not-json",
			wantErr: "decode webhook config response",
		},
		{
			name:    "empty body",
			raw:     ``,
			wantErr: "decode webhook config response",
		},
		{
			name:    "missing webhook_url",
			raw:     `{"webhook_secret":"s3cret"}`,
			wantErr: "missing webhook_url",
		},
		{
			name:    "empty webhook_url",
			raw:     `{"webhook_url":""}`,
			wantErr: "missing webhook_url",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Parse([]byte(tc.raw))
			if tc.wantErr != "" {
				if err == nil {
					t.Fatal("Parse() returned nil error")
				}
				if !strings.Contains(err.Error(), tc.wantErr) {
					t.Errorf("Parse() error = %q, want substring %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}
			if got != tc.want {
				t.Errorf("Parse() = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestToEntity(t *testing.T) {
	valid := WebhookConfigDTO{WebhookURL: "https://hooks.example.com/waba", WebhookSecret: "s3cret"}
	got, err := ToEntity(valid)
	if err != nil {
		t.Fatalf("ToEntity() error = %v", err)
	}
	if got.URL != "https://hooks.example.com/waba" || got.Secret != "s3cret" {
		t.Errorf("ToEntity() = %+v, want URL %q Secret %q", got, "https://hooks.example.com/waba", "s3cret")
	}

	for name, cfg := range map[string]WebhookConfigDTO{
		"missing url": {WebhookSecret: "s3cret"},
		"empty url":   {WebhookURL: "", WebhookSecret: "s3cret"},
		"zero value":  {},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ToEntity(cfg)
			if err == nil {
				t.Fatal("ToEntity() returned nil error")
			}
			if !strings.Contains(err.Error(), "missing webhook_url") {
				t.Errorf("ToEntity() error = %q, want substring %q", err, "missing webhook_url")
			}
		})
	}
}

func TestExpiresAt(t *testing.T) {
	cachedAt := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	want := time.Date(2026, 8, 7, 12, 5, 0, 0, time.UTC)
	if got := ExpiresAt(cachedAt, 5*time.Minute); !got.Equal(want) {
		t.Errorf("ExpiresAt() = %v, want %v", got, want)
	}
}

func TestIsExpired(t *testing.T) {
	expiresAt := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		now  time.Time
		want bool
	}{
		{"not yet expired", expiresAt.Add(-time.Minute), false},
		{"exactly at expiry", expiresAt, true},
		{"past expiry", expiresAt.Add(time.Minute), true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsExpired(expiresAt, tc.now); got != tc.want {
				t.Errorf("IsExpired() = %v, want %v", got, tc.want)
			}
		})
	}
}
