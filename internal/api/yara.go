package api

// GET /api/yara: the engine's YARA rule pack (M-3) — the directory the
// operator curates with -yara-rules, the version its bundle.json names,
// the content fingerprint the sensors report in their heartbeat and the
// files a sensor would refuse. GET /api/yara/bundle: the same pack as a
// zip an operator drops next to the sensor's --yara-rules; the sensor
// reloads it within a minute without a restart. Delivery is out of band
// until the signed server-to-sensor channel (E-1) exists; arrival is the
// comparison of the pack's sha16 with the yara_rules_sha each sensor
// reports in /api/fleet.

import (
	"bytes"
	"errors"
	"fmt"
	"log"
	"net/http"

	"github.com/Ruby570bocadito/bluetardigrade/internal/yara"
)

// SetYara points the hub at the engine's rule pack.
func (h *Hub) SetYara(s *yara.Store) {
	h.mu.Lock()
	h.yara = s
	h.mu.Unlock()
}

type yaraPayload struct {
	// Enabled is false when the engine runs without -yara-rules.
	Enabled bool `json:"enabled"`
	yara.Status
}

func (h *Hub) handleYara(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	s := h.yara
	h.mu.Unlock()
	out := yaraPayload{Status: yara.Status{Files: []yara.File{}, Problems: []string{}}}
	if s == nil {
		writeJSON(w, out)
		return
	}
	s.Refresh()
	out.Enabled = true
	out.Status = s.Snapshot()
	writeJSON(w, out)
}

// handleYaraBundle serves the pack as a zip. The pack is buffered before
// any header goes out (it is capped well under the response a browser or
// curl chokes on), so a failed read answers a clean JSON error instead of
// a truncated download.
func (h *Hub) handleYaraBundle(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	s := h.yara
	h.mu.Unlock()
	if s == nil {
		writeErr(w, http.StatusNotFound, "the engine runs without -yara-rules: there is no rule pack")
		return
	}
	s.Refresh()
	st := s.Snapshot()
	if len(st.Files) == 0 {
		writeErr(w, http.StatusNotFound, "the rule pack has no rule files yet")
		return
	}
	if st.TotalBytes > yara.MaxPackBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, yara.ErrTooLarge.Error())
		return
	}
	var buf bytes.Buffer
	if err := s.Zip(&buf); err != nil {
		if errors.Is(err, yara.ErrEmptyPack) || errors.Is(err, yara.ErrTooLarge) {
			// the pack changed between the reading and the zip: answer
			// with the fact, the next request serves the new one
			writeErr(w, http.StatusConflict, oneLine(err.Error()))
			return
		}
		log.Printf("[API] yara bundle for %s failed: %v", st.Dir, err)
		writeErr(w, http.StatusInternalServerError, "the rule pack could not be read (see engine log)")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"yara-bundle-%s.zip\"", st.Sha16))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}
