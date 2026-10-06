package api

// AD-6 settings surface tests: the two-layer refusal (403 without
// -api-write, 501 without -ad), the strict body, the loader-parity
// validation BEFORE anything touches the disk, the drift 409, the
// commit (atomic YAML + SEC-2 credential envelope) with the hot-swap
// callback, and the "Probar conexión" verdict contract. The secret is
// asserted absent from every wire document and from the YAML: it may
// only live in its own envelope file.

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ad"
	"github.com/Ruby570bocadito/bluetardigrade/internal/secretfile"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

const (
	labStoredPassword = "stored-lab-password"
	brandNewPassword  = "brand-new-secret-42"
)

// writeADConfig lays down a valid -ad file plus a legacy raw
// credential (the POSIX lab format the connector still accepts) and
// returns their paths.
func writeADConfig(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "ad.yaml")
	pwPath := filepath.Join(dir, "ad-bind.secret")
	cfg := ad.Config{
		Server:       "dc01.corp.example.invalid",
		Port:         636,
		BaseDN:       "DC=corp,DC=example,DC=invalid",
		CAFile:       filepath.Join(dir, "ca.pem"),
		BindDN:       "CN=soc-ro,DC=corp,DC=example,DC=invalid",
		PasswordFile: pwPath,
		Interval:     15 * time.Minute,
	}
	if err := cfg.WriteFile(cfgPath); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if err := os.WriteFile(pwPath, []byte(labStoredPassword+"\n"), 0o600); err != nil {
		t.Fatalf("write legacy credential: %v", err)
	}
	return cfgPath, pwPath
}

func armWrites(h *Hub) {
	h.mu.Lock()
	h.writeEnabled = true
	h.mu.Unlock()
}

func armADConnector(t *testing.T, h *Hub, cfgPath string) *store.Store {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "ad-api-test.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	cfg, err := ad.Load(cfgPath)
	if err != nil {
		t.Fatalf("ad.Load: %v", err)
	}
	conn, err := ad.New(cfg, st, log.New(io.Discard, "", 0), nil)
	if err != nil {
		t.Fatalf("ad.New: %v", err)
	}
	h.SetAD(conn)
	return st
}

func doJSON(t *testing.T, method, url, body string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return res, string(raw)
}

func TestADSettingsForbiddenWithoutWriteFlag(t *testing.T) {
	_, addr := newTestHub(t)
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/settings/ad"},
		{"PUT", "/api/settings/ad"},
		{"POST", "/api/ad/test"},
	} {
		req, _ := http.NewRequest(tc.method, "http://"+addr+tc.path, strings.NewReader("{}"))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", tc.method, tc.path, err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("%s %s: status %d, want 403 (the admin write gate answers loudest)", tc.method, tc.path, res.StatusCode)
		}
	}
}

func TestADSettingsNotArmedWithoutAD(t *testing.T) {
	h, addr := newTestHub(t)
	armWrites(h)
	res, raw := doJSON(t, "GET", "http://"+addr+"/api/settings/ad", "")
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotImplemented {
		t.Fatalf("GET: status %d, want 501 (feature off, like the rest of /api/ad)", res.StatusCode)
	}
	if !strings.Contains(raw, "-ad") {
		t.Fatalf("501 body must carry the arming hint: %s", raw)
	}
	res2, _ := doJSON(t, "PUT", "http://"+addr+"/api/settings/ad", `{"inactive_days": 60}`)
	defer res2.Body.Close()
	if res2.StatusCode != http.StatusNotImplemented {
		t.Fatalf("PUT: status %d, want 501 without -ad", res2.StatusCode)
	}
	// The TEST route is usable without -ad: a complete-but-invalid
	// request answers 400 (validation), never the 501 of a family it
	// does not belong to.
	res3, _ := doJSON(t, "POST", "http://"+addr+"/api/ad/test", `{}`)
	defer res3.Body.Close()
	if res3.StatusCode != http.StatusBadRequest {
		t.Fatalf("POST test: status %d, want 400 (the empty candidate cannot validate)", res3.StatusCode)
	}
}

