package lifecycle

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Assignment is a PARTIAL update: triage fields must survive it, and
// unassigning must leave nothing behind. These tests pin the store
// contract the API endpoints (and the console's overlay) rely on.

func TestAssignCreatesImplicitEntry(t *testing.T) {
	s, err := New("")
	if err != nil {
		t.Fatal(err)
	}
	e, err := s.Assign("0123456789abcdef", "ana", "beto")
	if err != nil {
		t.Fatalf("Assign: %v", err)
	}
	if e.Status != StatusNew {
		t.Fatalf("implicit status = %q, want new", e.Status)
	}
	if e.Assignee != "ana" || e.AssignedBy != "beto" {
		t.Fatalf("assignment fields = %q / %q", e.Assignee, e.AssignedBy)
	}
	if _, err := time.Parse(time.RFC3339Nano, e.AssignedAt); err != nil {
		t.Fatalf("assigned_at %q is not RFC 3339: %v", e.AssignedAt, err)
	}
	got, ok := s.Get("0123456789abcdef")
	if !ok || got.Assignee != "ana" {
		t.Fatalf("Get after assign = %v (ok=%v)", got, ok)
	}
}

func TestAssignPreservesTriage(t *testing.T) {
	s, err := New("")
	if err != nil {
		t.Fatal(err)
	}
	set, err := s.Set("0123456789abcdef", StatusAcknowledged, DecisionFalsePositive, "tarea programada", "ana")
	if err != nil {
		t.Fatal(err)
	}
	e, err := s.Assign("0123456789abcdef", "beto", "carla")
	if err != nil {
		t.Fatalf("Assign over a triaged alert: %v", err)
	}
	if e.Status != StatusAcknowledged || e.Decision != DecisionFalsePositive || e.Note != "tarea programada" {
		t.Fatalf("Assign wiped triage: %+v", e)
	}
	if e.By != set.By || e.At != set.At {
		t.Fatalf("Assign rewrote status attribution: by=%q at=%q", e.By, e.At)
	}
	if e.Assignee != "beto" || e.AssignedBy != "carla" {
		t.Fatalf("assignment fields = %q / %q", e.Assignee, e.AssignedBy)
	}
}

func TestReassignAndUnassign(t *testing.T) {
	s, err := New("")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Assign("0123456789abcdef", "ana", "beto"); err != nil {
		t.Fatal(err)
	}
	e, err := s.Assign("0123456789abcdef", "carla", "beto")
	if err != nil {
		t.Fatal(err)
	}
	if e.Assignee != "carla" {
		t.Fatalf("reassignee = %q, want carla", e.Assignee)
	}
	// Unassign keeps the triage record but drops every assignment field.
	e, err = s.Assign("0123456789abcdef", "", "beto")
	if err != nil {
		t.Fatal(err)
	}
	if e.Assignee != "" || e.AssignedBy != "" || e.AssignedAt != "" {
		t.Fatalf("unassign left fields behind: %+v", e)
	}
	if e.Status != StatusNew {
		t.Fatalf("unassigned status = %q, want new", e.Status)
	}
	// Unassigning an alert nobody owns and nobody triaged writes nothing.
	if _, err := s.Assign("ffffffffffffffff", "", "beto"); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.Get("ffffffffffffffff"); ok {
		t.Fatal("unassign created an entry for an untouched alert")
	}
}

func TestAssignIdempotent(t *testing.T) {
	s, err := New("")
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.Assign("0123456789abcdef", "ana", "beto")
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(2 * time.Millisecond) // the RFC 3339 stamp has nanosecond precision
	again, err := s.Assign("0123456789abcdef", "ana", "beto")
	if err != nil {
		t.Fatal(err)
	}
	if again.AssignedAt != first.AssignedAt {
		t.Fatalf("idempotent assign rewrote the stamp: %q -> %q", first.AssignedAt, again.AssignedAt)
	}
}

func TestAssignValidation(t *testing.T) {
	s, err := New("")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Assign("0123456789abcdef", strings.Repeat("x", MaxAssigneeLen+1), "beto"); err == nil {
		t.Fatal("oversized assignee accepted")
	}
	if _, err := s.Assign("0123456789abcdef", "ana", strings.Repeat("x", MaxByLen+1)); err == nil {
		t.Fatal("oversized by accepted")
	}
	if _, err := s.Assign("", "ana", "beto"); err == nil {
		t.Fatal("empty alert id accepted")
	}
}

// The persisted file is version 1 and the assignment rides inside the
// entry: an engine restart must bring the assignee back untouched.
func TestAssignPersistsAndReloads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lifecycle.json")
	s, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Assign("0123456789abcdef", "ana", "beto"); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(path)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	e, ok := reopened.Get("0123456789abcdef")
	if !ok || e.Assignee != "ana" || e.AssignedBy != "beto" || e.Status != StatusNew {
		t.Fatalf("reloaded entry = %+v (ok=%v)", e, ok)
	}
}
