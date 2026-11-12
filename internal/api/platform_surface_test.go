package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/hostgroup"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/scenrun"
)

// The scenario battery is a platform surface: an account limited to
// host groups neither reads it nor launches a run.
func TestScenarioRoutesRefuseAScopedCaller(t *testing.T) {
	_, addr := newScenarioHub(t)
	base := "http://" + addr
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/scenarios"},
		{"POST", "/api/scenarios/run"},
		{"GET", "/api/scenarios/runs"},
		{"GET", "/api/scenarios/runs/run-0123456789abcdef"},
	} {
		if code, body := scoped(t, tc.method, base+tc.path, ptr("madrid"), ""); code != http.StatusForbidden {
			t.Errorf("%s %s scoped: %d %s, want 403", tc.method, tc.path, code, body)
		}
	}
	code, body := scoped(t, "GET", base+"/api/scenarios/runs", nil, "")
	if code != http.StatusOK || strings.Contains(body, `"id"`) {
		t.Fatalf("a refused POST must not have started a run: %d %s", code, body)
	}
	if code, _ := scoped(t, "GET", base+"/api/scenarios", nil, ""); code != http.StatusOK {
		t.Fatalf("unscoped library: %d, want 200", code)
	}
}

// A scoped caller learns that active response is armed and nothing
// about the engine host behind it.
func TestRespondStateHidesThePlatformFromAScopedCaller(t *testing.T) {
	addr, auditPath := armedRespondReadHub(t)
	code, body := scoped(t, "GET", "http://"+addr+"/api/respond/state", ptr("madrid"), "")
	if code != http.StatusOK {
		t.Fatalf("scoped state: %d %s", code, body)
	}
	var got respondStatePayload
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Armed || got.Signal == "" {
		t.Errorf("a scoped caller must still see the surface armed: %+v", got)
	}
	if got.AuditPath != "" || got.OperatorsPath != "" || got.OperatorsCount != 0 || got.AuditCeiling != 0 {
		t.Errorf("platform detail served to a scoped caller: %+v", got)
	}
	if strings.Contains(body, filepath.Base(filepath.Dir(auditPath))) {
		t.Errorf("a path of the engine host reached a scoped caller: %s", body)
	}
	_, body = scoped(t, "GET", "http://"+addr+"/api/respond/state", nil, "")
	if err := json.Unmarshal([]byte(body), &got); err != nil || got.AuditPath != auditPath || got.OperatorsCount != 1 {
		t.Errorf("unscoped state lost its detail: %s", body)
	}
}

// A failure on the engine host is a fixed body for the client and a
// line in the engine log: the error text names local files.
func TestServerSideFailuresDoNotNameLocalPaths(t *testing.T) {
	leaks := func(t *testing.T, what, body, dir string) {
		t.Helper()
		for _, needle := range []string{dir, filepath.Base(dir), strings.ReplaceAll(dir, `\`, `\\`)} {
			if strings.Contains(body, needle) {
				t.Errorf("%s: the body names a local path (%q): %s", what, needle, body)
			}
		}
	}

	t.Run("respond audit", func(t *testing.T) {
		h, addr := newTestHub(t)
		_, auditPath := armedRespondReadHubOn(t, h)
		dir := t.TempDir() // the audit file went missing under the engine
		h.SetRespondPaths("", "", filepath.Join(dir, "gone.jsonl"))
		code, body := scoped(t, "GET", "http://"+addr+"/api/respond/audit", nil, "")
		if code != http.StatusInternalServerError {
			t.Fatalf("status %d %s (audit %s), want 500", code, body, auditPath)
		}
		leaks(t, "respond audit", body, dir)
	})

	t.Run("scenario library", func(t *testing.T) {
		h, addr := newTestHub(t)
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "broken.yaml"), []byte("id: [unterminated\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		e, err := rules.LoadDir(filepath.Join("..", "..", "rules"))
		if err != nil {
			t.Fatal(err)
		}
		h.SetScenarios(scenrun.New(dir, "", scenrun.Deps{Rules: func() *rules.Engine { return e }}))
		for _, tc := range []struct{ method, path string }{
			{"GET", "/api/scenarios"},
			{"POST", "/api/scenarios/run"},
		} {
			code, body := scoped(t, tc.method, "http://"+addr+tc.path, nil, "")
			if code != http.StatusInternalServerError {
				t.Fatalf("%s %s: status %d %s, want 500", tc.method, tc.path, code, body)
			}
			leaks(t, tc.path, body, dir)
		}
	})

	t.Run("host groups", func(t *testing.T) {
		h, addr := newTestHub(t)
		armWrites(h)
		dir := t.TempDir() // a directory where the groups file should be
		set, err := hostgroup.Parse([]byte(groupsDoc))
		if err != nil {
			t.Fatal(err)
		}
		h.SetHostGroups(dir, set, [32]byte{})
		res, body := doJSON(t, "PUT", "http://"+addr+"/api/settings/groups", `{"groups":[]}`)
		if res.StatusCode != http.StatusInternalServerError {
			t.Fatalf("status %d %s, want 500", res.StatusCode, body)
		}
		leaks(t, "host groups", body, dir)
	})
}