func TestADSettingsGetServesEffectiveConfigWithoutSecret(t *testing.T) {
	h, addr := newTestHub(t)
	cfgPath, pwPath := writeADConfig(t)
	armWrites(h)
	armADConnector(t, h, cfgPath)
	h.SetADSettings(cfgPath, func(*ad.Config) error { return nil })

	res, raw := doJSON(t, "GET", "http://"+addr+"/api/settings/ad", "")
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET: status %d", res.StatusCode)
	}
	if strings.Contains(raw, labStoredPassword) {
		t.Fatalf("the GET response carries the credential value: %s", raw)
	}
	var got adSettingsWire
	if err := json.Unmarshal([]byte(raw), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Server != "dc01.corp.example.invalid" || got.Port != 636 {
		t.Fatalf("unexpected config echo: %+v", got)
	}
	if !got.PasswordStored {
		t.Fatalf("password_stored=false while the credential file exists")
	}
	if got.PasswordFile != pwPath {
		t.Fatalf("password_file %q, want %q", got.PasswordFile, pwPath)
	}
	if got.IntervalSeconds != 900 {
		t.Fatalf("interval_seconds %d, want 900", got.IntervalSeconds)
	}
	if got.ReloadPending {
		t.Fatalf("reload_pending true with no reload ever started")
	}
}

func TestADSettingsPutCommitsAndHotSwaps(t *testing.T) {
	h, addr := newTestHub(t)
	cfgPath, pwPath := writeADConfig(t)
	armWrites(h)
	armADConnector(t, h, cfgPath)
	reloads := make(chan *ad.Config, 4)
	h.SetADSettings(cfgPath, func(cfg *ad.Config) error {
		c := *cfg
		reloads <- &c
		return nil
	})

	body := `{"interval_seconds": 900, "inactive_days": 60, "work_start": "08:00", "work_end": "18:00", "password": "` + brandNewPassword + `"}`
	res, raw := doJSON(t, "PUT", "http://"+addr+"/api/settings/ad", body)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("PUT: status %d: %s", res.StatusCode, raw)
	}
	if !strings.Contains(raw, `"reload_pending":true`) {
		t.Fatalf("PUT response must report the pending swap: %s", raw)
	}
	if strings.Contains(raw, brandNewPassword) {
		t.Fatalf("the PUT response echoes the credential value")
	}

	select {
	case cfg := <-reloads:
		if cfg.Interval != 900*time.Second {
			t.Fatalf("hot-swap config interval %s, want 15m", cfg.Interval)
		}
		if cfg.InactiveDays != 60 {
			t.Fatalf("hot-swap config inactive_days %d, want 60", cfg.InactiveDays)
		}
		if cfg.WorkStart != "08:00" || cfg.WorkEnd != "18:00" {
			t.Fatalf("hot-swap config work window wrong: %+v", cfg)
		}
		// The weekday default lands with the commit: the FILE carries the
		// effective (normalized) values, the callback candidate the raw ones.
	case <-time.After(2 * time.Second):
		t.Fatalf("the hot-swap callback never ran")
	}

	loaded, err := ad.Load(cfgPath)
	if err != nil {
		t.Fatalf("the committed file must load with the strict loader: %v", err)
	}
	if loaded.InactiveDays != 60 {
		t.Fatalf("committed inactive_days %d, want 60", loaded.InactiveDays)
	}
	rawYAML, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if strings.Contains(string(rawYAML), brandNewPassword) || strings.Contains(string(rawYAML), labStoredPassword) {
		t.Fatalf("the YAML carries a credential: the secret must never share the config file")
	}
	if len(loaded.WorkDays) != 5 || loaded.WorkDays[0] != 1 || loaded.WorkDays[4] != 5 {
		t.Fatalf("the committed file must round-trip the normalized Mon-Fri default, got %v", loaded.WorkDays)
	}
	stored, warns, err := secretfile.Read(pwPath)
	if err != nil {
		t.Fatalf("the committed credential envelope must read back: %v", err)
	}
	if string(stored) != brandNewPassword {
		t.Fatalf("stored credential %q, want the new one", string(stored))
	}
	for _, w := range warns {
		_ = w // advisory only
	}

	// The commit re-baselines the drift sum: the next PUT must NOT trip
	// the 409 the engine's own write would otherwise cause.
	res2, raw2 := doJSON(t, "PUT", "http://"+addr+"/api/settings/ad", `{"inactive_days": 61}`)
	defer res2.Body.Close()
	if res2.StatusCode != http.StatusOK {
		t.Fatalf("second PUT: status %d: %s (the engine's own write must not look like drift)", res2.StatusCode, raw2)
	}
}

