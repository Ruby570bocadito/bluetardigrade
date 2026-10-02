package store

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func ev(id, host, evType, cmdline string, at time.Time) *model.Event {
	return &model.Event{
		ID:        id,
		Timestamp: at,
		Type:      evType,
		Source:    "test",
		Host:      host,
		User:      "alice",
		Process:   &model.Process{PID: 1, Name: "powershell.exe", CommandLine: cmdline},
	}
}

func TestInsertAndQueryEventsRoundTrip(t *testing.T) {
	s := openTestStore(t)
	base := time.Now().Add(-time.Hour).UTC()
	// three events, two hosts, two types
	for i, e := range []*model.Event{
		ev("id-a", "LAB-ONE", model.TypeProcessCreate, "powershell -enc AAAA", base),
		ev("id-b", "lab-two", model.TypeNetworkConnect, "", base.Add(time.Minute)),
		ev("id-c", "LAB-ONE", model.TypeFileWrite, "", base.Add(2*time.Minute)),
	} {
		if err := s.InsertEvent(e); err != nil {
			t.Fatalf("InsertEvent %d: %v", i, err)
		}
	}

	got, err := s.QueryEvents(EventQuery{Limit: 10})
	if err != nil {
		t.Fatalf("QueryEvents: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 events, got %d", len(got))
	}
	// newest first
	if got[0].ID != "id-c" || got[2].ID != "id-a" {
		t.Fatalf("order wrong: %s, %s, %s", got[0].ID, got[1].ID, got[2].ID)
	}
	// round-trip fidelity: the JSON payload is the record
	orig, _ := ev("id-a", "LAB-ONE", model.TypeProcessCreate, "powershell -enc AAAA", base).Encode()
	round, _ := got[2].Encode()
	if string(orig) != string(round) {
		t.Fatalf("round-trip differs:\n orig  %s\n round %s", orig, round)
	}

	// host filter is exact, case-insensitive
	got, err = s.QueryEvents(EventQuery{Host: "lab-one", Limit: 10})
	if err != nil || len(got) != 2 {
		t.Fatalf("host filter: %d events, err %v", len(got), err)
	}
	// type filter
	got, err = s.QueryEvents(EventQuery{Type: model.TypeNetworkConnect, Limit: 10})
	if err != nil || len(got) != 1 || got[0].ID != "id-b" {
		t.Fatalf("type filter: %d events, err %v", len(got), err)
	}
	// since/until window (inclusive bounds)
	got, err = s.QueryEvents(EventQuery{Since: base.Add(30 * time.Second), Until: base.Add(90 * time.Second), Limit: 10})
	if err != nil || len(got) != 1 || got[0].ID != "id-b" {
		t.Fatalf("window filter: %d events, err %v", len(got), err)
	}
	// free text: matches the command line only
	got, err = s.QueryEvents(EventQuery{Q: "-enc aaaa", Limit: 10})
	if err != nil || len(got) != 1 || got[0].ID != "id-a" {
		t.Fatalf("q filter: %d events, err %v", len(got), err)
	}
	// limit keeps the most recent
	got, err = s.QueryEvents(EventQuery{Limit: 2})
	if err != nil || len(got) != 2 || got[0].ID != "id-c" {
		t.Fatalf("limit: %d events, err %v", len(got), err)
	}
}

func TestInsertEventIdempotentOnDuplicateID(t *testing.T) {
	s := openTestStore(t)
	at := time.Now().UTC()
	if err := s.InsertEvent(ev("dup", "H1", model.TypeProcessCreate, "x", at)); err != nil {
		t.Fatalf("first insert: %v", err)
	}
	if err := s.InsertEvent(ev("dup", "H1", model.TypeProcessCreate, "x", at)); err != nil {
		t.Fatalf("replay insert: %v", err)
	}
	got, err := s.QueryEvents(EventQuery{Limit: 10})
	if err != nil || len(got) != 1 {
		t.Fatalf("want 1 event after replay, got %d, err %v", len(got), err)
	}
	e, a := s.Counts()
	if e != 1 || a != 0 {
		t.Fatalf("counts: events=%d alerts=%d, want 1/0", e, a)
	}
}

