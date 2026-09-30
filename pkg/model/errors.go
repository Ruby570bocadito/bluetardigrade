package model

import "errors"

// Errors returned by Event.Validate: the minimal sanity check applied
// at ingestion, which rejects an event without an id or a type before
// it enters the pipeline.
var (
	// ErrMissingID is returned when an event arrives without its id field.
	ErrMissingID = errors.New("event: missing id")
	// ErrMissingType is returned when an event arrives without its type field.
	ErrMissingType = errors.New("event: missing type")
)
