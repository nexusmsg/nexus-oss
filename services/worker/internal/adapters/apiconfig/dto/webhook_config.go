package dto

// WebhookConfigDTO is the adapter-owned wire model of the internal API's
// GET /internal/webhook-config response body.
type WebhookConfigDTO struct {
	WebhookURL    string `json:"webhook_url"`
	WebhookSecret string `json:"webhook_secret"`
}
