package api

// The detection-validation surface (TODO SIM-4, engine side): the
// laboratory battery of inert scenarios, runnable on demand through
// the API and served with its history. The heavy lifting lives in
// internal/scenrun; this file is wire only. The routes are registered
// unconditionally and answer 501 while the engine runs without
// -scenarios <dir> — the same "the console can render feature-off"
// contract the forensic read surface uses, because a probe must not
// confuse "disarmed" with "does not exist".

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/Ruby570bocadito/bluetardigrade/internal/scenrun"
)

const scenarioHint = "start the engine with -scenarios <dir> (a laboratory engine, never production evidence)"

// SetScenarios arms the battery (nil = disarmed: every route answers
// 501 with the arming hint).
func (h *Hub) SetScenarios(s *scenrun.Service) {
	h.mu.Lock()
	h.scenarios = s
	h.mu.Unlock()
}

func (h *Hub) scenarioService() *scenrun.Service {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.scenarios
}

// writeScenarioError is writeErr plus a "hint" key: the arming
// guidance is actionable for a human reading the console error, not
// only for the operator grepping the flag reference.
func writeScenarioError(w http.ResponseWriter, code int, msg, hint string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	payload := map[string]string{"error": msg}
	if hint != "" {
		payload["hint"] = hint
	}
	writeJSON(w, payload)
}

// notArmed answers 501 with the hint the console renders.
func notArmed(w http.ResponseWriter) {
	writeScenarioError(w, http.StatusNotImplemented,
		"scenario validation is not armed on this engine", scenarioHint)
}

// registerScenarios wires the four routes into the mux.
func (h *Hub) registerScenarios(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/scenarios", h.handleScenarioLibrary)
	mux.HandleFunc("POST /api/scenarios/run", h.handleScenarioRun)
	mux.HandleFunc("GET /api/scenarios/runs", h.handleScenarioRuns)
	mux.HandleFunc("GET /api/scenarios/runs/{id}", h.handleScenarioRunDetail)
}

// handleScenarioLibrary serves the loaded scenario library
// (GET /api/scenarios).
func (h *Hub) handleScenarioLibrary(w http.ResponseWriter, _ *http.Request) {
	s := h.scenarioService()
	if s == nil {
		notArmed(w)
		return
	}
	views, err := s.Library()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]any{
		"armed":     true,
		"dir":       s.Dir(),
		"count":     len(views),
		"scenarios": views,
	})
}

// handleScenarioRun launches the battery (POST /api/scenarios/run).
// The run proceeds in the background: 202 carries the run record as
// it stands at launch and the caller polls the history routes. A run
// already in flight answers 409 naming it; a broken library answers
// 500 with the loader error verbatim.
func (h *Hub) handleScenarioRun(w http.ResponseWriter, r *http.Request) {
	s := h.scenarioService()
	if s == nil {
		notArmed(w)
		return
	}
	var opts scenrun.StartOptions
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8192))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "unreadable or oversized request body (8 KiB limit)")
		return
	}
	if len(strings.TrimSpace(string(body))) > 0 {
		if err := json.Unmarshal(body, &opts); err != nil {
			writeErr(w, http.StatusBadRequest,
				`invalid JSON body: want {"only":["sim-..."],"timeout_ms":1000} (both fields optional)`)
			return
		}
	}
	run, err := s.Start(opts)
	switch {
	case err == nil:
		w.WriteHeader(http.StatusAccepted)
		writeJSON(w, run)
	case errors.Is(err, scenrun.ErrRunning):
		writeScenarioError(w, http.StatusConflict,
			"a scenario run is already in progress", s.CurrentRunID())
	case errors.Is(err, scenrun.ErrNotArmed):
		notArmed(w)
	default:
		// Library load errors and unknown scenario ids are the
		// caller's information: name them verbatim (400 when the
		// request picked the scenarios, 500 when the library itself
		// is broken).
		code := http.StatusInternalServerError
		if strings.Contains(err.Error(), "desconocido") {
			code = http.StatusBadRequest
		}
		writeErr(w, code, err.Error())
	}
}

// handleScenarioRuns serves the history (GET /api/scenarios/runs),
// newest first. ?limit= caps the payload (default 20, max 100).
func (h *Hub) handleScenarioRuns(w http.ResponseWriter, r *http.Request) {
	s := h.scenarioService()
	if s == nil {
		notArmed(w)
		return
	}
	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeErr(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = n
		if limit > 100 {
			limit = 100
		}
	}
	runs, err := s.History(limit)
	if err != nil {
		if errors.Is(err, scenrun.ErrNotArmed) {
			notArmed(w)
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if runs == nil {
		runs = []scenrun.Run{}
	}
	writeJSON(w, map[string]any{"runs": runs})
}

// handleScenarioRunDetail serves one run with its per-scenario
// results (GET /api/scenarios/runs/{id}); the in-flight run reflects
// live progress. Unknown ids answer 404.
func (h *Hub) handleScenarioRunDetail(w http.ResponseWriter, r *http.Request) {
	s := h.scenarioService()
	if s == nil {
		notArmed(w)
		return
	}
	id := r.PathValue("id")
	if !scenrun.ValidRunID(id) {
		writeErr(w, http.StatusBadRequest,
			`malformed run id: want "run-" followed by 16 hex characters`)
		return
	}
	run, err := s.RunDetail(id)
	if err != nil {
		if errors.Is(err, scenrun.ErrNotArmed) {
			notArmed(w)
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if run == nil {
		writeErr(w, http.StatusNotFound, "no such scenario run: "+id)
		return
	}
	writeJSON(w, run)
}
