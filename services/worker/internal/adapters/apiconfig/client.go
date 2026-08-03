package apiconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/core/domain"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

var _ ports.WebhookConfigProvider = (*Client)(nil)

const defaultTTL = 30 * time.Second

// Client implements ports.WebhookConfigProvider against the internal API's
// GET /internal/webhook-config endpoint, caching successful lookups.
type Client struct {
	apiURL        string
	internalToken string
	ttl           time.Duration
	httpClient    *http.Client
	logger        *log.Logger

	mu    sync.Mutex
	cache map[string]cachedConfig
}

type cachedConfig struct {
	config    domain.WebhookConfig
	expiresAt time.Time
}

func NewClient(apiURL, internalToken string, ttl time.Duration, logger *log.Logger) *Client {
	if logger == nil {
		logger = log.Default()
	}
	if ttl <= 0 {
		ttl = defaultTTL
	}
	return &Client{
		apiURL:        apiURL,
		internalToken: internalToken,
		ttl:           ttl,
		httpClient:    &http.Client{Timeout: 10 * time.Second},
		logger:        logger,
		cache:         make(map[string]cachedConfig),
	}
}

func (c *Client) Get(ctx context.Context, phoneNumberID string) (domain.WebhookConfig, error) {
	if phoneNumberID == "" {
		return domain.WebhookConfig{}, fmt.Errorf("apiconfig: phone number id is required")
	}

	c.mu.Lock()
	entry, ok := c.cache[phoneNumberID]
	c.mu.Unlock()
	if ok && time.Now().Before(entry.expiresAt) {
		return entry.config, nil
	}

	config, err := c.fetch(ctx, phoneNumberID)
	if err != nil {
		return domain.WebhookConfig{}, err
	}

	c.mu.Lock()
	c.cache[phoneNumberID] = cachedConfig{config: config, expiresAt: time.Now().Add(c.ttl)}
	c.mu.Unlock()
	return config, nil
}

type webhookConfigResponse struct {
	WebhookURL    string `json:"webhook_url"`
	WebhookSecret string `json:"webhook_secret"`
}

func (c *Client) fetch(ctx context.Context, phoneNumberID string) (domain.WebhookConfig, error) {
	endpoint := strings.TrimRight(c.apiURL, "/") + "/internal/webhook-config"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return domain.WebhookConfig{}, fmt.Errorf("apiconfig: create request: %w", err)
	}
	query := req.URL.Query()
	query.Set("phone_number_id", phoneNumberID)
	req.URL.RawQuery = query.Encode()
	if c.internalToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.internalToken)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return domain.WebhookConfig{}, fmt.Errorf("apiconfig: fetch webhook config: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return domain.WebhookConfig{}, fmt.Errorf("apiconfig: webhook config returned status %d", resp.StatusCode)
	}

	var body webhookConfigResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return domain.WebhookConfig{}, fmt.Errorf("apiconfig: decode webhook config response: %w", err)
	}
	if body.WebhookURL == "" {
		return domain.WebhookConfig{}, fmt.Errorf("apiconfig: webhook config response missing webhook_url")
	}
	return domain.WebhookConfig{URL: body.WebhookURL, Secret: body.WebhookSecret}, nil
}
