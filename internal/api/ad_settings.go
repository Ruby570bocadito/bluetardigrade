// AD-6/SET-1 (engine side): the settings surface of the Active
// Directory connector. Three routes, all admin business:
//
//   GET  /api/settings/ad   the effective configuration (the credential
//                           is NEVER part of it — it lives in its own
//                           secretfile envelope and is never read back)
//   PUT  /api/settings/ad   validate -> commit (atomic YAML + optional
//                           credential write) -> hot-swap the connector;
//                           409 when the -ad file drifted on disk
//   POST /api/ad/test       the "Probar conexión" button: one bounded,
//                           read-only probe (bind + per-kind sample) of
//                           a candidate configuration; stores nothing
//
// Contract: the whole surface sits behind -api-write (the same 403 the
// suppression writes answer) because the engine's single bearer token
// has no role model — arming writes IS the admin gate. GET/PUT
// additionally demand the surface to be armed (-ad); the TEST route is
// usable without -ad so an operator can validate a configuration
// BEFORE restarting the engine with it. Every committed change leaves
// one audit line in the engine log, password redacted by absence: the
// value is never logged, echoed, or stored in the YAML.

package api

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ad"
	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
	"github.com/Ruby570bocadito/bluetardigrade/internal/secretfile"
)

// adSettingsMaxBodyBytes caps the PUT /api/settings/ad and
// POST /api/ad/test request bodies: a settings object is a handful of
// short fields, not a data channel (same rationale and limit as the
// triage and suppression writes).
const adSettingsMaxBodyBytes = 8192

// adReloadRecord is the immutable bookkeeping of the last hot reload
// attempt (served by GET; replaced atomically, never mutated).
type adReloadRecord struct {
	At    time.Time
	Error string
}

// SetADSettings arms the AD-6 surface: the -ad config file path the
// surface reads and rewrites, and the engine callback that hot-swaps
// the connector after a committed change. Arming opens nothing by
// itself: the handlers still demand -api-write. The drift baseline is
// the sha256 of the file AS THE ENGINE LOADED IT — a hand edit after
// startup must be reconciled by a human, never clobbered by a PUT
// (the same contract the suppression file follows).
func (h *Hub) SetADSettings(path string, reconfigure func(*ad.Config) error) {
	h.mu.Lock()
	h.adSettingsPath = path
	h.adReconfigure = reconfigure
	h.mu.Unlock()
	raw, err := os.ReadFile(path)
	if err != nil {
		log.Printf("[API] ad-settings: armed without drift baseline (config unreadable): %v", err)
		return
	}
	h.mu.Lock()
	h.adConfigSum = sha256.Sum256(raw)
	h.mu.Unlock()
}

// adSettingsGate applies the two-layer refusal, loudest first: 403
// when the engine runs without -api-write (a non-admin probe learns
// nothing about the connector, not even whether -ad is on), then 501
// when the surface is not armed (-ad absent: the feature exists but
// is off — the same 501 contract as the rest of /api/ad).
func (h *Hub) adSettingsGate(w http.ResponseWriter, needArmed bool) bool {
	h.mu.Lock()
	writeOK, path := h.writeEnabled, h.adSettingsPath
	h.mu.Unlock()
	if !writeOK {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		fmt.Fprintln(w, `{"error":"api writes are disabled: restart the engine with -api-write (or SF_API_WRITE=1) to allow Active Directory settings"}`)
		return false
	}
	if needArmed && path == "" {
		h.adOffJSON(w)
		return false
	}
	return true
}

// adSettingsWire is the GET/PUT response: the effective configuration
// minus the credential (never read back), the presence of its two
// file-backed resources (content never served), and the reload
// bookkeeping.
type adSettingsWire struct {
	Server           string   `json:"server"`
	Port             int      `json:"port"`
	StartTLS         bool     `json:"start_tls"`
	BaseDN           string   `json:"base_dn"`
	CAFile           string   `json:"ca_file"`
	CAFilePresent    bool     `json:"ca_file_present"`
	BindDN           string   `json:"bind_dn"`
	PasswordFile     string   `json:"password_file"`
	PasswordStored   bool     `json:"password_stored"`
	IntervalSeconds  int      `json:"interval_seconds"`
	IncludeOUs       []string `json:"include_ous"`
	ExcludeOUs       []string `json:"exclude_ous"`
	MaxObjects       int      `json:"max_objects"`
	PageSize         int      `json:"page_size"`
	InactiveDays     int      `json:"inactive_days"`
	KrbtgtMaxAgeDays int      `json:"krbtgt_max_age_days"`
	WorkStart        string   `json:"work_start"`
	WorkEnd          string   `json:"work_end"`
	WorkDays         []int    `json:"work_days"`
	ReloadPending    bool     `json:"reload_pending"`
	LastReloadAt     string   `json:"last_reload_at,omitempty"`
	LastReloadError  string   `json:"last_reload_error,omitempty"`
}

