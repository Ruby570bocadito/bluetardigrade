package model

import "errors"

// Errors returned by Event.Validate: the minimal sanity check applied
// at ingestion, which rejects an event without an id or a type, or with
// an impossible timestamp, before it enters the pipeline.
var (
	// ErrMissingID is returned when an event arrives without its id field.
	ErrMissingID = errors.New("event: missing id")
	// ErrMissingType is returned when an event arrives without its type field.
	ErrMissingType = errors.New("event: missing type")
	// ErrTimestampRange is returned when an event declares a timestamp
	// before 1970 or from the year 2200 on.
	ErrTimestampRange = errors.New("event: timestamp out of range (accepted: 1970-01-01 up to 2200-01-01)")
)
