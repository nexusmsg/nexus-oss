package dto

import "time"

// ExpiresAt returns the cache expiry for an entry cached at cachedAt with the
// given TTL, mirroring the original adapter's time.Now().Add(ttl).
func ExpiresAt(cachedAt time.Time, ttl time.Duration) time.Time {
	return cachedAt.Add(ttl)
}

// IsExpired reports whether a cached entry with the given expiry is stale at
// now, mirroring the original adapter's time.Now().Before(expiresAt) check.
func IsExpired(expiresAt, now time.Time) bool {
	return !now.Before(expiresAt)
}
