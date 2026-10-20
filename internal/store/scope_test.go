package store

import (
	"context"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestScopedQueriesAndHosts(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "sf.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now()
	for i, host := range []string{"PC-MAD-01", "pc-mad-01", "pc-bcn-02", "srv-01"} {
		ev := &model.Event{ID: "e" + string(rune('a'+i)), Type: "process_start", Host: host, Timestamp: now.Add(time.Duration(i) * time.Second)}
		if err := s.InsertEvent(ev); err != nil {
			t.Fatal(err)
		}
		a := alert.Alert{ID: "000000000000000" + string(rune('a'+i)), RuleID: "r", Host: host, Severity: "high", Timestamp: now.Format(time.RFC3339Nano)}
		if err := s.InsertAlert(a); err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	hosts, err := s.Hosts(ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	lower := []string{}
	for _, h := range hosts {
		lower = append(lower, strings.ToLower(h))
	}
	sort.Strings(lower)
	if strings.Join(lower, ",") != "pc-bcn-02,pc-mad-01,srv-01" {
		t.Fatalf("hosts = %v", hosts)
	}
	if got, _ := s.Hosts(ctx, 2); len(got) != 2 {
		t.Fatalf("limit ignored: %v", got)
	}

	evs, err := s.QueryEvents(EventQuery{Scoped: true, HostIn: []string{"pc-mad-01"}, Limit: 10})
	if err != nil || len(evs) != 2 {
		t.Fatalf("scoped events = %d, %v (both spellings expected)", len(evs), err)
	}
	if evs, _ := s.QueryEvents(EventQuery{Scoped: true, Limit: 10}); len(evs) != 0 {
		t.Fatalf("an empty scope must match nothing, got %d", len(evs))
	}
	if evs, _ := s.QueryEvents(EventQuery{Limit: 10}); len(evs) != 4 {
		t.Fatalf("unscoped events = %d", len(evs))
	}
	als, err := s.QueryAlerts(AlertQuery{Scoped: true, HostIn: []string{"SRV-01", "pc-bcn-02"}, Limit: 10})
	if err != nil || len(als) != 2 {
		t.Fatalf("scoped alerts = %d, %v", len(als), err)
	}
	page, err := s.QueryAlertPage(ctx, AlertQuery{Scoped: true, HostIn: []string{"srv-01"}, Limit: 10}, 0, 1<<40)
	if err != nil || len(page) != 1 || page[0].Alert.Host != "srv-01" {
		t.Fatalf("scoped page = %+v, %v", page, err)
	}

	a, ok, err := s.AlertByID(ctx, "000000000000000c")
	if err != nil || !ok || a.Host != "pc-bcn-02" {
		t.Fatalf("alert by id = %+v %v %v", a, ok, err)
	}
	if _, ok, err := s.AlertByID(ctx, "ffffffffffffffff"); err != nil || ok {
		t.Fatalf("unknown id: %v %v", ok, err)
	}
}

func TestHostsAndAlertByIDUseIndexes(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "sf.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for query, want := range map[string]string{
		`SELECT host FROM events WHERE host > 'a' COLLATE NOCASE ORDER BY host COLLATE NOCASE LIMIT 1`: "events_host_ts_idx",
		`SELECT json FROM alerts WHERE ` + alertIDExpr + ` = 'x'`:                                      "alerts_id_idx",
		`SELECT json FROM alerts WHERE host COLLATE NOCASE IN ('a','b') ORDER BY ts DESC`:              "alerts_host_ts_idx",
	} {
		rows, err := s.db.Query("EXPLAIN QUERY PLAN " + query)
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
			plan += detail + "\n"
		}
		rows.Close()
		if !strings.Contains(plan, want) {
			t.Errorf("%s\nplan does not use %s:\n%s", query, want, plan)
		}
	}
}

func TestAlertIDIndexToleratesUnreadableRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sf.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.InsertAlert(alert.Alert{ID: "00000000000000aa", Host: "pc-1"}); err != nil {
		t.Fatal(err)
	}
	// a damaged row from an older engine: the index (re)build and the
	// lookup must both survive it
	if _, err := s.db.Exec(`DROP INDEX alerts_id_idx; INSERT INTO alerts (ts, json) VALUES (1, 'not json')`); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if s, err = Open(path); err != nil {
		t.Fatalf("a damaged row stopped the store from opening: %v", err)
	}
	defer s.Close()
	a, ok, err := s.AlertByID(context.Background(), "00000000000000aa")
	if err != nil || !ok || a.Host != "pc-1" {
		t.Fatalf("lookup next to a damaged row = %+v %v %v", a, ok, err)
	}
}
