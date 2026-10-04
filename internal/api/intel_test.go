package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/baseline"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestIntelEndpointWithoutLists(t *testing.T) {
	_, addr := newTestHub(t)
	var out intelPayload
	getJSON(t, fmt.Sprintf("http://%s/api/intel", addr), &out)
	if out.Enabled || out.Total != 0 || out.Lists == nil || out.Baseline.Enabled {
		t.Fatalf("payload: %+v", out)
	}
}

func TestIntelEndpointListsFilesAndBaseline(t *testing.T) {
	h, addr := newTestHub(t)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "bloqueo.txt"), []byte("# lista local\n203.0.113.7\n198.51.100.0/24\nmal.example.com\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := intel.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	h.SetIntel(m)
	b := baseline.New(24 * time.Hour)
	b.Observe(&model.Event{Host: "PC-01", Type: model.TypeProcessCreate, Process: &model.Process{Name: "excel.exe"}}, time.Now())
	h.SetBaseline(b)
	var out intelPayload
	getJSON(t, fmt.Sprintf("http://%s/api/intel", addr), &out)
	if !out.Enabled || out.Total != 3 || len(out.Lists) != 1 || out.Lists[0].Name != "bloqueo" {
		t.Fatalf("lists: %+v", out)
	}
	if out.Lists[0].ByKind["cidr"] != 1 || out.Lists[0].ByKind["domain"] != 1 {
		t.Fatalf("by kind: %+v", out.Lists[0].ByKind)
	}
	if !out.Baseline.Enabled || out.Baseline.LearnS != 86400 || out.Baseline.Hosts != 1 || out.Baseline.Learning != 1 {
		t.Fatalf("baseline: %+v", out.Baseline)
	}
}

func TestBaselineHostEndpoint(t *testing.T) {
	h, addr := newTestHub(t)
	res, err := http.Get(fmt.Sprintf("http://%s/api/baseline", addr))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing host: %d", res.StatusCode)
	}
	var out baselineHostPayload
	getJSON(t, fmt.Sprintf("http://%s/api/baseline?host=PC-01", addr), &out)
	if out.Known || out.Enabled || out.Processes == nil {
		t.Fatalf("without a baseline: %+v", out)
	}
	b := baseline.New(time.Hour)
	b.Observe(&model.Event{Host: "PC-01", Type: model.TypeProcessCreate, Process: &model.Process{Name: "excel.exe"}}, time.Now())
	h.SetBaseline(b)
	getJSON(t, fmt.Sprintf("http://%s/api/baseline?host=pc-01", addr), &out)
	if !out.Known || !out.Learning || out.LearningUntil == nil || out.FirstSeen == nil || len(out.Processes) != 1 || out.Processes[0] != "excel.exe" {
		t.Fatalf("known host: %+v", out)
	}
}