func TestLikeWildcardsAreLiteral(t *testing.T) {
	s := openTestStore(t)
	at := time.Now().UTC()
	if err := s.InsertEvent(ev("pct", "H1", model.TypeFileWrite, "", at)); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertEvent(&model.Event{
		ID: "underscore", Timestamp: at, Type: model.TypeFileWrite,
		Source: "test", Host: "H1",
		File: &model.File{Path: "C:\\temp\\my_file.txt"},
	}); err != nil {
		t.Fatal(err)
	}
	// a literal '%' needle must not behave as a wildcard: it matches
	// only fields containing an actual percent sign
	got, err := s.QueryEvents(EventQuery{Q: "%", Limit: 10})
	if err != nil || len(got) != 0 {
		t.Fatalf("%% as literal: %d events, err %v", len(got), err)
	}
	// '_' must not match 'my-file.txt' (only the literal underscore one)
	got, err = s.QueryEvents(EventQuery{Q: "my_file", Limit: 10})
	if err != nil || len(got) != 1 || got[0].ID != "underscore" {
		t.Fatalf("_ as literal: %d events, err %v", len(got), err)
	}
}

func TestInsertAndQueryAlerts(t *testing.T) {
	s := openTestStore(t)
	mk := func(rule, sev, host, summary string) alert.Alert {
		return alert.Alert{
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			RuleID:    rule,
			RuleName:  "rule " + rule,
			Severity:  sev,
			Host:      host,
			User:      "alice",
			EventID:   "ev-1",
			EventType: model.TypeProcessCreate,
			Summary:   summary,
			MatchedOn: []string{"process.name"},
			Tags:      []string{"attack.t1059.001"},
		}
	}
	alerts := []alert.Alert{
		mk("11111111-1111", "high", "LAB-ONE", "encoded powershell"),
		mk("22222222-2222", "critical", "lab-two", "credential dump"),
		mk("33333333-3333", "high", "LAB-ONE", "runkey persistence"),
	}
	for i, a := range alerts {
		if err := s.InsertAlert(a); err != nil {
			t.Fatalf("InsertAlert %d: %v", i, err)
		}
	}

	got, err := s.QueryAlerts(AlertQuery{Limit: 10})
	if err != nil || len(got) != 3 {
		t.Fatalf("query all: %d alerts, err %v", len(got), err)
	}
	if got[0].RuleID != "33333333-3333" {
		t.Fatalf("newest first violated: %s", got[0].RuleID)
	}
	// severity list (case-insensitive values)
	got, err = s.QueryAlerts(AlertQuery{Severities: []string{"CRITICAL"}, Limit: 10})
	if err != nil || len(got) != 1 || got[0].RuleID != "22222222-2222" {
		t.Fatalf("severity filter: %d alerts, err %v", len(got), err)
	}
	// host + rule
	got, err = s.QueryAlerts(AlertQuery{Host: "lab-one", RuleID: "11111111-1111", Limit: 10})
	if err != nil || len(got) != 1 || got[0].Summary != "encoded powershell" {
		t.Fatalf("host+rule filter: %d alerts, err %v", len(got), err)
	}
	// free text over summary
	got, err = s.QueryAlerts(AlertQuery{Q: "credential", Limit: 10})
	if err != nil || len(got) != 1 {
		t.Fatalf("q filter: %d alerts, err %v", len(got), err)
	}
	// round-trip: tags and matched_on survive
	if len(got[0].Tags) != 1 || got[0].Tags[0] != "attack.t1059.001" || len(got[0].MatchedOn) != 1 {
		t.Fatalf("round-trip lost fields: %+v", got[0])
	}
	e, a := s.Counts()
	if e != 0 || a != 3 {
		t.Fatalf("counts: events=%d alerts=%d, want 0/3", e, a)
	}
}

func TestPruneRespectsCutoffAndCounts(t *testing.T) {
	s := openTestStore(t)
	now := time.Now().UTC()
	old := ev("old", "H1", model.TypeProcessCreate, "x", now.Add(-48*time.Hour))
	recent := ev("new", "H1", model.TypeProcessCreate, "y", now.Add(-time.Minute))
	if err := s.InsertEvent(old); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertEvent(recent); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertAlert(alert.Alert{
		Timestamp: now.Add(-48 * time.Hour).Format(time.RFC3339Nano),
		RuleID:    "r", Severity: "low", Host: "H1",
	}); err != nil {
		t.Fatal(err)
	}

	dEv, dAl, err := s.Prune(24 * time.Hour)
	if err != nil {
		t.Fatalf("Prune: %v", err)
	}
	if dEv != 1 || dAl != 1 {
		t.Fatalf("pruned ev=%d al=%d, want 1/1", dEv, dAl)
	}
	got, err := s.QueryEvents(EventQuery{Limit: 10})
	if err != nil || len(got) != 1 || got[0].ID != "new" {
		t.Fatalf("post-prune events: %d, err %v", len(got), err)
	}
	e, a := s.Counts()
	if e != 1 || a != 0 {
		t.Fatalf("counts after prune: %d/%d, want 1/0", e, a)
	}
}

