package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// oneLine renders a client-supplied string safe for ONE log line:
// every control character becomes %XX, so a hostile note/author/rule
// id cannot forge extra log lines, fake severities or smuggle escape
// sequences into the file the operator reads after an incident. C0,
// DEL and the C1 range (U+0080..U+009F, incl. the 8-bit CSI) encode
// their UTF-8 bytes; printable runes - including non-ASCII ones - pass
// through verbatim, so the log stays forensically useful. Same threat
// model as the feed-hostile field caps on the ingest path; the triage
// audit line and the suppression write audit lines funnel through it.
func oneLine(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r <= 0x9f) {
			for _, c := range []byte(string(r)) {
				fmt.Fprintf(&b, "%%%02X", c)
			}
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func limitFrom(r *http.Request, def int) int {
	q := r.URL.Query().Get("limit")
	if q == "" {
		return def
	}
	n := 0
	for _, c := range q {
		if c < '0' || c > '9' {
			return def
		}
		n = n*10 + int(c-'0')
		if n > maxEvents {
			return maxEvents
		}
	}
	if n <= 0 {
		return def
	}
	return n
}

// mitreAndTactic derives the console fields from the rule tags:
// "attack.t1003.001" -> "T1003.001", "attack.credential-access" ->
// "Credential Access".
func mitreAndTactic(tags []string) (string, string) {
	mitre, tactic := "", ""
	for _, t := range tags {
		if strings.HasPrefix(t, "attack.t") {
			mitre = strings.ToUpper(t[len("attack."):len("attack.")+1]) + t[len("attack.")+1:]
			continue
		}
		if tactic == "" && strings.HasPrefix(t, "attack.") {
			parts := strings.Split(strings.TrimPrefix(t, "attack."), "-")
			for i, p := range parts {
				if p != "" {
					parts[i] = strings.ToUpper(p[:1]) + p[1:]
				}
			}
			tactic = strings.Join(parts, " ")
		}
	}
	return mitre, tactic
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	if err := enc.Encode(v); err != nil {
		log.Printf("api: encode: %v", err)
	}
}

// storeQueryError answers a telemetry read backed by the SQLite store:
// the operator gets the detail in the engine log (with paths and SQL
// state that help debugging), the API client only gets the fact —
// mirroring how the ingest side never echoes internals back.
func (h *Hub) storeQueryError(w http.ResponseWriter, err error) {
	log.Printf("[API] store query failed: %v", err)
	http.Error(w, "store query failed (see engine log)", http.StatusInternalServerError)
}
