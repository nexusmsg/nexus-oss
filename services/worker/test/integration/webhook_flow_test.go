//go:build integration

package integration_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"testing"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/webhook"
	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/wiremock/go-wiremock"
)

// The webhook suite is hermetic: it runs against a local WireMock server and
// never skips. The static mapping testdata/wiremock/mappings/webhook-forward.json
// matches ONLY on the exact X-Hub-Signature-256 value, so a request with a
// missing or wrong signature 404s and Forward fails — a matched 200 plus a
// journal count of 1 therefore proves the signature header byte-for-byte.

const (
	webhookTestSecret = "itest-webhook-secret"
	webhookTargetPath = "/hooks/wa/inbound"
	webhookRejectPath = "/hooks/wa/reject"
)

// webhookTestPayload returns the deterministic payload used by the webhook
// suite. Every field is fixed and the key order is Go's stable struct order,
// so the forwarded body (and therefore the HMAC signature) is identical on
// every run — the golden file and the static mapping both depend on that.
func webhookTestPayload() entity.WebhookPayload {
	return entity.WebhookPayload{
		Object: "whatsapp_business_account",
		Entry: []entity.Entry{{
			ID: "waba-id-itest-100",
			Changes: []entity.Change{{
				Field: "messages",
				Value: entity.Value{
					MessagingProduct: "whatsapp",
					Metadata: entity.Metadata{
						DisplayPhoneNumber: "15551234567",
						PhoneNumberID:      "phone-number-id-100",
					},
					Contacts: []entity.Contact{{
						Profile: entity.Profile{Name: "Integration Tester"},
						WaID:    "628123456789",
					}},
					Messages: []entity.Message{{
						From:      "628123456789",
						ID:        "wamid.itest-0001",
						Timestamp: "1710000000",
						Type:      "text",
						Text:      &entity.Text{Body: "hello from the integration suite"},
					}},
				},
			}},
		}},
	}
}

// expectedWebhookSignature computes the X-Hub-Signature-256 value the client
// must send for body using the same HMAC-SHA256 scheme the adapter signs with.
func expectedWebhookSignature(t *testing.T, body []byte) string {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(webhookTestSecret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestWebhookForwardRealWireMock(t *testing.T) {
	wm := wiremockSetup(t)
	ctx := context.Background()

	client := webhook.NewClient()
	cfg := entity.WebhookConfig{URL: wiremockURL() + webhookTargetPath, Secret: webhookTestSecret}
	if err := client.Forward(ctx, cfg, webhookTestPayload()); err != nil {
		t.Fatalf("Forward() error = %v", err)
	}

	criteria := wiremock.NewRequest(http.MethodPost, wiremock.URLPathEqualTo(webhookTargetPath))
	verified, err := wm.Verify(criteria, 1)
	if err != nil {
		t.Fatalf("wm.Verify() error = %v", err)
	}
	if !verified {
		t.Error("expected exactly 1 webhook POST to match the signature-gated mapping")
	}

	// The forwarded body must match the reviewed golden byte-for-byte.
	req := captureRequest(t, wm, criteria)
	assertGolden(t, "webhook_forward_body.json", []byte(req.Body))

	// And its signature must equal the HMAC computed over that body.
	if got, want := req.Headers["X-Hub-Signature-256"], expectedWebhookSignature(t, []byte(req.Body)); got != want {
		t.Errorf("X-Hub-Signature-256 = %q, want %q", got, want)
	}
}

func TestWebhookForwardRejectsNon2xxRealWireMock(t *testing.T) {
	wm := wiremockSetup(t)
	ctx := context.Background()

	// The static mapping webhook-reject.json returns 503 for any POST to the
	// reject path (no signature gate); the client must surface non-2xx
	// responses as errors instead of treating them as success.
	client := webhook.NewClient()
	cfg := entity.WebhookConfig{URL: wiremockURL() + webhookRejectPath, Secret: webhookTestSecret}
	err := client.Forward(ctx, cfg, webhookTestPayload())
	if err == nil || !strings.Contains(err.Error(), "webhook returned status 503") {
		t.Fatalf("Forward() error = %v, want a 503 status error", err)
	}

	criteria := wiremock.NewRequest(http.MethodPost, wiremock.URLPathEqualTo(webhookRejectPath))
	verified, err := wm.Verify(criteria, 1)
	if err != nil {
		t.Fatalf("wm.Verify() error = %v", err)
	}
	if !verified {
		t.Error("expected exactly 1 webhook POST to the reject endpoint")
	}
}
