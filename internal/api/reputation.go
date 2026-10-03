// Reputation lookups on analyst demand (internal/reputation): GET
// /api/reputation reports which providers the operator configured, and
// GET /api/reputation?ip=... or ?hash=... queries them for one
// indicator. Nothing is looked up unless asked, private addresses are
// refused, and without keys every lookup answers 404 so a probe cannot
// tell a misconfigured engine from one that never had the feature.

package api

import (
	"net/http"

	"github.com/Ruby570bocadito/bluetardigrade/internal/reputation"
)

// SetReputation attaches the lookup client (nil or keyless = disabled).
func (h *Hub) SetReputation(c *reputation.Client) {
	h.mu.Lock()
	h.reputation = c
	h.mu.Unlock()
}

type reputationProviders struct {
	Providers map[string]bool `json:"providers"`
}

func (h *Hub) handleReputation(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	c := h.reputation
	h.mu.Unlock()
	q := r.URL.Query()
	ip, hash := q.Get("ip"), q.Get("hash")
	if ip == "" && hash == "" {
		writeJSON(w, reputationProviders{Providers: c.Providers()})
		return
	}
	if !c.Any() {
		writeErr(w, http.StatusNotFound, "reputation lookups are disabled: set SF_VT_API_KEY and/or SF_ABUSEIPDB_API_KEY for the engine")
		return
	}
	if ip != "" && hash != "" {
		writeErr(w, http.StatusBadRequest, "ask for one indicator: ip or hash")
		return
	}
	if ip != "" {
		clean, err := reputation.ValidateIP(ip)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, c.LookupIP(r.Context(), clean))
		return
	}
	clean, err := reputation.ValidateHash(hash)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, c.LookupHash(r.Context(), clean))
}