// adWireFromConfig renders the wire document from a config COPY. The
// presence booleans are filesystem facts at serving time, not cached
// state — a CA or credential deployed between two GETs shows up.
func adWireFromConfig(cfg *ad.Config) *adSettingsWire {
	ous := func(in []string) []string {
		out := []string{}
		out = append(out, in...)
		return out
	}
	days := []int{}
	days = append(days, cfg.WorkDays...)
	out := &adSettingsWire{
		Server:           cfg.Server,
		Port:             cfg.Port,
		StartTLS:         cfg.StartTLS,
		BaseDN:           cfg.BaseDN,
		CAFile:           cfg.CAFile,
		BindDN:           cfg.BindDN,
		PasswordFile:     cfg.PasswordFile,
		IntervalSeconds:  int(cfg.Interval / time.Second),
		IncludeOUs:       ous(cfg.IncludeOUs),
		ExcludeOUs:       ous(cfg.ExcludeOUs),
		MaxObjects:       cfg.MaxObjects,
		PageSize:         cfg.PageSize,
		InactiveDays:     cfg.InactiveDays,
		KrbtgtMaxAgeDays: cfg.KrbtgtMaxAgeDays,
		WorkStart:        cfg.WorkStart,
		WorkEnd:          cfg.WorkEnd,
		WorkDays:         days,
	}
	if cfg.CAFile != "" {
		if _, err := os.Stat(cfg.CAFile); err == nil {
			out.CAFilePresent = true
		}
	}
	if cfg.PasswordFile != "" {
		if _, err := os.Stat(cfg.PasswordFile); err == nil {
			out.PasswordStored = true
		}
	}
	return out
}

// handleADSettingsGet serves GET /api/settings/ad.
func (h *Hub) handleADSettingsGet(w http.ResponseWriter, _ *http.Request) {
	if !h.adSettingsGate(w, true) {
		return
	}
	c := h.adConnector()
	if c == nil {
		h.adOffJSON(w)
		return
	}
	cfg := c.Config() // value copy; the secret is not part of Config
	out := adWireFromConfig(&cfg)
	out.ReloadPending = h.adReloadPending.Load()
	if rec := h.adReloadRecord.Load(); rec != nil {
		out.LastReloadAt = rec.At.UTC().Format(time.RFC3339)
		out.LastReloadError = rec.Error
	}
	writeJSON(w, out)
}

// adSettingsUpdate is the PUT and test body: every field optional, a
// present field REPLACES the current value (the merge is explicit —
// no deep-comparison surprises), plus the write-only password.
type adSettingsUpdate struct {
	Server           *string   `json:"server"`
	Port             *int      `json:"port"`
	StartTLS         *bool     `json:"start_tls"`
	BaseDN           *string   `json:"base_dn"`
	CAFile           *string   `json:"ca_file"`
	BindDN           *string   `json:"bind_dn"`
	PasswordFile     *string   `json:"password_file"`
	Password         *string   `json:"password"`
	IntervalSeconds  *int      `json:"interval_seconds"`
	IncludeOUs       *[]string `json:"include_ous"`
	ExcludeOUs       *[]string `json:"exclude_ous"`
	MaxObjects       *int      `json:"max_objects"`
	PageSize         *int      `json:"page_size"`
	InactiveDays     *int      `json:"inactive_days"`
	KrbtgtMaxAgeDays *int      `json:"krbtgt_max_age_days"`
	WorkStart        *string   `json:"work_start"`
	WorkEnd          *string   `json:"work_end"`
	WorkDays         *[]int    `json:"work_days"`
}

