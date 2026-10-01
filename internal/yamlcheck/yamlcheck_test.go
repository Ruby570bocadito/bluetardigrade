package yamlcheck

import (
	"strings"
	"testing"
)

// The guard's contract: honest YAML (with or without modest anchors)
// passes; reference bombs and deep flow nesting are rejected before a
// typed decode could expand them.

func TestGuardPassesPlainDocuments(t *testing.T) {
	docs := []string{
		"rules:\n  - id: r1\n    name: test\n",
		"- one\n- two\n",
		"# comment only\n",
		"",
		"{broken: [unclosed\n", // parse error -> typed decode reports it, not us
	}
	for _, doc := range docs {
		if err := Guard("t.yaml", []byte(doc)); err != nil {
			t.Errorf("Guard(%q) = %v, want nil", doc, err)
		}
	}
}

func TestGuardPassesModestAnchors(t *testing.T) {
	// A legitimately factored config: one anchor, a few references.
	doc := `
base: &base
  severity: medium
  window: 300
rules:
  - id: r1
    <<: *base
  - id: r2
    <<: *base
`
	if err := Guard("t.yaml", []byte(doc)); err != nil {
		t.Errorf("legit anchors rejected: %v", err)
	}
}

func TestGuardRejectsAliasBomb(t *testing.T) {
	// Nine doubling levels: 8^9 references if expanded. Composes to a
	// tiny tree, so only the projection cap can catch it.
	var b strings.Builder
	b.WriteString("a: &a [\"x\",\"x\",\"x\",\"x\",\"x\",\"x\",\"x\",\"x\"]\n")
	for i, prev := range []string{"a", "b", "c", "d", "e", "f", "g", "h", "i"} {
		if i == 8 {
			b.WriteString("z: [" + strings.Repeat("*"+prev+", ", 7) + "*" + prev + "]\n")
			break
		}
		next := string(rune('a' + i + 1))
		b.WriteString(next + ": &" + next + " [" + strings.Repeat("*"+prev+", ", 7) + "*" + prev + "]\n")
	}
	err := Guard("bomb.yaml", []byte(b.String()))
	if err == nil {
		t.Fatal("alias bomb accepted")
	}
	for _, want := range []string{"alias", "bomb"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q missing %q", err, want)
		}
	}
}

func TestGuardRejectsReferenceFlood(t *testing.T) {
	// 64 scalar references to one anchor: under the expansion cap, over
	// the reference cap.
	var b strings.Builder
	b.WriteString("a: &a [x]\n")
	b.WriteString("z: [" + strings.Repeat("*a, ", 63) + "*a]\n")
	err := Guard("flood.yaml", []byte(b.String()))
	if err == nil || !strings.Contains(err.Error(), "alias references") {
		t.Fatalf("reference flood accepted or wrong error: %v", err)
	}
}

func TestGuardRejectsDeepFlowNesting(t *testing.T) {
	deep := "a: " + strings.Repeat("[", MaxNestingDepth+1) + strings.Repeat("]", MaxNestingDepth+1)
	err := Guard("deep.yaml", []byte(deep))
	if err == nil || !strings.Contains(err.Error(), "nesting") {
		t.Fatalf("deep flow nesting accepted or wrong error: %v", err)
	}
}

func TestGuardAcceptsMaxNesting(t *testing.T) {
	ok := "a: " + strings.Repeat("[", MaxNestingDepth) + strings.Repeat("]", MaxNestingDepth)
	if err := Guard("ok.yaml", []byte(ok)); err != nil {
		t.Errorf("nesting at the cap rejected: %v", err)
	}
}

func TestGuardRejectsCyclicAliasGraphs(t *testing.T) {
	for _, doc := range []string{
		"value: &a [*a]\n",
		"value: &a {self: *a}\n",
		"value: &a {nested: &b [*a, *b]}\n",
		"value: &a {<<: *a}\n",
	} {
		if err := Guard("cycle.yaml", []byte(doc)); err == nil || !strings.Contains(err.Error(), "cyclic") {
			t.Errorf("cyclic graph accepted or wrong error: %v", err)
		}
	}
}

func TestGuardCountsAliasReferencesOnce(t *testing.T) {
	for _, count := range []int{MaxAliasRefs, MaxAliasRefs + 1} {
		doc := "base: &a [x]\nrefs: [" + strings.Repeat("*a,", count-1) + "*a]\n"
		err := Guard("refs.yaml", []byte(doc))
		if count == MaxAliasRefs && err != nil {
			t.Fatalf("references at the budget rejected: %v", err)
		}
		if count > MaxAliasRefs && (err == nil || !strings.Contains(err.Error(), "alias references")) {
			t.Fatalf("reference budget not enforced: %v", err)
		}
	}
}

func TestGuardRejectsExpansionWithinAliasBudget(t *testing.T) {
	// Fifteen doubling levels use 30 aliases but exceed the node budget.
	var b strings.Builder
	b.WriteString("a: &a [x]\n")
	for i := 1; i <= 15; i++ {
		next, prev := string(rune('a'+i)), string(rune('a'+i-1))
		b.WriteString(next + ": &" + next + " [*" + prev + ", *" + prev + "]\n")
	}
	if err := Guard("expansion.yaml", []byte(b.String())); err == nil || !strings.Contains(err.Error(), "node cap") {
		t.Fatalf("projected expansion budget not enforced: %v", err)
	}
}

func TestQuotedClosersCannotHideFlowNesting(t *testing.T) {
	// Quoted ']' tokens offset every structural '[' in the raw pre-scan.
	doc := "a: " + strings.Repeat("[']', ", MaxNestingDepth+1) + "x" + strings.Repeat("]", MaxNestingDepth+1)
	if err := Guard("nested.yaml", []byte(doc)); err == nil || !strings.Contains(err.Error(), "nesting") {
		t.Fatalf("quoted closers hid excessive flow depth: %v", err)
	}
}
