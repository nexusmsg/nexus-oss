package dto

import "github.com/afikrim/waba-api-unofficial/internal/core/entity"

// RowScanner is satisfied by both *pgx.Rows and *pgx.Row, so a single scan
// helper can back both multi-row and single-row queries.
type RowScanner interface {
	Scan(dest ...any) error
}

// rowIterator is satisfied by *pgx.Rows (Next/Scan/Err).
type rowIterator interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}

// ScanJob scans one queue row into a JobDTO. includeSourceSerial selects the
// whatsmeow_jobs-only source_job_serial column, which the jobs table's SELECT
// does not return.
func ScanJob(row RowScanner, includeSourceSerial bool) (JobDTO, error) {
	var d JobDTO
	targets := []any{
		&d.ID, &d.Serial, &d.Type, &d.PhoneNumberID, &d.Payload,
		&d.Status, &d.Attempts, &d.MaxAttempts, &d.AvailableAt,
		&d.ClaimedBy, &d.ClaimedAt, &d.CompletedAt, &d.LastError,
		&d.Result, &d.IDempotencyKey,
	}
	if includeSourceSerial {
		targets = append(targets, &d.SourceJobSerial)
	}
	err := row.Scan(targets...)
	return d, err
}

// CollectJobs scans every remaining row into entity jobs. It returns nil for
// zero rows, matching the store's historical Claim behavior.
func CollectJobs(rows rowIterator, includeSourceSerial bool) ([]entity.Job, error) {
	var jobs []entity.Job
	for rows.Next() {
		d, err := ScanJob(rows, includeSourceSerial)
		if err != nil {
			return nil, err
		}
		job, err := ToEntity(d)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return jobs, nil
}

// ScanSession maps one session row into a SessionDTO. The column order must
// match the SELECT column list used by the session queries.
func ScanSession(row RowScanner) (SessionDTO, error) {
	var d SessionDTO
	err := row.Scan(
		&d.PhoneNumberID,
		&d.Number,
		&d.DisplayPhone,
		&d.BusinessAccountID,
		&d.Status,
	)
	return d, err
}

// CollectSessions scans every remaining row into entity sessions.
func CollectSessions(rows rowIterator) ([]entity.Session, error) {
	sessions := make([]entity.Session, 0)
	for rows.Next() {
		d, err := ScanSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, ToSession(d))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return sessions, nil
}