// apply merges the update into base and returns the changed field
// names (the audit line lists WHAT changed, never secret values).
func (u *adSettingsUpdate) apply(base *ad.Config) []string {
	var changed []string
	note := func(f string) { changed = append(changed, f) }
	trim := func(s string) string { return strings.TrimSpace(s) }
	if u.Server != nil {
		base.Server = trim(*u.Server)
		note("server")
	}
	if u.Port != nil {
		base.Port = *u.Port
		note("port")
	}
	if u.StartTLS != nil {
		base.StartTLS = *u.StartTLS
		note("start_tls")
	}
	if u.BaseDN != nil {
		base.BaseDN = trim(*u.BaseDN)
		note("base_dn")
	}
	if u.CAFile != nil {
		base.CAFile = trim(*u.CAFile)
		note("ca_file")
	}
	if u.BindDN != nil {
		base.BindDN = trim(*u.BindDN)
		note("bind_dn")
	}
	if u.PasswordFile != nil {
		base.PasswordFile = trim(*u.PasswordFile)
		note("password_file")
	}
	if u.IntervalSeconds != nil {
		base.Interval = time.Duration(*u.IntervalSeconds) * time.Second
		note("interval")
	}
	if u.IncludeOUs != nil {
		base.IncludeOUs = []string{}
		for _, s := range *u.IncludeOUs {
			base.IncludeOUs = append(base.IncludeOUs, trim(s))
		}
		note("include_ous")
	}
	if u.ExcludeOUs != nil {
		base.ExcludeOUs = []string{}
		for _, s := range *u.ExcludeOUs {
			base.ExcludeOUs = append(base.ExcludeOUs, trim(s))
		}
		note("exclude_ous")
	}
	if u.MaxObjects != nil {
		base.MaxObjects = *u.MaxObjects
		note("max_objects")
	}
	if u.PageSize != nil {
		base.PageSize = *u.PageSize
		note("page_size")
	}
	if u.InactiveDays != nil {
		base.InactiveDays = *u.InactiveDays
		note("inactive_days")
	}
	if u.KrbtgtMaxAgeDays != nil {
		base.KrbtgtMaxAgeDays = *u.KrbtgtMaxAgeDays
		note("krbtgt_max_age_days")
	}
	if u.WorkStart != nil {
		base.WorkStart = trim(*u.WorkStart)
		note("work_start")
	}
	if u.WorkEnd != nil {
		base.WorkEnd = trim(*u.WorkEnd)
		note("work_end")
	}
	if u.WorkDays != nil {
		base.WorkDays = append([]int{}, (*u.WorkDays)...)
		note("work_days")
	}
	if u.Password != nil {
		note("password")
	}
	return changed
}

// decodeADUpdate reads one strict body: size-capped, unknown fields
// rejected (a typo would silently change nothing — the opposite of
// what an admin surface may do).
func decodeADUpdate(w http.ResponseWriter, r *http.Request) (*adSettingsUpdate, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, adSettingsMaxBodyBytes))
	if err != nil {
		http.Error(w, "unreadable or oversized request body (8 KiB limit)", http.StatusBadRequest)
		return nil, false
	}
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.DisallowUnknownFields()
	var in adSettingsUpdate
	if err := dec.Decode(&in); err != nil {
		http.Error(w, fmt.Sprintf("invalid JSON body: %v", err), http.StatusBadRequest)
		return nil, false
	}
	return &in, true
}

// currentADBase returns the config any merge starts from: the armed
// connector's effective configuration, or the zero config when the
// surface runs without -ad (test-before-arm: the request must then be
// complete, and Validate says exactly what is missing).
func (h *Hub) currentADBase() ad.Config {
	if c := h.adConnector(); c != nil {
		return c.Config()
	}
	return ad.Config{}
}

