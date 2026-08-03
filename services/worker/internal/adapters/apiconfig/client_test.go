package apiconfig

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const testConfigResponse = `{"webhook_url":"https://hooks.example.com/waba","webhook_secret":"s3cret"}`

func TestClientGetReturnsConfig(t *testing.T) {
	var gotAuth, gotPhone string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if r.URL.Path != "/internal/webhook-config" {
			t.Errorf("path = %q", r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		gotPhone = r.URL.Query().Get("phone_number_id")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(testConfigResponse))
	}))
	defer server.Close()

	client := NewClient(server.URL, "tok-123", time.Minute, nil)
	cfg, err := client.Get(context.Background(), "phone-1")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if cfg.URL != "https://hooks.example.com/waba" || cfg.Secret != "s3cret" {
		t.Errorf("config = %+v", cfg)
	}
	if gotAuth != "Bearer tok-123" {
		t.Errorf("authorization = %q, want %q", gotAuth, "Bearer tok-123")
	}
	if gotPhone != "phone-1" {
		t.Errorf("phone_number_id = %q", gotPhone)
	}
}

func TestClientGetRejectsNon2xx(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := NewClient(server.URL, "tok", time.Minute, nil)
	_, err := client.Get(context.Background(), "phone-1")
	if err == nil || !strings.Contains(err.Error(), "status 404") {
		t.Fatalf("Get() error = %v, want status error", err)
	}
}

func TestClientGetRejectsMalformedBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("not-json"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "tok", time.Minute, nil)
	_, err := client.Get(context.Background(), "phone-1")
	if err == nil || !strings.Contains(err.Error(), "decode webhook config response") {
		t.Fatalf("Get() error = %v, want decode error", err)
	}
}

func TestClientGetRejectsMissingWebhookURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"webhook_secret":"s3cret"}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "tok", time.Minute, nil)
	_, err := client.Get(context.Background(), "phone-1")
	if err == nil || !strings.Contains(err.Error(), "missing webhook_url") {
		t.Fatalf("Get() error = %v, want missing webhook_url error", err)
	}
}

func TestClientGetCachesWithinTTL(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(testConfigResponse))
	}))
	defer server.Close()

	client := NewClient(server.URL, "tok", time.Minute, nil)
	for i := 0; i < 3; i++ {
		if _, err := client.Get(context.Background(), "phone-1"); err != nil {
			t.Fatalf("Get() #%d error = %v", i, err)
		}
	}
	if hits.Load() != 1 {
		t.Errorf("server hits = %d, want 1 (cache hit)", hits.Load())
	}
}

func TestClientGetCacheExpires(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(testConfigResponse))
	}))
	defer server.Close()

	client := NewClient(server.URL, "tok", 30*time.Millisecond, nil)
	if _, err := client.Get(context.Background(), "phone-1"); err != nil {
		t.Fatalf("first Get() error = %v", err)
	}
	time.Sleep(60 * time.Millisecond)
	if _, err := client.Get(context.Background(), "phone-1"); err != nil {
		t.Fatalf("second Get() error = %v", err)
	}
	if hits.Load() != 2 {
		t.Errorf("server hits = %d, want 2 after TTL expiry", hits.Load())
	}
}

func TestClientGetRejectsEmptyPhoneNumber(t *testing.T) {
	client := NewClient("http://localhost:1", "tok", time.Minute, nil)
	if _, err := client.Get(context.Background(), ""); err == nil {
		t.Fatal("Get() with empty phone number returned nil error")
	}
}
