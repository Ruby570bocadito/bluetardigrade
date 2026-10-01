package redact

import (
	"strings"
	"testing"
	"unicode"
)

func TestTerminalTextNeutralizesControlCharacters(t *testing.T) {
	input := "powershell.exe\n[ALERT]\r\t\x1b[2J\x9b31m\u202e\u2028\u2029"
	got := TerminalText(input)
	if strings.ContainsFunc(got, func(r rune) bool {
		return unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || r == '\u2028' || r == '\u2029'
	}) {
		t.Fatalf("terminal controls survived: %q", got)
	}
}

func TestTerminalTextPreservesReadableEvidence(t *testing.T) {
	const input = "主机 · PowerShell -enc prueba · José"
	if got := TerminalText(input); got != input {
		t.Fatalf("readable text changed: %q", got)
	}
}