// handleADSettingsPut serves PUT /api/settings/ad: validate with the
// loader's own rules, write the credential (when present) into its
// own envelope file, commit the YAML atomically, hot-swap the
// connector, and answer with the new effective document. The drift
// check protects hand edits: a file changed on disk since the engine
// loaded (or last wrote) it refuses the PUT with 409.
func (h *Hub) handleADSettingsPut(w http.ResponseWriter, r *http.Request) {
	if !h.adSettingsGate(w, true) {
		return
	}
	in, ok := decodeADUpdate(w, r)
	if !ok {
		return
	}
	c := h.adConnector()
	if c == nil {
		h.adOffJSON(w)
		return
	}
	candidate := c.Config()
	changed := in.apply(&candidate)
	if err := candidate.Validate(); err != nil {
		http.Error(w, fmt.Sprintf("configuration rejected: %v", err), http.StatusBadRequest)
		return
	}

	h.adWriteMu.Lock()
	defer h.adWriteMu.Unlock()

	// Drift gate: the file is the shared source of truth; overwriting
	// an unmerged hand edit would destroy the operator's work. The
	// baseline is the sha256 of what the engine last loaded or wrote.
	raw, err := os.ReadFile(h.adSettingsPath)
	if err != nil {
		log.Printf("[API] WRITE ad-settings REFUSED (config unreadable on disk): %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		fmt.Fprintln(w, `{"error":"the -ad config file is missing or unreadable on disk; restore it or restart the engine before writing settings"}`)
		return
	}
	if sha256.Sum256(raw) != h.adConfigSum {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		fmt.Fprintln(w, `{"error":"the -ad config file changed on disk since the engine loaded it; edit through the API or restart the engine to adopt the file before writing settings"}`)
		return
	}

	// The credential goes to ITS OWN file through the SEC-2 envelope
	// (DPAPI on Windows, 0600 plain elsewhere) — never into the YAML,
	// never into a log. The buffer is zeroed as soon as the write
	// returns; the immutable Go string copy is the same documented
	// library limit the sync bind already carries.
	if in.Password != nil {
		pw := *in.Password
		if pw == "" {
			http.Error(w, "password must not be empty (omit the field to keep the stored credential)", http.StatusBadRequest)
			return
		}
		pwBytes := []byte(pw)
		err := secretfile.Write(candidate.PasswordFile, pwBytes)
		for i := range pwBytes {
			pwBytes[i] = 0
		}
		if err != nil {
			log.Printf("[API] WRITE ad-settings FAILED (credential file): %v", err)
			http.Error(w, "the credential file is not writable (see engine log)", http.StatusInternalServerError)
			return
		}
	}

	if err := candidate.WriteFile(h.adSettingsPath); err != nil {
		log.Printf("[API] WRITE ad-settings FAILED (config file): %v", err)
		http.Error(w, "the config file is not writable (see engine log)", http.StatusInternalServerError)
		return
	}
	if raw, err := os.ReadFile(h.adSettingsPath); err == nil {
		h.adConfigSum = sha256.Sum256(raw)
	}

	log.Printf("[API] WRITE ad-settings fields=%s by=api (file %s)", strings.Join(changed, ","), oneLine(h.adSettingsPath))
	h.adReloadAsync(&candidate)

	out := adWireFromConfig(&candidate)
	out.ReloadPending = true
	writeJSON(w, out)
}

// adReloadAsync swaps the live connector off the request path: the
// PUT response reports reload_pending=true and the callback (stop the
// previous loop, build and start the new connector, publish it) runs
// in its own goroutine. Callbacks are serialized by adWriteMu, so the
// engine-side swap bookkeeping needs no lock of its own.
func (h *Hub) adReloadAsync(candidate *ad.Config) {
	h.adReloadPending.Store(true)
	reconfigure := h.adReconfigure
	if reconfigure == nil {
		h.adReloadRecord.Store(&adReloadRecord{
			At:    time.Now(),
			Error: "no reload callback armed: the committed config applies on restart",
		})
		h.adReloadPending.Store(false)
		return
	}
	go func() {
		rec := &adReloadRecord{At: time.Now()}
		if err := reconfigure(candidate); err != nil {
			rec.Error = fmt.Sprintf("the committed config could not take over (it applies on restart): %v", err)
			log.Printf("[API] ad-settings reload FAILED: %v", err)
		} else {
			log.Printf("[API] ad-settings reload OK (connector hot-swapped)")
		}
		h.adReloadRecord.Store(rec)
		h.adReloadPending.Store(false)
	}()
}

// handleADTest serves POST /api/ad/test, the "Probar conexión" of the
// TODO: one bounded probe of a candidate configuration — bind plus a
// capped per-kind sample of what the service account can read. It is
// armed with -api-write alone (an operator may test a configuration
// BEFORE restarting the engine with it), it never mutates anything,
// and its verdict is a 200 with ok=true/false: a failed CONNECTION is
// a successful TEST. One probe at a time, so a double click cannot
// hammer the domain controller.
func (h *Hub) handleADTest(w http.ResponseWriter, r *http.Request) {
	if !h.adSettingsGate(w, false) {
		return
	}
	in, ok := decodeADUpdate(w, r)
	if !ok {
		return
	}
	candidate := h.currentADBase()
	in.apply(&candidate)
	if err := candidate.Validate(); err != nil {
		http.Error(w, fmt.Sprintf("configuration rejected: %v", err), http.StatusBadRequest)
		return
	}

	// Credential resolution: the request's password wins (the form
	// tests BEFORE saving), otherwise the stored envelope of the
	// candidate file. No password, no probe — and no anonymous bind,
	// ever (the connector refuses them by construction).
	var pw []byte
	if in.Password != nil {
		if *in.Password == "" {
			http.Error(w, "password must not be empty (omit the field to test with the stored credential)", http.StatusBadRequest)
			return
		}
		pw = []byte(*in.Password)
	} else if candidate.PasswordFile != "" {
		stored, _, err := secretfile.Read(candidate.PasswordFile)
		if err != nil {
			log.Printf("[API] ad-test credential unreadable: %v", err)
			http.Error(w, "no password available: provide one in the request or deploy the credential file first", http.StatusBadRequest)
			return
		}
		pw = stored
	}
	if pw == nil {
		http.Error(w, "password required: there is no stored credential without -ad", http.StatusBadRequest)
		return
	}

	h.adTestMu.Lock()
	defer h.adTestMu.Unlock()

	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	res := ad.Probe(ctx, &candidate, pw)
	secretfile.Zero(pw)

	log.Printf("[API] ad-test server=%s port=%d start_tls=%t ok=%t by=api",
		redact.EndpointLabel(candidate.Server), candidate.Port, candidate.StartTLS, res.OK)
	writeJSON(w, res)
}