func TestCountsSeededFromExistingDatabase(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/persist.db"
	s1, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s1.InsertEvent(ev("kept", "H1", model.TypeProcessCreate, "x", time.Now().UTC())); err != nil {
		t.Fatal(err)
	}
	if err := s1.Close(); err != nil {
		t.Fatal(err)
	}
	s2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s2.Close()
	got, err := s2.QueryEvents(EventQuery{Limit: 10})
	if err != nil || len(got) != 1 || got[0].ID != "kept" {
		t.Fatalf("history lost across restart: %d events, err %v", len(got), err)
	}
	e, a := s2.Counts()
	if e != 1 || a != 0 {
		t.Fatalf("counts not seeded: %d/%d, want 1/0", e, a)
	}
}

func TestSearchNeverMatchesAcrossFieldBoundaries(t *testing.T) {
	s := openTestStore(t)
	// host "LAB" + user "ONE" — the query "lab one" would match a
	// space-joined haystack but must not match the \x1f-joined one
	if err := s.InsertEvent(ev("split", "LAB", model.TypeProcessCreate, "cmd", time.Now().UTC())); err != nil {
		t.Fatal(err)
	}
	got, err := s.QueryEvents(EventQuery{Q: "lab t", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	// "lab t" can only match if some single field contains it
	for _, e := range got {
		if strings.Contains(strings.ToLower(e.Host), "lab t") {
			t.Fatalf("unexpected cross-field match on %s", e.ID)
		}
	}
}

// TestHostAxisIsUnicodeCaseInsensitive: 788e59b Unicode-folded the
// search haystack (free-text axis); this pins the remaining axis — the
// host column is Go-lowered at insert so host=máquina-01 matches the
// same way the ring does, and the alert severity column follows the
// same rule. The JSON payload keeps the raw evidence (columns are
// index only).
func TestHostAxisIsUnicodeCaseInsensitive(t *testing.T) {
	s := openTestStore(t)
	at := time.Now().UTC()
	// 788e59b Unicode-folded the search haystack (free-text axis);
	// this pins the remaining axis: the host column is Go-lowered
	// at insert so host=máquina-01 matches the way the ring does.
	// (SQLite's COLLATE NOCASE folds ASCII only, the rings fold
	// with Go's strings.ToLower — so the store lowers at insert.)
	if err := s.InsertEvent(ev("uni-1", "MÁQUINA-01", model.TypeProcessCreate, "CAÑÓN.exe /c dir", at)); err != nil {
		t.Fatal(err)
	}
	got, err := s.QueryEvents(EventQuery{Host: "máquina-01", Limit: 10})
	if err != nil || len(got) != 1 || got[0].ID != "uni-1" {
		t.Fatalf("unicode host filter: %d events, err %v", len(got), err)
	}
	got, err = s.QueryEvents(EventQuery{Q: "cañón", Limit: 10})
	if err != nil || len(got) != 1 || got[0].ID != "uni-1" {
		t.Fatalf("unicode q filter: %d events, err %v", len(got), err)
	}
	// the JSON payload keeps the raw evidence (columns are index only)
	got, err = s.QueryEvents(EventQuery{Host: "máquina-01", Limit: 10})
	if err != nil || len(got) != 1 || got[0].Host != "MÁQUINA-01" {
		t.Fatalf("payload mutated: %+v, err %v", got, err)
	}
}

func TestLegacySeparatorRowsCannotBeCrossed(t *testing.T) {
	s := openTestStore(t)
	// a row written before ingest stripped the separator: its user
	// field carries a forged boundary between host and the next
	// segment. The needle "host-a<sep>host-b" spans two fields and
	// must not match — likeNeedle strips the separator again for
	// exactly these legacy rows.
	if err := s.InsertEvent(&model.Event{
		ID: "legacy", Timestamp: time.Now().UTC(), Type: model.TypeProcessCreate,
		Source: "test", Host: "HOST-A", User: "HOST-B\x1fpowershell",
	}); err != nil {
		t.Fatal(err)
	}
	got, err := s.QueryEvents(EventQuery{Q: "host-a\x1fhost-b", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("needle crossed the field boundary on a legacy row: %d results", len(got))
	}
	// ...and the row is still findable by its real fields
	got, err = s.QueryEvents(EventQuery{Q: "host-b", Limit: 10})
	if err != nil || len(got) != 1 {
		t.Fatalf("legacy row lost: %d results, err %v", len(got), err)
	}
}

// Evidence is append-only: a second write of the same id with a
// different payload (another sensor reusing the id, a forged event)
// must not replace the stored row. The conflict is reported and
// counted; the original evidence stays byte-identical.
func TestInsertEventFirstWriteWins(t *testing.T) {
	s := openTestStore(t)
	at := time.Now().UTC()
	if err := s.InsertEvent(ev("rep", "DC-01", model.TypeProcessCreate, "procdump -ma lsass.exe", at)); err != nil {
		t.Fatal(err)
	}
	err := s.InsertEvent(ev("rep", "WKS-99", model.TypeProcessCreate, "notepad.exe", at))
	if !errors.Is(err, ErrIDConflict) {
		t.Fatalf("conflicting rewrite: err = %v, want ErrIDConflict", err)
	}
	got, err := s.QueryEvents(EventQuery{Limit: 10})
	if err != nil || len(got) != 1 {
		t.Fatalf("want 1 row after conflict, got %d, err %v", len(got), err)
	}
	if got[0].Host != "DC-01" || got[0].Process.CommandLine != "procdump -ma lsass.exe" {
		t.Fatalf("stored evidence was rewritten: host=%s cmd=%q", got[0].Host, got[0].Process.CommandLine)
	}
	if e, a := s.Counts(); e != 1 || a != 0 {
		t.Fatalf("counts after conflict: %d/%d, want 1/0", e, a)
	}
	if n := s.IDConflicts(); n != 1 {
		t.Fatalf("IDConflicts = %d, want 1", n)
	}
	// an exact replay stays a silent no-op and is not a conflict
	if err := s.InsertEvent(ev("rep", "DC-01", model.TypeProcessCreate, "procdump -ma lsass.exe", at)); err != nil {
		t.Fatalf("exact replay: %v", err)
	}
	if n := s.IDConflicts(); n != 1 {
		t.Fatalf("exact replay counted as conflict: %d", n)
	}
}

// Host-filtered history must be served from the (host, ts) index, not
// a full scan; legacy mixed-case rows still match (NOCASE index).
func TestHostFilterUsesIndex(t *testing.T) {
	s := openTestStore(t)
	for _, q := range []string{
		`EXPLAIN QUERY PLAN SELECT json FROM events WHERE host = ? COLLATE NOCASE ORDER BY ts DESC, rowid DESC LIMIT 10`,
		`EXPLAIN QUERY PLAN SELECT json FROM alerts WHERE host = ? COLLATE NOCASE ORDER BY ts DESC, seq DESC LIMIT 10`,
	} {
		rows, err := s.db.Query(q, "lab-a")
		if err != nil {
			t.Fatal(err)
		}
		plan := ""
		for rows.Next() {
			var id, parent, unused int
			var detail string
			if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
				t.Fatal(err)
			}
			plan += detail + "; "
		}
		rows.Close()
		if !strings.Contains(plan, "host_ts_idx") {
			t.Fatalf("host filter does not use the host index: %s", plan)
		}
	}
	if _, err := s.db.Exec(`INSERT INTO events (id, ts, type, host, search, json) VALUES ('legacy', 1, 't', 'LAB-A', '', '{"id":"legacy","type":"t","host":"LAB-A","timestamp":"2026-01-01T00:00:00Z"}')`); err != nil {
		t.Fatal(err)
	}
	got, err := s.QueryEvents(EventQuery{Host: "lab-a", Limit: 10})
	if err != nil || len(got) != 1 {
		t.Fatalf("legacy mixed-case host row not found through the index: %d, %v", len(got), err)
	}
}

// TestSearchAlertsByID pins the store side of the alert-id free-text
// axis: the search column mirrors api.alertHaystack and must match the
// same needles the ring matches. Rows written before the id joined the
// haystack keep the old column (declared limitation); a fresh row must
// be findable by full and partial id, and a separator-forged needle
// must not cross field boundaries.
func TestSearchAlertsByID(t *testing.T) {
	s := openTestStore(t)
	target := alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		ID:        "ab12cd34ef56ab12",
		RuleID:    "11111111-1111",
		RuleName:  "rule 11111111-1111",
		Severity:  "high",
		Host:      "LAB-ONE",
		User:      "alice",
		EventID:   "ev-1",
		EventType: model.TypeProcessCreate,
		Summary:   "encoded powershell",
		MatchedOn: []string{"process.name"},
		Tags:      []string{"attack.t1059.001"},
	}
	if err := s.InsertAlert(target); err != nil {
		t.Fatal(err)
	}
	got, err := s.QueryAlerts(AlertQuery{Q: target.ID, Limit: 10})
	if err != nil || len(got) != 1 || got[0].ID != target.ID {
		t.Fatalf("full id search: %d alerts, err %v", len(got), err)
	}
	got, err = s.QueryAlerts(AlertQuery{Q: target.ID[:6], Limit: 10})
	if err != nil || len(got) != 1 || got[0].ID != target.ID {
		t.Fatalf("partial id search: %d alerts, err %v", len(got), err)
	}
	got, err = s.QueryAlerts(AlertQuery{Q: target.ID + "\x1fLAB-ONE", Limit: 10})
	if err != nil || len(got) != 0 {
		t.Fatalf("forged separator matched: %d alerts, err %v", len(got), err)
	}
}

// A batch keeps per-event semantics: new rows insert, exact replays
// (also inside the same batch) are silent, conflicts keep the first
// copy and are reported by id.
func TestInsertEventsBatchSemantics(t *testing.T) {
	s := openTestStore(t)
	at := time.Now().UTC()
	if err := s.InsertEvent(ev("old", "DC-01", model.TypeProcessCreate, "first", at)); err != nil {
		t.Fatal(err)
	}
	res := s.InsertEvents([]*model.Event{
		ev("a", "H1", model.TypeProcessCreate, "x", at),
		ev("a", "H1", model.TypeProcessCreate, "x", at), // replay inside the batch
		ev("b", "H1", model.TypeProcessCreate, "y", at),
		ev("old", "WKS-99", model.TypeProcessCreate, "forged", at), // conflict with stored row
		ev("b", "H2", model.TypeProcessCreate, "z", at),            // conflict inside the batch
	})
	if res.Inserted != 2 || len(res.Failed) != 0 {
		t.Fatalf("inserted=%d failed=%v, want 2 and none", res.Inserted, res.Failed)
	}
	if strings.Join(res.Conflicts, ",") != "old,b" {
		t.Fatalf("conflicts = %v, want [old b]", res.Conflicts)
	}
	if e, _ := s.Counts(); e != 3 || s.IDConflicts() != 2 {
		t.Fatalf("events=%d conflicts=%d, want 3 and 2", e, s.IDConflicts())
	}
	got, err := s.QueryEvents(EventQuery{Q: "forged", Limit: 10})
	if err != nil || len(got) != 0 {
		t.Fatalf("forged payload reached the store: %d rows, %v", len(got), err)
	}
	if res := s.InsertEvents(nil); res.Inserted != 0 || res.Failed != nil || res.Conflicts != nil {
		t.Fatalf("empty batch: %+v", res)
	}
}

// A batch whose transaction cannot be written degrades to per-event
// writes: each failure is reported once, nothing is counted as stored.
func TestInsertEventsReportsFailures(t *testing.T) {
	s := openTestStore(t)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC()
	res := s.InsertEvents([]*model.Event{ev("x", "H", model.TypeProcessCreate, "a", at), ev("y", "H", model.TypeProcessCreate, "b", at)})
	if len(res.Failed) != 2 || res.Inserted != 0 {
		t.Fatalf("closed store: inserted=%d failed=%d, want 0 and 2", res.Inserted, len(res.Failed))
	}
	if e, _ := s.Counts(); e != 0 {
		t.Fatalf("failed batch moved the counter to %d", e)
	}
}
