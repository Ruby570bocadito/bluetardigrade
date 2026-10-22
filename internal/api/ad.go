// AD-1/AD-2 API surface: read-only GET routes over the directory
// snapshot and the posture analysis. The routes are registered
// unconditionally and answer 501 with an arming hint when the engine
// runs without -ad — a probing client must be able to tell "the
// feature exists but is off" from a plain 404 (the same contract the
// forensic and scenario surfaces follow). Everything sits behind the
// same bearer middleware as every other /api route.

package api

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ad"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

func (h *Hub) registerAD(mux *http.ServeMux) {
	// the directory is domain-wide: no caller limited to host groups
	// (scope.go) reads or configures it
	const ad = "Active Directory"
	mux.HandleFunc("GET /api/ad/status", unscopedOnly(ad, h.handleADStatus))
	mux.HandleFunc("GET /api/ad/objects/{kind}", unscopedOnly(ad, h.handleADObjects))
	mux.HandleFunc("GET /api/ad/posture", unscopedOnly(ad, h.handleADPosture))
	mux.HandleFunc("GET /api/ad/posture/history", unscopedOnly(ad, h.handleADPostureHistory))
	// AD-6 settings surface (ad_settings.go): the handlers answer
	// 403/501 by themselves when the engine runs without -api-write
	// or without -ad, so the registration stays unconditional like
	// the rest of this family.
	mux.HandleFunc("GET /api/settings/ad", unscopedOnly(ad, h.handleADSettingsGet))
	mux.HandleFunc("PUT /api/settings/ad", unscopedOnly(ad, h.handleADSettingsPut))
	mux.HandleFunc("POST /api/ad/test", unscopedOnly(ad, h.handleADTest))
}

const adOff = "the Active Directory connector is not armed: start the engine with -ad <config.yaml> (and -store, which holds the snapshot)"

// adOffJSON writes the 501 contract of an unarmed connector.
func (h *Hub) adOffJSON(w http.ResponseWriter) {
	writeErr(w, http.StatusNotImplemented, adOff)
}

// adConnector returns the AD connector pointer under the hub lock —
// the same read-under-lock discipline the setters follow (SEG-A ronda
// 11: the four /api/ad handlers read h.ad raw; a hot re-arm via SetAD
// while the server serves would be a data race). The connector's own
// accessors are mutex-guarded and return copies, so nothing else from
// it is shared live.
func (h *Hub) adConnector() *ad.Connector {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.ad
}

// handleADStatus serves GET /api/ad/status: the connector state as a
// VALUE snapshot (the sync goroutine never shares live memory with
// handlers).
func (h *Hub) handleADStatus(w http.ResponseWriter, _ *http.Request) {
	c := h.adConnector()
	if c == nil {
		h.adOffJSON(w)
		return
	}
	writeJSON(w, c.Snapshot())
}

// adPageLimit bounds one object page: default 50, ceiling 500 (the
// console pages; nobody needs a full directory dump over HTTP — the
// honest bulk export path is the snapshot in SQLite).
func adPageLimit(r *http.Request) int {
	q := r.URL.Query().Get("limit")
	if q == "" {
		return 50
	}
	n, err := strconv.Atoi(q)
	if err != nil || n <= 0 {
		return 50
	}
	if n > 500 {
		return 500
	}
	return n
}

func adPageOffset(r *http.Request) int {
	q := r.URL.Query().Get("offset")
	if q == "" {
		return 0
	}
	n, err := strconv.Atoi(q)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// handleADObjects serves GET /api/ad/objects/{kind}?q=&limit=&offset=
// with kind in user|group|computer|ou. The free-text query runs
// against the LOCAL snapshot (SQLite LIKE with escaped wildcards):
// operator input never composes an LDAP filter. Reads of kind=user
// are audited (SEC-9): whoever consults the record of a person
// leaves a trail of who, when and what they searched for; groups,
// computers and OUs are not personal records and leave none.
func (h *Hub) handleADObjects(w http.ResponseWriter, r *http.Request) {
	c := h.adConnector()
	if c == nil {
		h.adOffJSON(w)
		return
	}
	kind := r.PathValue("kind")
	switch kind {
	case store.ADKindUser, store.ADKindGroup, store.ADKindComputer, store.ADKindOU:
	default:
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("unknown object kind %q: use user, group, computer or ou", kind))
		return
	}
	needle := r.URL.Query().Get("q")
	page, err := c.Objects(kind, needle, adPageLimit(r), adPageOffset(r))
	if kind == store.ADKindUser {
		if err != nil {
			h.auditADUserRead(r, needle, "error", 0)
		} else {
			h.auditADUserRead(r, needle, "ok", len(page.Objects))
		}
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "the AD snapshot query failed (see engine log)")
		return
	}
	writeJSON(w, page)
}

