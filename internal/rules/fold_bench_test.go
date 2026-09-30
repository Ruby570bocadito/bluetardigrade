package rules

import "testing"

// Micro-benchmarks that settle the O3 note from the A4 round (11h40):
// fold-based vs ToLower-based contains vs RE2 (?i) on realistic event
// field values — run with:
//
//	go test ./internal/rules -bench BenchmarkFold -benchmem
//
// The ASCII hit/miss pair measures the hot path (the fast path must
// stay as cheap as the previous ToLower implementation); the exotic
// pair measures the rune-window EqualFold scan that only non-ASCII
// haystacks ever pay.
func benchMatcher(b *testing.B, c Condition, given string) {
	m, err := NewMatcher([]Condition{c})
	if err != nil {
		b.Fatal(err)
	}
	fields := map[string]any{"f": given}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.MatchFields(fields)
	}
}

func BenchmarkFoldIContainsASCIIHit(b *testing.B) {
	benchMatcher(b, Condition{Field: "f", Operator: "icontains", Value: "mimikatz"},
		"powershell -nop -w hidden Invoke-MIMIKATZ -DumpCreds")
}

func BenchmarkFoldIContainsASCIIMiss(b *testing.B) {
	benchMatcher(b, Condition{Field: "f", Operator: "icontains", Value: "mimikatz"},
		"cmd.exe /c whoami /all > C:\\Windows\\Temp\\o.txt")
}

func BenchmarkFoldIContainsExoticMiss(b *testing.B) {
	// Fold-exotic haystack the ASCII fast path cannot decide: falls
	// through to the rune-window EqualFold scan (worst case).
	benchMatcher(b, Condition{Field: "f", Operator: "icontains", Value: "mimikatz"},
		"p\u017Fexec -accepteula -c cmd.exe /c whoami /all")
}

func BenchmarkFoldRegexIHit(b *testing.B) {
	benchMatcher(b, Condition{Field: "f", Operator: "regex", Value: `(?i)mimikatz`},
		"powershell -nop -w hidden Invoke-MIMIKATZ -DumpCreds")
}

func BenchmarkFoldRegexIExoticMiss(b *testing.B) {
	benchMatcher(b, Condition{Field: "f", Operator: "regex", Value: `(?i)mimikatz`},
		"p\u017Fexec -accepteula -c cmd.exe /c whoami /all")
}
