package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/afikrim/waba-api-unofficial/internal/adapters/webhook/dto"
	"github.com/afikrim/waba-api-unofficial/internal/core/entity"
	"github.com/afikrim/waba-api-unofficial/internal/core/ports"
)

var _ ports.WebhookForwarder = (*Client)(nil)

type Client struct {
	httpClient *http.Client
}

// NewClient returns a config-agnostic webhook forwarder. The destination URL
// and optional signing secret are read from the per-call entity.WebhookConfig.
func NewClient() *Client {
	return &Client{
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Client) Forward(ctx context.Context, cfg entity.WebhookConfig, payload entity.WebhookPayload) error {
	p, err := dto.FromEntity(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	body, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.URL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	if cfg.Secret != "" {
		sig := dto.ComputeHMAC(cfg.Secret, body)
		req.Header.Set("X-Hub-Signature-256", "sha256="+sig)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send webhook: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	return nil
}