// Caps of the user-read audit row: the account the console declares
// is a login name (X-SF-Account), the needle a search term; neither
// is worth unbounded disk.
const (
	adAuditAccountCap = 64
	adAuditQCap       = 128
)

// auditADUserRead appends the SEC-9 audit row of one directory read
// of kind=user. The account travels in X-SF-Account, built by the
// console proxy from its session (the browser cannot choose it, the
// same discipline as X-SF-Scope); a direct bearer caller carries no
// header and the row keeps its remote address. A store that cannot
// take the row is a log line, never a reason to fail the read.
func (h *Hub) auditADUserRead(r *http.Request, needle, status string, rows int) {
	st := h.store
	if st == nil {
		return
	}
	if err := st.RecordADReadAudit(store.ADReadAuditRow{
		TS:      time.Now().UTC(),
		Remote:  remoteIP(r.RemoteAddr),
		Account: auditSafe(r.Header.Get("X-SF-Account"), adAuditAccountCap),
		Q:       auditSafe(needle, adAuditQCap),
		Status:  status,
		Rows:    rows,
	}); err != nil {
		log.Printf("[API] ad read audit write failed: %v", err)
	}
}

// postureWire is the response envelope: ready=false when the
// connector is armed but no sync has completed yet (honest absence,
// never a fabricated zero score).
type postureWire struct {
	Ready            bool           `json:"ready"`
	GeneratedAt      string         `json:"generated_at"` // RFC 3339, "" while not ready
	Score            *int           `json:"score"`        // nil while not ready
	Summary          map[string]int `json:"summary"`
	Findings         []adFinding    `json:"findings"`
	Checked          int            `json:"objects_checked"`
	InactiveDays     int            `json:"inactive_days"`
	KrbtgtMaxAgeDays int            `json:"krbtgt_max_age_days"`
}

type adAffectedObject struct {
	DN     string `json:"dn"`
	Name   string `json:"name,omitempty"`
	Detail string `json:"detail,omitempty"`
}

type adFinding struct {
	ID            string             `json:"id"`
	Title         string             `json:"title"`
	Severity      string             `json:"severity"`
	Description   string             `json:"description"`
	Remediation   string             `json:"remediation"`
	Count         int                `json:"count"`
	Objects       []adAffectedObject `json:"objects"`
	TruncatedList bool               `json:"objects_truncated"`
}

// handleADPosture serves GET /api/ad/posture: the analysis the last
// completed sync froze (recomputing per request would burn the store
// on every poll and could not be more current anyway).
func (h *Hub) handleADPosture(w http.ResponseWriter, _ *http.Request) {
	c := h.adConnector()
	if c == nil {
		h.adOffJSON(w)
		return
	}
	gen, score, p, err := c.Posture()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "the stored posture document is unreadable (see engine log)")
		return
	}
	out := postureWire{
		Ready:            p != nil,
		Summary:          map[string]int{},
		Findings:         []adFinding{},
		InactiveDays:     c.InactiveDays(),
		KrbtgtMaxAgeDays: c.KrbtgtMaxAgeDays(),
	}
	if p != nil {
		out.GeneratedAt = gen.UTC().Format(time.RFC3339)
		out.Score = &score // SEG-A ronda 11: the envelope carried the field but never filled it — the 0-100 the console renders must travel the wire
		out.Summary = p.Summary
		out.Checked = p.Checked
		if out.Summary == nil {
			out.Summary = map[string]int{}
		}
		for _, f := range p.Findings {
			objs := make([]adAffectedObject, 0, len(f.Objects))
			for _, o := range f.Objects {
				objs = append(objs, adAffectedObject{DN: o.DN, Name: o.Name, Detail: o.Detail})
			}
			out.Findings = append(out.Findings, adFinding{
				ID: f.ID, Title: f.Title, Severity: f.Severity,
				Description: f.Description, Remediation: f.Remediation,
				Count: f.Count, Objects: objs, TruncatedList: f.TruncatedList,
			})
		}
	}
	writeJSON(w, out)
}

// handleADPostureHistory serves GET /api/ad/posture/history?limit=:
// one point per completed sync (oldest first), for the trend graph.
func (h *Hub) handleADPostureHistory(w http.ResponseWriter, r *http.Request) {
	c := h.adConnector()
	if c == nil {
		h.adOffJSON(w)
		return
	}
	limit := adPageLimit(r)
	if limit > 500 {
		limit = 500
	}
	points, err := c.PostureHistory(limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "the posture history query failed (see engine log)")
		return
	}
	writeJSON(w, map[string]any{"points": points})
}