func TestADSettingsPutRejectsInvalidBeforeDisk(t *testing.T) {
	h, addr := newTestHub(t)
	cfgPath, pwPath := writeADConfig(t)
	armWrites(h)
	armADConnector(t, h, cfgPath)
	called := make(chan *ad.Config, 1)
	h.SetADSettings(cfgPath, func(*ad.Config) error {
		called <- nil
		return nil
	})

	// interval 60s is below the 5m floor: rejected with the loader's own
	// words, and NOTHING lands — not the file, not the credential, not
	// the hot swap.
	body := `{"interval_seconds": 60, "password": "should-never-land"}`
	res, raw := doJSON(t, "PUT", "http://"+addr+"/api/settings/ad", body)
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("PUT: status %d, want 400: %s", res.StatusCode, raw)
	}
	if !strings.Contains(raw, "minimum") {
		t.Fatalf("400 body should carry the loader's validation message: %s", raw)
	}
	select {
	case <-called:
		t.Fatalf("the hot-swap callback ran for a REJECTED config")
	case <-time.After(200 * time.Millisecond):
	}
	stored, _, err := secretfile.Read(pwPath)
	if err != nil || string(stored) != labStoredPassword {
		t.Fatalf("a rejected PUT must not rewrite the credential (got %q, %v)", string(stored), err)
	}
}

func TestADSettingsPutDriftConflict(t *testing.T) {
	h, addr := newTestHub(t)
	cfgPath, _ := writeADConfig(t)
	armWrites(h)
	armADConnector(t, h, cfgPath)
	called := make(chan *ad.Config, 1)
	h.SetADSettings(cfgPath, func(*ad.Config) error {
		called <- nil
		return nil
	})

	// A hand edit after the engine loaded the file: the API refuses to
	// clobber it (the suppression-file contract, applied to -ad).
	f, err := os.OpenFile(cfgPath, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatalf("open for hand edit: %v", err)
	}
	if _, err := f.WriteString("\n# hand edit by the operator\n"); err != nil {
		t.Fatalf("hand edit: %v", err)
	}
	f.Close()

	res, _ := doJSON(t, "PUT", "http://"+addr+"/api/settings/ad", `{"inactive_days": 61}`)
	defer res.Body.Close()
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("PUT over a drifted file: status %d, want 409", res.StatusCode)
	}
	select {
	case <-called:
		t.Fatalf("a drifted file must not reach the hot swap")
	case <-time.After(200 * time.Millisecond):
	}
}

func TestADSettingsPutUnknownFieldRejected(t *testing.T) {
	h, addr := newTestHub(t)
	cfgPath, _ := writeADConfig(t)
	armWrites(h)
	armADConnector(t, h, cfgPath)
	h.SetADSettings(cfgPath, func(*ad.Config) error { return nil })

	res, _ := doJSON(t, "PUT", "http://"+addr+"/api/settings/ad", `{"bogus_field": true}`)
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("PUT with an unknown field: status %d, want 400 (a typo must change nothing silently)", res.StatusCode)
	}
}

