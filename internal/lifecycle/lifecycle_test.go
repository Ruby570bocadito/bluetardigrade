package lifecycle

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSetGetAndValidation(t *testing.T) {
	s, err := New("") // memory-only
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := s.Set("abcdef0123456789", Status("bogus"), "", "", ""); err == nil {
		t.Fatal("invalid status accepted")
	}
	if _, err := s.Set("", StatusClosed, "", "", ""); err == nil {
		t.Fatal("empty id accepted")
	}
	long := strings.Repeat("x", MaxNoteLen+1)
	if _, err := s.Set("abcdef0123456789", StatusClosed, "", long, ""); err == nil {
		t.Fatal("oversized note accepted")
	}

	e, err := s.Set("abcdef0123456789", StatusAcknowledged, "", "visto en lab", "ana")
	if err != nil {
		t.Fatalf("Set: %v", err)
	}
	if e.Status != StatusAcknowledged || e.Note != "visto en lab" || e.By != "ana" {
		t.Fatalf("entry round-trip mismatch: %+v", e)
	}
	if e.At == "" {
		t.Fatal("At empty")
	}
	got, ok := s.Get("abcdef0123456789")
	if !ok || got.Status != StatusAcknowledged {
		t.Fatalf("Get = %+v ok=%v", got, ok)
	}
	if _, ok := s.Get("0000000000000000"); ok {
		t.Fatal("unknown id reported as present")
	}
	if s.Count() != 1 {
		t.Fatalf("Count = %d, want 1", s.Count())
	}
}

func TestReopenWithNewStatus(t *testing.T) {
	s, _ := New("")
	id := "abcdef0123456789"
	if _, err := s.Set(id, StatusClosed, "", "", ""); err != nil {
		t.Fatalf("close: %v", err)
	}
	e, err := s.Set(id, StatusNew, "", "falso positivo", "")
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if e.Status != StatusNew {
		t.Fatalf("reopen entry status = %q", e.Status)
	}
	got, _ := s.Get(id)
	if got.Status != StatusNew || got.Note != "falso positivo" {
		t.Fatalf("reopened entry = %+v", got)
	}
	if s.Count() != 1 {
		t.Fatalf("reopen created a second entry (Count=%d)", s.Count())
	}
}

func TestPersistenceRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "lifecycle.json")
	s, err := New(path)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := s.Set("abcdef0123456789", StatusClosed, "", "campaña cerrada", "ops"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if _, err := s.Set("0123456789abcdef", StatusAcknowledged, "", "", ""); err != nil {
		t.Fatalf("Set: %v", err)
	}

	reloaded, err := New(path)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if reloaded.Count() != 2 {
		t.Fatalf("reloaded Count = %d, want 2", reloaded.Count())
	}
	if e, ok := reloaded.Get("abcdef0123456789"); !ok || e.Status != StatusClosed || e.Note != "campaña cerrada" || e.By != "ops" {
		t.Fatalf("reloaded entry = %+v ok=%v", e, ok)
	}
	// file shape: version 1, JSON object with entries (human-inspectable)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	var f fileFormat
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatalf("file is not the documented format: %v", err)
	}
	if f.Version != 1 || len(f.Entries) != 2 {
		t.Fatalf("file = version %d, %d entries", f.Version, len(f.Entries))
	}
}

