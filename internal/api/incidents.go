// Incident surface: cases that group alerts, with status, owner and a
// timeline (internal/incident). Like alert triage this is operator
// workflow, not engine configuration, so it is writable through the
// bearer-gated API without -api-write; every mutation is logged on one
// line and broadcast as an `incident` SSE frame so open consoles update
// live.

package api

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"

	"github.com/Ruby570bocadito/bluetardigrade/internal/incident"
)

// incidentMaxBodyBytes caps incident request bodies: a case carries at
// most a few hundred alert ids and a few KiB of text.
const incidentMaxBodyBytes = 32 << 10

// SetIncidents points the hub at the incident store (persistent when
// the engine runs with -incidents). Nil keeps the memory default.
func (h *Hub) SetIncidents(s *incident.Store) {
	if s == nil {
		return
	}
	h.mu.Lock()
	h.incidents = s
	h.mu.Unlock()
}

func mustMemoryIncidents() *incident.Store {
	s, err := incident.New("")
	if err != nil {
		panic("api: memory incident store: " + err.Error())
	}
	return s
}

func (h *Hub) incidentStore() *incident.Store {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.incidents
}

func (h *Hub) registerIncidents(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/incidents", h.handleIncidentList)
	mux.HandleFunc("POST /api/incidents", h.handleIncidentCreate)
	mux.HandleFunc("GET /api/incidents/{id}", h.handleIncidentGet)
	mux.HandleFunc("PATCH /api/incidents/{id}", h.handleIncidentPatch)
	mux.HandleFunc("POST /api/incidents/{id}/alerts", h.handleIncidentAlerts)
	mux.HandleFunc("POST /api/incidents/{id}/notes", h.handleIncidentNote)
}

type incidentList struct {
	Incidents  []incident.Incident `json:"incidents"`
	Persistent bool                `json:"persistent"`
}

func (h *Hub) handleIncidentList(w http.ResponseWriter, r *http.Request) {
	s := h.incidentStore()
	writeJSON(w, incidentList{Incidents: scopeFrom(r).visibleIncidents(s.List()), Persistent: s.Persistent()})
}

// visibleIncident checks that a caller limited to host groups
// (scope.go) sees the incident: all its machines are in its groups. Any
// other answers like an unknown id.
func (h *Hub) visibleIncident(w http.ResponseWriter, r *http.Request, id string) bool {
	sc := scopeFrom(r)
	if sc == nil {
		return true
	}
	inc, err := h.incidentStore().Get(id)
	if err != nil {
		h.incidentError(w, id, err)
		return false
	}
	if !sc.seesIncident(inc) {
		h.incidentError(w, id, incident.ErrNotFound)
		return false
	}
	return true
}

// scopedIncidentInput checks, for a caller limited to host groups, the
// alerts and machines it puts in an incident: all of them must be its
// own, and it returns the machines of the alerts (from the ring or the
// store) so the incident stays visible to it. Unrestricted callers get
// (nil, true).
func (h *Hub) scopedIncidentInput(w http.ResponseWriter, r *http.Request, alertIDs, hosts []string) ([]string, bool) {
	sc := scopeFrom(r)
	if sc == nil {
		return nil, true
	}
	found, all, err := h.alertHosts(r.Context(), alertIDs)
	if err != nil {
		h.storeQueryError(w, err)
		return nil, false
	}
	for _, host := range found {
		if !sc.allows(host) {
			all = false
		}
	}
	if !all {
		writeErr(w, http.StatusNotFound, "unknown alert id")
		return nil, false
	}
	for _, host := range hosts {
		if !sc.allows(host) {
			writeErr(w, http.StatusForbidden, "una cuenta limitada a grupos de equipos solo pone en un incidente equipos de sus grupos")
			return nil, false
		}
	}
	return found, true
}

func (h *Hub) handleIncidentGet(w http.ResponseWriter, r *http.Request) {
	id, ok := incidentID(w, r)
	if !ok {
		return
	}
	inc, err := h.incidentStore().Get(id)
	if err != nil {
		h.incidentError(w, id, err)
		return
	}
	if !scopeFrom(r).seesIncident(inc) {
		h.incidentError(w, id, incident.ErrNotFound)
		return
	}
	writeJSON(w, inc)
}

func (h *Hub) handleIncidentCreate(w http.ResponseWriter, r *http.Request) {
	var in incident.Create
	if !readIncidentBody(w, r, &in) {
		return
	}
	scoped, ok := h.scopedIncidentInput(w, r, in.AlertIDs, in.Hosts)
	if !ok {
		return
	}
	hosts, severity := h.alertContext(in.AlertIDs)
	in.Hosts = append(append(in.Hosts, hosts...), scoped...)
	if in.Severity == "" {
		in.Severity = severity
	}
	if scopeFrom(r) != nil && len(in.Hosts) == 0 {
		// an incident with no machine is visible to unrestricted
		// accounts only: its author would lose it at once
		writeErr(w, http.StatusBadRequest, "una cuenta limitada a grupos de equipos abre incidentes sobre alertas o equipos de sus grupos")
		return
	}
	inc, err := h.incidentStore().Create(in)
	if err != nil && !errors.Is(err, incident.ErrPersistFailed) {
		h.incidentError(w, "", err)
		return
	}
	log.Printf("[API] incident %s opened (%d alerts, by=%s)", inc.ID, len(inc.AlertIDs), oneLine(in.By))
	if errors.Is(err, incident.ErrPersistFailed) {
		h.incidentError(w, inc.ID, err)
		return
	}
	h.broadcast("incident", inc, inc.Hosts...)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(inc)
}

