package dto

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

// ComputeHMAC returns the hex-encoded HMAC-SHA256 digest of body keyed by
// secret, as used for the webhook X-Hub-Signature-256 header value. The
// algorithm is preserved byte-for-byte from the original adapter: HMAC-SHA256
// over the raw request body, hex-encoded (lowercase), no key derivation.
func ComputeHMAC(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}
