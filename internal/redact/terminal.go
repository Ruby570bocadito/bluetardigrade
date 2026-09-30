package redact

import (
	"strings"
	"unicode"
)

// TerminalText makes untrusted telemetry safe for a single human-facing
// terminal line. Control and formatting characters (including ESC, C1,
// newlines and bidi controls) become spaces. Structured evidence stays
// untouched: call this only when rendering, never before storage or JSON.
func TerminalText(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || r == '\u2028' || r == '\u2029' {
			return ' '
		}
		return r
	}, s)
}