func TestMalformedFileIsAnError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lifecycle.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(path); err == nil {
		t.Fatal("malformed JSON accepted: triage state would silently reset")
	}
	// well-formed JSON but garbage entries must fail too
	if err := os.WriteFile(path, []byte(`{"version":1,"entries":[{"alert_id":"","status":"closed"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(path); err == nil {
		t.Fatal("entry with empty alert_id accepted")
	}
	if err := os.WriteFile(path, []byte(`{"version":2,"entries":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(path); err == nil {
		t.Fatal("unsupported version accepted")
	}
	// missing file is NOT an error (first run)
	if _, err := New(filepath.Join(t.TempDir(), "absent.json")); err != nil {
		t.Fatalf("absent file rejected: %v", err)
	}
}

func TestCapEvictsOldest(t *testing.T) {
	s, _ := New("")
	// fill beyond the cap with distinguishable zero-padded ids
	oldest := "0000000000000001"
	last := ""
	for i := 1; i <= MaxEntries+10; i++ {
		last = fmt.Sprintf("%016x", i)
		if _, err := s.Set(last, StatusClosed, "", "", ""); err != nil {
			t.Fatalf("Set %d: %v", i, err)
		}
	}
	if s.Count() > MaxEntries {
		t.Fatalf("cap exceeded: %d entries", s.Count())
	}
	if _, ok := s.Get(oldest); ok {
		t.Fatal("oldest entry survived eviction")
	}
	if _, ok := s.Get(last); !ok {
		t.Fatal("newest entry evicted instead of the oldest")
	}
}

func TestDecisionValidationAndRoundTrip(t *testing.T) {
	s, err := New("")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	id := "abcdef0123456789"
	// the three documented decisions are accepted on any status; a
	// typo (hyphen instead of underscore) is a hard error, never a
	// silent "no decision"
	for _, d := range []Decision{DecisionFalsePositive, DecisionAuthorizedActivity, DecisionConfirmedIncident} {
		if _, err := s.Set(id, StatusClosed, d, "nota", "ana"); err != nil {
			t.Fatalf("Set decision %q: %v", d, err)
		}
	}
	if _, err := s.Set(id, StatusClosed, Decision("false-positive"), "", ""); err == nil {
		t.Fatal("typo decision accepted (hyphen): must be a 400-grade error")
	}
	if _, err := s.Set(id, StatusClosed, Decision("benign"), "", ""); err == nil {
		t.Fatal("undocumented decision accepted")
	}

	s2, _ := New("")
	e, err := s2.Set(id, StatusClosed, DecisionFalsePositive, "regla ruidosa", "ana")
	if err != nil {
		t.Fatalf("Set: %v", err)
	}
	if e.Decision != DecisionFalsePositive {
		t.Fatalf("entry decision = %q", e.Decision)
	}
	got, ok := s2.Get(id)
	if !ok || got.Decision != DecisionFalsePositive || got.Status != StatusClosed {
		t.Fatalf("Get = %+v ok=%v", got, ok)
	}
}

func TestDecisionClearsOnOmission(t *testing.T) {
	s, _ := New("")
	id := "abcdef0123456789"
	if _, err := s.Set(id, StatusClosed, DecisionFalsePositive, "fp", "ana"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	// a later Set without decision REPLACES the record: the request is
	// the full new triage state (same semantics as note and by)
	e, err := s.Set(id, StatusAcknowledged, "", "reabierto", "bob")
	if err != nil {
		t.Fatalf("Set: %v", err)
	}
	if e.Decision != "" {
		t.Fatalf("omitted decision survived: %q", e.Decision)
	}
	got, _ := s.Get(id)
	if got.Decision != "" || got.Status != StatusAcknowledged || got.Note != "reabierto" || got.By != "bob" {
		t.Fatalf("record did not replace cleanly: %+v", got)
	}
}

func TestDecisionPersistenceAndBackwardsCompat(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lifecycle.json")
	s, err := New(path)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := s.Set("abcdef0123456789", StatusClosed, DecisionFalsePositive, "fp", "ana"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	reloaded, err := New(path)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if e, ok := reloaded.Get("abcdef0123456789"); !ok || e.Decision != DecisionFalsePositive {
		t.Fatalf("decision did not survive the file: %+v ok=%v", e, ok)
	}

	// a PRE-DECISION file (entries without the decision key) loads
	// untouched: the format stays version 1 and old engines can still
	// read what this one writes
	old := `{"version":1,"entries":[{"alert_id":"0123456789abcdef","status":"closed","note":"antes","by":"ops","at":"2026-10-05T10:00:00Z"}]}`
	oldPath := filepath.Join(t.TempDir(), "old.json")
	if err := os.WriteFile(oldPath, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	s2, err := New(oldPath)
	if err != nil {
		t.Fatalf("pre-decision file rejected: %v", err)
	}
	if e, ok := s2.Get("0123456789abcdef"); !ok || e.Decision != "" || e.Status != StatusClosed {
		t.Fatalf("pre-decision entry = %+v ok=%v", e, ok)
	}

	// an INVALID decision in the file is the same hard error class as
	// an invalid status: fail loudly, never fail open
	bad := `{"version":1,"entries":[{"alert_id":"0123456789abcdef","status":"closed","decision":"no-se-sabe"}]}`
	badPath := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(badPath, []byte(bad), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(badPath); err == nil {
		t.Fatal("file with an invalid decision accepted")
	}
}
