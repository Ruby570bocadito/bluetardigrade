// Suppression write surface (Director decision 6.1, round report
// 2026-09-29 22h01): POST/DELETE /api/suppressions let an operator
// silence or unsilence a rule/host pair without editing
// suppressions.yaml on the engine host. The surface is opt-in: the
// engine only arms it when started with -api-write (or SF_API_WRITE=1);
// otherwise the routes answer 403 with an actionable body, so the write
// path does not exist unless the operator asks for it - the same
// degrade-loudly standard as the ingest and API tokens. The source of
// truth stays the YAML file the hot-reload already watches: every write
// goes through suppress.SaveFile (temp + rename) and is loaded back
// immediately, so hand edits and API edits never diverge into a second
// hidden state.
package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/suppress"
)

// EnableSuppressionsWrite arms POST/DELETE /api/suppressions against
// the suppressions file at path (the same file the hot-reload watches).
// Call after SetSuppressions. The caller owns the deployment policy:
// run.go refuses to arm writes when the API has no bearer token and is
// bound beyond loopback, because the bearer gate below is the only
// credential a write request carries.
func (h *Hub) EnableSuppressionsWrite(path string) {
	h.mu.Lock()
	h.suppressPath = path
	h.writeEnabled = true
	h.mu.Unlock()
}

// registerSuppressionsWrite wires the write methods onto the existing
// /api/suppressions path. They are registered unconditionally: without
// -api-write they answer a loud, documented 403 - not a 405 - so
// consumers see the same contract whether or not the flag is on.
func (h *Hub) registerSuppressionsWrite(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/suppressions", h.handleSuppressionsCreate)
	mux.HandleFunc("DELETE /api/suppressions", h.handleSuppressionsDelete)
}

// suppressWriteTarget resolves the write surface for one request. It
// answers 403 with an actionable body when the engine runs without
// -api-write (the body names the flag, like the 401 names the token),
// and 500 when armed but misconfigured (no manager or no path - only
// reachable in embedded setups that skipped SetSuppressions).
func (h *Hub) suppressWriteTarget(w http.ResponseWriter) (*suppress.Manager, string, bool) {
	h.mu.Lock()
	enabled, path, sup := h.writeEnabled, h.suppressPath, h.suppress
	h.mu.Unlock()
	if !enabled {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		fmt.Fprintln(w, `{"error":"api writes are disabled: restart the engine with -api-write (or SF_API_WRITE=1) to allow suppression writes"}`)
		return nil, "", false
	}
	if sup == nil || path == "" {
		http.Error(w, "suppression write surface misconfigured (no manager or no path)", http.StatusInternalServerError)
		return nil, "", false
	}
	return sup, path, true
}

// handleSuppressionsCreate adds (or updates) one entry: the body is a
// single JSON object with the same fields as the YAML entries. The pair
// (rule_id, host) is the entry identity, so posting an existing pair
// updates reason/expires instead of duplicating it. The validated entry
// lands in the YAML file (atomic rename) and is loaded back right away:
// the change is live immediately and survives restarts, and the next
// hot-reload tick finds the same file content.
func (h *Hub) handleSuppressionsCreate(w http.ResponseWriter, r *http.Request) {
	sup, path, ok := h.suppressWriteTarget(w)
	if !ok {
		return
	}
	var in suppress.Entry
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, fmt.Sprintf("invalid JSON body: %v", err), http.StatusBadRequest)
		return
	}
	in = suppress.NormalizeEntry(in)
	if err := suppress.ValidateEntry(in); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// All -> mutate -> SaveFile -> LoadFile must be one logical
	// operation against concurrent POST/DELETE requests; the file lock
	// is held across the whole sequence.
	h.supWriteMu.Lock()
	defer h.supWriteMu.Unlock()

	entries := sup.All()
	action := "add"
	for i := range entries {
		if entries[i].RuleID == in.RuleID && entries[i].Host == in.Host {
			entries[i] = in
			action = "update"
			break
		}
	}
	if action == "add" {
		entries = append(entries, in)
	}
	if err := suppress.SaveFile(path, entries); err != nil {
		log.Printf("[API] WRITE suppressions FAILED: %v", err)
		http.Error(w, "suppressions file not writable (see engine log)", http.StatusInternalServerError)
		return
	}
	if err := sup.LoadFile(path); err != nil {
		// cannot happen after SaveFile validated the same entries, but a
		// control that silently stayed stale would be worse than a 500
		log.Printf("[API] WRITE suppressions reload FAILED: %v", err)
		http.Error(w, "suppressions reload failed (see engine log)", http.StatusInternalServerError)
		return
	}
	// audit line: the operator must be able to reconstruct who silenced
	// what and when, exactly as the file comment promises
	log.Printf("[API] WRITE suppressions %s rule=%s host=%s by=api (file %s)", action, in.RuleID, in.Host, path)
	h.writeSuppressionsSnapshot(w, sup)
}

// handleSuppressionsDelete removes every entry matching the exact
// (rule_id, host) query pair - the same identity POST upserts on. An
// entry that silences one rule on ALL hosts is only removed by a query
// without host, and vice versa: no silent wildcard expansion either
// way. 404 when nothing matched, so a stale console view cannot believe
// it unsilenced something that is still on disk.
func (h *Hub) handleSuppressionsDelete(w http.ResponseWriter, r *http.Request) {
	sup, path, ok := h.suppressWriteTarget(w)
	if !ok {
		return
	}
	q := r.URL.Query()
	rule := strings.TrimSpace(q.Get("rule_id"))
	host := strings.ToLower(strings.TrimSpace(q.Get("host")))
	if rule == "" && host == "" {
		http.Error(w, "rule_id and host are both empty (nothing would match - fix or delete the entry)", http.StatusBadRequest)
		return
	}

	h.supWriteMu.Lock()
	defer h.supWriteMu.Unlock()

	entries := sup.All()
	kept := make([]suppress.Entry, 0, len(entries))
	removed := 0
	for _, e := range entries {
		if e.RuleID == rule && e.Host == host {
			removed++
			continue
		}
		kept = append(kept, e)
	}
	if removed == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprintf(w, "{\"error\":\"no suppression entry matches rule_id=%q host=%q\"}\n", rule, host)
		return
	}
	if err := suppress.SaveFile(path, kept); err != nil {
		log.Printf("[API] WRITE suppressions FAILED: %v", err)
		http.Error(w, "suppressions file not writable (see engine log)", http.StatusInternalServerError)
		return
	}
	if err := sup.LoadFile(path); err != nil {
		log.Printf("[API] WRITE suppressions reload FAILED: %v", err)
		http.Error(w, "suppressions reload failed (see engine log)", http.StatusInternalServerError)
		return
	}
	log.Printf("[API] WRITE suppressions remove rule=%s host=%s by=api (%d removed, file %s)", rule, host, removed, path)
	h.writeSuppressionsSnapshot(w, sup)
}

// writeSuppressionsSnapshot answers with the same shape as
// GET /api/suppressions, so a console round-trip needs one payload
// shape only: the new state, not an echo of the request.
func (h *Hub) writeSuppressionsSnapshot(w http.ResponseWriter, sup *suppress.Manager) {
	now := time.Now()
	writeJSON(w, suppressPayload{
		Active:  sup.Count(now),
		Entries: sup.Snapshot(now),
	})
}