func TestADSettingsReloadErrorSurfaces(t *testing.T) {
	h, addr := newTestHub(t)
	cfgPath, _ := writeADConfig(t)
	armWrites(h)
	armADConnector(t, h, cfgPath)
	h.SetADSettings(cfgPath, func(*ad.Config) error {
		return os.ErrPermission
	})

	res, _ := doJSON(t, "PUT", "http://"+addr+"/api/settings/ad", `{"inactive_days": 61}`)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("PUT: status %d (the commit succeeds; the swap failure surfaces in the bookkeeping)", res.StatusCode)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		res2, raw2 := doJSON(t, "GET", "http://"+addr+"/api/settings/ad", "")
		if res2.StatusCode != http.StatusOK {
			t.Fatalf("GET while polling: status %d", res2.StatusCode)
		}
		var got adSettingsWire
		if err := json.Unmarshal([]byte(raw2), &got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		res2.Body.Close()
		if !got.ReloadPending {
			if got.LastReloadError == "" {
				t.Fatalf("the reload failure must surface in last_reload_error")
			}
			if !strings.Contains(got.LastReloadError, "applies on restart") {
				t.Fatalf("last_reload_error %q must say the committed config applies on restart", got.LastReloadError)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("reload never finished: still pending after 2s")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestADTestContractWithoutConnector(t *testing.T) {
	h, addr := newTestHub(t)
	armWrites(h)

	// A full candidate with an unreachable CA: the probe RUNS and the
	// verdict is ok=false — a failed connection is a successful test.
	body := `{"server": "dc01.corp.example.invalid", "port": 636, "base_dn": "DC=corp,DC=example,DC=invalid", "bind_dn": "CN=x,DC=corp,DC=example,DC=invalid", "ca_file": "/nonexistent/ca.pem", "password_file": "/nonexistent/ad-bind.secret", "password": "probe-pw-value"}`
	res, raw := doJSON(t, "POST", "http://"+addr+"/api/ad/test", body)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("POST test: status %d: %s", res.StatusCode, raw)
	}
	if strings.Contains(raw, "probe-pw-value") {
		t.Fatalf("the test response echoes the credential value")
	}
	var got ad.ProbeResult
	if err := json.Unmarshal([]byte(raw), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.OK {
		t.Fatalf("probe ok with a nonexistent CA file")
	}
	if got.Error == "" || got.DurationMS < 0 {
		t.Fatalf("verdict incomplete: %+v", got)
	}

	// Without -ad there is no stored credential: a password-less probe
	// is refused BEFORE any dial (no anonymous binds, ever).
	body2 := `{"server": "dc01.corp.example.invalid", "port": 636, "base_dn": "DC=corp,DC=example,DC=invalid", "bind_dn": "CN=x,DC=corp,DC=example,DC=invalid", "ca_file": "/nonexistent/ca.pem", "password_file": "/nonexistent/ad-bind.secret"}`
	res2, _ := doJSON(t, "POST", "http://"+addr+"/api/ad/test", body2)
	defer res2.Body.Close()
	if res2.StatusCode != http.StatusBadRequest {
		t.Fatalf("POST test without a password: status %d, want 400", res2.StatusCode)
	}
}

func TestADTestUsesStoredCredentialWhenArmed(t *testing.T) {
	h, addr := newTestHub(t)
	cfgPath, _ := writeADConfig(t)
	armWrites(h)
	armADConnector(t, h, cfgPath)
	h.SetADSettings(cfgPath, func(*ad.Config) error { return nil })

	// Armed: the candidate inherits the armed config and its stored
	// legacy credential; the probe runs (CA file is missing, so the
	// verdict is ok=false) and nothing is stored by the test route.
	res, raw := doJSON(t, "POST", "http://"+addr+"/api/ad/test", `{}`)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("POST test: status %d: %s", res.StatusCode, raw)
	}
	if strings.Contains(raw, labStoredPassword) {
		t.Fatalf("the test response carries the stored credential value")
	}
	var got ad.ProbeResult
	if err := json.Unmarshal([]byte(raw), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.OK {
		t.Fatalf("probe ok with a missing CA file")
	}
	if got.BindDN != "CN=soc-ro,DC=corp,DC=example,DC=invalid" {
		t.Fatalf("probe bind_dn %q, want the armed config's", got.BindDN)
	}
}
