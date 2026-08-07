package dto

// SessionDTO mirrors the session columns selected by the queue session store
// queries. All five columns are NOT NULL text columns, so no pointers needed.
type SessionDTO struct {
	PhoneNumberID     string
	Number            string
	DisplayPhone      string
	BusinessAccountID string
	Status            string
}
