package model

import "errors"

var (
	ErrMissingID   = errors.New("event: missing id")
	ErrMissingType = errors.New("event: missing type")
)
