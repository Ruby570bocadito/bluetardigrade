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
