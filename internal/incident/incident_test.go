package incident

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

const a1, a2, a3 = "0123456789abcdef", "fedcba9876543210", "aaaaaaaaaaaaaaaa"

func TestCreateValidatesAndOpens(t *testing.T) {
	s, _ := New("")
	inc, err := s.Create(Create{Title: "  Ransomware en LAB-WKS-01 ", Severity: "high", By: "ana", AlertIDs: []string{a1, a1, a2}, Hosts: []string{"LAB-WKS-01", "lab-wks-01"}})
	if err != nil {
		t.Fatal(err)
	}
	if inc.Status != StatusOpen || inc.Title != "Ransomware en LAB-WKS-01" || !ValidID(inc.ID) {
		t.Fatalf("unexpected incident %+v", inc)
	}
	if len(inc.AlertIDs) != 2 || len(inc.Hosts) != 1 {
		t.Fatalf("alerts and hosts must be deduplicated: %v %v", inc.AlertIDs, inc.Hosts)
	}
	if len(inc.Timeline) != 1 || inc.Timeline[0].Kind != "created" || inc.Timeline[0].By != "ana" {
		t.Fatalf("creation must open the timeline: %+v", inc.Timeline)
	}
	for _, bad := range []Create{
		{Title: ""},
		{Title: "x", Severity: "urgent"},
		{Title: "x", AlertIDs: []string{"not-an-id"}},
		{Title: strings.Repeat("t", MaxTitleLen+1)},
		{Title: "x", Hosts: []string{"bad\nhost"}},
	} {
		if _, err := s.Create(bad); err == nil {
			t.Errorf("Create(%+v) must fail", bad)
		}
	}
}

func TestUpdateRecordsEveryChange(t *testing.T) {
	s, _ := New("")
	inc, _ := s.Create(Create{Title: "Caso", Severity: "medium"})
	closed := StatusClosed
	sev := "critical"
	owner := "beto"
	got, err := s.Update(inc.ID, Patch{Status: &closed, Severity: &sev, Owner: &owner, By: "ana"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != StatusClosed || got.ClosedAt == "" || got.Severity != "critical" || got.Owner != "beto" {
		t.Fatalf("patch not applied: %+v", got)
	}
	kinds := []string{}
	for _, e := range got.Timeline {
		kinds = append(kinds, e.Kind)
	}
	if strings.Join(kinds, ",") != "created,severity,owner,status" {
		t.Fatalf("timeline kinds = %v", kinds)
	}
	open := StatusInvestigating
	got, _ = s.Update(inc.ID, Patch{Status: &open})
	if got.ClosedAt != "" {
		t.Fatalf("reopening must clear closed_at")
	}
	bad := Status("done")
	if _, err := s.Update(inc.ID, Patch{Status: &bad}); err == nil {
		t.Fatal("invalid status accepted")
	}
	if _, err := s.Update("0000000000000000", Patch{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown id: %v", err)
	}
}

func TestAddAlertsRaisesSeverityAndSkipsDuplicates(t *testing.T) {
	s, _ := New("")
	inc, _ := s.Create(Create{Title: "Caso", Severity: "low", AlertIDs: []string{a1}})
	got, err := s.AddAlerts(inc.ID, []string{a1, a2, a3}, []string{"LAB-WKS-02"}, "critical", "ana")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.AlertIDs) != 3 || got.Severity != "critical" || len(got.Hosts) != 1 {
		t.Fatalf("unexpected merge %+v", got)
	}
	last := got.Timeline[len(got.Timeline)-1]
	if last.Kind != "severity" {
		t.Fatalf("severity raise must be on the timeline: %+v", got.Timeline)
	}
	got, _ = s.AddAlerts(inc.ID, []string{a2}, nil, "low", "ana")
	if got.Severity != "critical" {
		t.Fatalf("a lower severity must not lower the case")
	}
}

func TestNotesAndListOrder(t *testing.T) {
	s, _ := New("")
	clock := time.Date(2026, 10, 4, 10, 0, 0, 0, time.UTC)
	s.now = func() time.Time { clock = clock.Add(time.Second); return clock }
	first, _ := s.Create(Create{Title: "Primero"})
	second, _ := s.Create(Create{Title: "Segundo"})
	if _, err := s.AddNote(first.ID, "   ", "ana"); err == nil {
		t.Fatal("empty note accepted")
	}
	if _, err := s.AddNote(first.ID, "Equipo aislado de la red", "ana"); err != nil {
		t.Fatal(err)
	}
	list := s.List()
	if len(list) != 2 || list[0].ID != first.ID || list[1].ID != second.ID {
		t.Fatalf("list must be ordered by last update: %v", []string{list[0].Title, list[1].Title})
	}
	open, total := s.Counts()
	if open != 2 || total != 2 {
		t.Fatalf("counts = %d/%d", open, total)
	}
}

func TestPersistenceRoundTripAndMalformedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "incidents.json")
	s, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	inc, _ := s.Create(Create{Title: "Persistente", AlertIDs: []string{a1}})
	_, _ = s.AddNote(inc.ID, "nota", "ana")
	again, err := New(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := again.Get(inc.ID)
	if err != nil || len(got.Timeline) != 2 || got.AlertIDs[0] != a1 {
		t.Fatalf("reload lost data: %+v %v", got, err)
	}
	// NTFS does not enforce POSIX permission bits (a 0600 file reads back
	// as 0666 there), so the mode is only checked where it means something
	if info, _ := os.Stat(path); runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("incident file must be private, mode %v", info.Mode().Perm())
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(path); err == nil {
		t.Fatal("a malformed file must refuse to load")
	}
}

func TestStoreIsBounded(t *testing.T) {
	s, _ := New("")
	for len(s.items) < MaxIncidents {
		id, _ := newID()
		s.items[id] = &Incident{}
	}
	if _, err := s.Create(Create{Title: "uno mas"}); !errors.Is(err, ErrFull) {
		t.Fatalf("a full store must refuse new cases: %v", err)
	}
}

// Breaching the per-case alert cap must refuse the request WHOLE: a
// mid-loop error used to leave the ids that still fit appended in
// memory (no timeline entry, no persist), so the client saw 400 while
// the case had silently grown.
func TestAddAlertsCapRefusalLeavesCaseUnchanged(t *testing.T) {
	s, _ := New("")
	inc, err := s.Create(Create{Title: "Tope de alertas"})
	if err != nil {
		t.Fatal(err)
	}
	ids := func(from, n int) []string {
		out := make([]string, 0, n)
		for i := 0; i < n; i++ {
			out = append(out, fmt.Sprintf("%016x", from+i))
		}
		return out
	}
	if _, err := s.AddAlerts(inc.ID, ids(0, 500), nil, "", "ana"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddAlerts(inc.ID, ids(500, 499), nil, "", "ana"); err != nil {
		t.Fatal(err)
	}
	// 999 linked: a request of two more breaches the cap.
	if _, err := s.AddAlerts(inc.ID, ids(999, 2), nil, "", "ana"); err == nil {
		t.Fatal("breaching the alert cap must fail")
	}
	got, err := s.Get(inc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.AlertIDs) != 999 {
		t.Fatalf("a refused request must not mutate the case: %d alerts", len(got.AlertIDs))
	}
	if len(got.Timeline) != 3 { // created + 2 alerts entries
		t.Fatalf("a refused request must not write timeline: %+v", got.Timeline)
	}
	if got.UpdatedAt != got.Timeline[2].At {
		t.Fatalf("a refused request must not bump UpdatedAt: %s vs %s", got.UpdatedAt, got.Timeline[2].At)
	}
}
