//go:build integration

package integration_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/apiconfig"
	"github.com/wiremock/go-wiremock"
)

// The apiconfig suite is hermetic: it runs against a local WireMock server and
// never skips. The static mappings in testdata/wiremock/mappings/ serve
// GET /internal/webhook-config per phone_number_id, gated on the Bearer token
// the client must send. These tests prove the wired GET -> parse -> entity
// path and the cache/expiry behavior; the TTL math itself stays at unit level.

const (
	apiconfigEndpoint    = "/internal/webhook-config"
	apiconfigToken       = "itest-token"
	apiconfigPhoneNumber = "phone-itest-500"
)

func apiconfigClient(ttl time.Duration) *apiconfig.Client {
	return apiconfig.NewClient(wiremockURL(), apiconfigToken, ttl, nil)
}

func apiconfigCriteria() *wiremock.Request {
	return wiremock.NewRequest(http.MethodGet, wiremock.URLPathEqualTo(apiconfigEndpoint)).
		WithQueryParam("phone_number_id", wiremock.EqualTo(apiconfigPhoneNumber)).
		WithHeader("Authorization", wiremock.EqualTo("Bearer "+apiconfigToken))
}

func TestApiconfigGetRealWireMock(t *testing.T) {
	wm := wiremockSetup(t)
	ctx := context.Background()

	client := apiconfigClient(30 * time.Second)
	cfg, err := client.Get(ctx, apiconfigPhoneNumber)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if cfg.URL != "https://hooks.example.test/wa/itest" {
		t.Errorf("cfg.URL = %q, want the stubbed webhook URL", cfg.URL)
	}
	if cfg.Secret != "itest-secret" {
		t.Errorf("cfg.Secret = %q, want the stubbed webhook secret", cfg.Secret)
	}

	// The GET was wired: exactly one request matching path + query + token.
	criteria := apiconfigCriteria()
	verified, err := wm.Verify(criteria, 1)
	if err != nil {
		t.Fatalf("wm.Verify() error = %v", err)
	}
	if !verified {
		t.Error("expected exactly 1 GET to the webhook-config endpoint")
	}

	// A second Get within the TTL must be served from cache: still 1 request.
	if _, err := client.Get(ctx, apiconfigPhoneNumber); err != nil {
		t.Fatalf("second Get() error = %v", err)
	}
	verified, err = wm.Verify(criteria, 1)
	if err != nil {
		t.Fatalf("wm.Verify() error = %v", err)
	}
	if !verified {
		t.Error("expected the cache to serve the second Get without a new HTTP request")
	}
}

func TestApiconfigExpiryRefetchesRealWireMock(t *testing.T) {
	wm := wiremockSetup(t)
	ctx := context.Background()

	// Short TTL so the expiry -> refetch path is observable in a live test.
	client := apiconfigClient(200 * time.Millisecond)
	if _, err := client.Get(ctx, apiconfigPhoneNumber); err != nil {
		t.Fatalf("first Get() error = %v", err)
	}

	criteria := apiconfigCriteria()
	verified, err := wm.Verify(criteria, 1)
	if err != nil {
		t.Fatalf("wm.Verify() error = %v", err)
	}
	if !verified {
		t.Error("expected 1 GET on the first call")
	}

	// Wait past the TTL so the cached entry expires and the next Get refetches.
	time.Sleep(500 * time.Millisecond)
	if _, err := client.Get(ctx, apiconfigPhoneNumber); err != nil {
		t.Fatalf("Get() after TTL error = %v", err)
	}
	verified, err = wm.Verify(criteria, 2)
	if err != nil {
		t.Fatalf("wm.Verify() error = %v", err)
	}
	if !verified {
		t.Error("expected the expired entry to be refetched (2 GETs total)")
	}
}

func TestApiconfigMissingConfigRealWireMock(t *testing.T) {
	wm := wiremockSetup(t)
	ctx := context.Background()

	// The static mapping apiconfig-missing.json returns 404 for the missing
	// phone number; the client must surface the non-2xx as an error.
	const missing = "phone-itest-missing"
	client := apiconfig.NewClient(wiremockURL(), apiconfigToken, 30*time.Second, nil)
	_, err := client.Get(ctx, missing)
	if err == nil || !strings.Contains(err.Error(), "status 404") {
		t.Fatalf("Get() error = %v, want a 404 status error", err)
	}

	criteria := wiremock.NewRequest(http.MethodGet, wiremock.URLPathEqualTo(apiconfigEndpoint)).
		WithQueryParam("phone_number_id", wiremock.EqualTo(missing))
	verified, err := wm.Verify(criteria, 1)
	if err != nil {
		t.Fatalf("wm.Verify() error = %v", err)
	}
	if !verified {
		t.Error("expected exactly 1 GET for the missing phone number")
	}
}