func (h *Hub) handleIncidentPatch(w http.ResponseWriter, r *http.Request) {
	id, ok := incidentID(w, r)
	if !ok {
		return
	}
	var p incident.Patch
	if !readIncidentBody(w, r, &p) {
		return
	}
	if !h.visibleIncident(w, r, id) {
		return
	}
	inc, err := h.incidentStore().Update(id, p)
	h.finishIncident(w, id, inc, err, "updated", p.By)
}

type incidentAlertsRequest struct {
	AlertIDs []string `json:"alert_ids"`
	Hosts    []string `json:"hosts"`
	Severity string   `json:"severity"`
	By       string   `json:"by"`
}

func (h *Hub) handleIncidentAlerts(w http.ResponseWriter, r *http.Request) {
	id, ok := incidentID(w, r)
	if !ok {
		return
	}
	var req incidentAlertsRequest
	if !readIncidentBody(w, r, &req) {
		return
	}
	if !h.visibleIncident(w, r, id) {
		return
	}
	scoped, ok := h.scopedIncidentInput(w, r, req.AlertIDs, req.Hosts)
	if !ok {
		return
	}
	hosts, severity := h.alertContext(req.AlertIDs)
	if req.Severity == "" {
		req.Severity = severity
	}
	inc, err := h.incidentStore().AddAlerts(id, req.AlertIDs, append(append(req.Hosts, hosts...), scoped...), req.Severity, req.By)
	h.finishIncident(w, id, inc, err, "alerts added", req.By)
}

type incidentNoteRequest struct {
	Text string `json:"text"`
	By   string `json:"by"`
}

func (h *Hub) handleIncidentNote(w http.ResponseWriter, r *http.Request) {
	id, ok := incidentID(w, r)
	if !ok {
		return
	}
	var req incidentNoteRequest
	if !readIncidentBody(w, r, &req) {
		return
	}
	if !h.visibleIncident(w, r, id) {
		return
	}
	inc, err := h.incidentStore().AddNote(id, req.Text, req.By)
	h.finishIncident(w, id, inc, err, "note added", req.By)
}

func (h *Hub) finishIncident(w http.ResponseWriter, id string, inc incident.Incident, err error, what, by string) {
	if err != nil && !errors.Is(err, incident.ErrPersistFailed) {
		h.incidentError(w, id, err)
		return
	}
	log.Printf("[API] incident %s %s (by=%s)", id, what, oneLine(by))
	if err != nil {
		h.incidentError(w, id, err)
		return
	}
	h.broadcast("incident", inc, inc.Hosts...)
	writeJSON(w, inc)
}

// incidentError maps store errors to status codes structurally: unknown
// id 404, full store 409, persistence 500 (generic body, details in the
// log: they name local paths), anything else is a client error.
func (h *Hub) incidentError(w http.ResponseWriter, id string, err error) {
	switch {
	case errors.Is(err, incident.ErrNotFound):
		writeErr(w, http.StatusNotFound, "unknown incident id")
	case errors.Is(err, incident.ErrFull):
		writeErr(w, http.StatusConflict, err.Error())
	case errors.Is(err, incident.ErrPersistFailed):
		log.Printf("[API] incident %s persist FAILED: %v", id, err)
		writeErr(w, http.StatusInternalServerError, "incident recorded in memory but persistence failed (see engine log)")
	default:
		writeErr(w, http.StatusBadRequest, err.Error())
	}
}

func incidentID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !incident.ValidID(id) {
		writeErr(w, http.StatusBadRequest, "malformed incident id: want 16 lowercase hex characters")
		return "", false
	}
	return id, true
}

func readIncidentBody(w http.ResponseWriter, r *http.Request, into any) bool {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, incidentMaxBodyBytes))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "unreadable or oversized request body (32 KiB limit)")
		return false
	}
	if err := json.Unmarshal(body, into); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

// alertContext derives hosts and the highest severity of the given
// alert ids from the live ring. Alerts already evicted contribute
// nothing; callers may pass hosts and severity explicitly.
func (h *Hub) alertContext(ids []string) (hosts []string, severity string) {
	if len(ids) == 0 {
		return nil, ""
	}
	want := make(map[string]bool, len(ids))
	for _, id := range ids {
		want[id] = true
	}
	rank := map[string]int{"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, a := range h.alerts {
		if !want[a.ID] {
			continue
		}
		if a.Host != "" {
			hosts = append(hosts, a.Host)
		}
		if severity == "" || rank[a.Severity] > rank[severity] {
			severity = a.Severity
		}
	}
	return hosts, severity
}
