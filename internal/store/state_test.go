package store

import (
	"path/filepath"
	"testing"
	"time"
)

func TestFleetDocumentsRoundTripAndUpsert(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.SaveFleetHosts(map[string][]byte{"PC-01": []byte(`{"v":1}`), "pc-02": []byte(`{"v":2}`)}); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveFleetHosts(map[string][]byte{"pc-01": []byte(`{"v":3}`)}); err != nil {
		t.Fatal(err)
	}
	got, err := st.LoadFleetHosts()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || string(got["pc-01"]) != `{"v":3}` || string(got["pc-02"]) != `{"v":2}` {
		t.Fatalf("fleet docs: %q", got)
	}
	if err := st.DeleteFleetHosts([]string{"PC-02"}); err != nil {
		t.Fatal(err)
	}
	if got, _ := st.LoadFleetHosts(); len(got) != 1 {
		t.Fatalf("delete: %q", got)
	}
}

func TestBaselineKeepsTheFirstSighting(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.db")
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t0 := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	if err := st.AddBaseline([]BaselineEntry{{Host: "PC-01", Kind: "process", Value: "excel.exe", FirstSeen: t0}}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddBaseline([]BaselineEntry{{Host: "pc-01", Kind: "process", Value: "excel.exe", FirstSeen: t0.Add(time.Hour)}, {Host: "pc-01", Kind: "process", Value: "rclone.exe", FirstSeen: t0.Add(2 * time.Hour)}}); err != nil {
		t.Fatal(err)
	}
	st.Close()
	st, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	entries, hosts, err := st.LoadBaseline()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || !hosts["pc-01"].Equal(t0) {
		t.Fatalf("baseline: %+v hosts %+v", entries, hosts)
	}
	for _, e := range entries {
		if e.Value == "excel.exe" && !e.FirstSeen.Equal(t0) {
			t.Fatalf("first sighting overwritten: %v", e.FirstSeen)
		}
	}
}
