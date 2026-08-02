package webhook

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
)

func TestClientForwardSendsJSONAndSignature(t *testing.T) {
	const secret = "test-secret"
	var receivedBody string
	var receivedSignature string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request body: %v", err)
		}
		receivedBody = string(body)
		receivedSignature = r.Header.Get("X-Hub-Signature-256")
		if r.Method != http.MethodPost {
			t.Errorf("method = %s", r.Method)
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("content type = %q", got)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	payload := domain.WebhookPayload{Object: "whatsapp_business_account"}
	if err := NewClient(server.URL, secret).Forward(context.Background(), payload); err != nil {
		t.Fatalf("Forward() error = %v", err)
	}
	if receivedBody != `{"object":"whatsapp_business_account","entry":null}` {
		t.Fatalf("body = %q", receivedBody)
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(receivedBody))
	wantSignature := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if receivedSignature != wantSignature {
		t.Errorf("signature = %q, want %q", receivedSignature, wantSignature)
	}
}

func TestClientForwardRejectsNon2xxResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	err := NewClient(server.URL, "").Forward(context.Background(), domain.WebhookPayload{})
	if err == nil || !strings.Contains(err.Error(), "webhook returned status 400") {
		t.Fatalf("Forward() error = %v", err)
	}
}

func TestClientForwardHonorsCanceledContext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := NewClient(server.URL, "").Forward(ctx, domain.WebhookPayload{})
	if err == nil || !strings.Contains(err.Error(), "context canceled") {
		t.Fatalf("Forward() error = %v", err)
	}
}
