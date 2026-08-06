package ports

import "errors"

// ErrDispatched is returned by a handler that forwarded the job to another
// queue (cmd/worker -> whatsmeow_jobs). The consumer recognizes it and leaves
// the jobs row in 'claimed' instead of completing, retrying, or failing it —
// the terminal status is written back by the whatsapp worker later.
var ErrDispatched = errors.New("job dispatched to whatsmeow_jobs")
