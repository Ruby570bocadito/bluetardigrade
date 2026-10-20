package api

// Access by host group (F2): a console account limited to some host
// groups (host_groups.go) sees and acts on the machines of those groups
// only. The console proxy states the limit on every request it forwards
// in the X-SF-Scope header, a comma separated list of group names; a
// request without the header is unrestricted, like every caller before
// groups existed. The header only narrows: the bearer token is what
// authenticates the console, and whoever holds the token can always ask
// without it, so the token must stay with the console.
//
// What a scoped request gets:
//   - events, alerts, the alert search, exports, reports, noise, the
//     fleet, the risk list, baselines, the response audit and the live
//     stream: only machines in its groups;
//   - incidents: only those whose machines are ALL in its groups (one
//     with no machine belongs to nobody in particular: unrestricted
//     callers only);
//   - an alert, incident or bundle outside its groups answers 404, like
//     one that does not exist, and so does a write naming one;
//   - Active Directory, /metrics and the engine settings answer 403:
//     they are domain-wide or platform-wide, not per machine.
//
// A group name the engine does not have matches nothing, and so does a
// header with no valid name: an account whose groups were deleted sees
// nothing rather than everything.

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
	"github.com/Ruby570bocadito/bluetardigrade/internal/hostgroup"
	"github.com/Ruby570bocadito/bluetardigrade/internal/incident"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

// ScopeHeader carries the groups a request is limited to.
const ScopeHeader = "X-SF-Scope"

const (
	// scopeMemoMax bounds the per-scope membership cache (a stream
	// lives long and host names come from the sensors).
	scopeMemoMax = 4096
	// knownHostsTTL is how long the list of hosts a scoped store query
	// may name is reused; knownHostsMax caps it.
	knownHostsTTL = 30 * time.Second
	knownHostsMax = 20000
	// scopeRefresh is how often a live stream re-reads groups and the
	// AD computers its scope is decided on.
	scopeRefresh = time.Minute
)

type scopeKey struct{}

// scope is the parsed limit of one request: nil means unrestricted.
// Everything it decides on is loaded when it is built, so allows never
// takes a hub lock and may run anywhere, the ring loops included.
type scope struct {
	groups map[string]bool
	names  []string
	set    *hostgroup.Set
	dn     map[string]string
	ident  map[string]string // lowercased host -> ingest identity
	built  time.Time

	mu   sync.Mutex
	memo map[string]bool
}

// scopeNames reads the header: ok is false when the request has none.
func scopeNames(r *http.Request) (names []string, ok bool) {
	values, ok := r.Header[http.CanonicalHeaderKey(ScopeHeader)]
	if !ok {
		return nil, false
	}
	seen := map[string]bool{}
	names = []string{}
	for _, v := range values {
		for _, p := range strings.Split(v, ",") {
			if p = strings.ToLower(strings.TrimSpace(p)); hostgroup.ValidName(p) && !seen[p] {
				seen[p] = true
				names = append(names, p)
			}
		}
	}
	sort.Strings(names)
	return names, true
}

// newScope builds the scope of names with the groups and the AD
// computers the engine holds now. Never call it under h.mu.
func (h *Hub) newScope(names []string, now time.Time) *scope {
	set, _ := h.currentHostGroups()
	sc := &scope{groups: map[string]bool{}, names: names, set: set, built: now, memo: map[string]bool{}}
	for _, n := range names {
		sc.groups[n] = true
	}
	needDN, needIdentity := false, false
	for _, g := range set.Groups() {
		if sc.groups[g.Name] {
			needDN = needDN || len(g.OUs) > 0
			needIdentity = needIdentity || len(g.Identities) > 0
		}
	}
	if needDN {
		sc.dn = h.computerDNByHost(now)
	}
	if needIdentity {
		sc.ident = h.fleetIdentities(now)
	}
	return sc
}

// fleetIdentities maps the inventory hosts to the ingest identity that
// delivers them.
func (h *Hub) fleetIdentities(now time.Time) map[string]string {
	h.mu.Lock()
	t := h.fleet
	h.mu.Unlock()
	out := map[string]string{}
	if t == nil {
		return out
	}
	for _, host := range t.Snapshot(now) {
		if host.Identity != "" {
			out[strings.ToLower(host.Host)] = host.Identity
		}
	}
	return out
}

// withScope attaches the scope of the request (when it states one) for
// the handlers to read with scopeFrom.
func (h *Hub) withScope(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		names, ok := scopeNames(r)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		sc := h.newScope(names, time.Now())
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), scopeKey{}, sc)))
	})
}

// scopeFrom returns the scope of the request, nil when unrestricted.
func scopeFrom(r *http.Request) *scope {
	sc, _ := r.Context().Value(scopeKey{}).(*scope)
	return sc
}

// allows tells whether host is one of the scope's machines.
func (s *scope) allows(host string) bool {
	if s == nil {
		return true
	}
	key := strings.ToLower(strings.TrimSpace(host))
	if key == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.memo[key]; ok {
		return v
	}
	v := false
	for _, g := range s.set.Of(groupMember(fleet.Host{Host: key, Identity: s.ident[key]}, s.dn)) {
		if s.groups[g] {
			v = true
			break
		}
	}
	if len(s.memo) >= scopeMemoMax {
		s.memo = map[string]bool{}
	}
	s.memo[key] = v
	return v
}

// allowsAll tells whether every host is in scope, and there is at least
// one: the visibility rule of incidents.
func (s *scope) allowsAll(hosts []string) bool {
	if s == nil {
		return true
	}
	if len(hosts) == 0 {
		return false
	}
	for _, h := range hosts {
		if !s.allows(h) {
			return false
		}
	}
	return true
}

// seesIncident applies the visibility rule to an incident.
func (s *scope) seesIncident(inc incident.Incident) bool {
	return s.allowsAll(inc.Hosts)
}

// visibleIncidents keeps the incidents the scope sees.
func (s *scope) visibleIncidents(list []incident.Incident) []incident.Incident {
	if s == nil {
		return list
	}
	out := []incident.Incident{}
	for _, inc := range list {
		if s.seesIncident(inc) {
			out = append(out, inc)
		}
	}
	return out
}

// unscopedOnly wraps a route no caller limited to host groups reaches.
func unscopedOnly(what string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if refuseScoped(w, r, what) {
			return
		}
		next(w, r)
	}
}

// refuseScoped answers 403 for a surface no scoped account reaches and
// returns true; it returns false for an unrestricted request.
func refuseScoped(w http.ResponseWriter, r *http.Request, what string) bool {
	if scopeFrom(r) == nil {
		return false
	}
	writeErr(w, http.StatusForbidden, what+" no está disponible para una cuenta limitada a grupos de equipos")
	return true
}

// knownHosts lists every host the store, the inventory and the rings
// hold (cached briefly): the candidates a scoped store query is
// narrowed to.
type knownHosts struct {
	mu   sync.Mutex
	at   time.Time
	list []string
}

func (h *Hub) knownHostList(ctx context.Context, now time.Time) ([]string, error) {
	h.hostsSeen.mu.Lock()
	defer h.hostsSeen.mu.Unlock()
	if h.hostsSeen.list != nil && now.Sub(h.hostsSeen.at) < knownHostsTTL {
		return h.hostsSeen.list, nil
	}
	h.mu.Lock()
	st, t := h.store, h.fleet
	seen := map[string]bool{}
	list := []string{}
	add := func(host string) {
		if key := strings.ToLower(host); host != "" && !seen[key] && len(list) < knownHostsMax {
			seen[key] = true
			list = append(list, host)
		}
	}
	for _, ev := range h.events {
		add(ev.Host)
	}
	for _, a := range h.alerts {
		add(a.Host)
	}
	h.mu.Unlock()
	if t != nil {
		for _, host := range t.Snapshot(now) {
			add(host.Host)
		}
	}
	if st != nil {
		stored, err := st.Hosts(ctx, knownHostsMax)
		if err != nil {
			return nil, err
		}
		for _, host := range stored {
			add(host)
		}
	}
	h.hostsSeen.at, h.hostsSeen.list = now, list
	return list, nil
}

// scopedHosts returns the known hosts the scope allows, for the HostIn
// of a store query.
func (h *Hub) scopedHosts(ctx context.Context, sc *scope) ([]string, error) {
	all, err := h.knownHostList(ctx, time.Now())
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, host := range all {
		if sc.allows(host) {
			out = append(out, host)
		}
	}
	return out, nil
}

// scopeEventQuery and scopeAlertQuery narrow a store query to the scope
// (no-op when unrestricted).
func (h *Hub) scopeEventQuery(ctx context.Context, sc *scope, q store.EventQuery) (store.EventQuery, error) {
	if sc == nil {
		return q, nil
	}
	hosts, err := h.scopedHosts(ctx, sc)
	q.Scoped, q.HostIn = true, hosts
	return q, err
}

func (h *Hub) scopeAlertQuery(ctx context.Context, sc *scope, q store.AlertQuery) (store.AlertQuery, error) {
	if sc == nil {
		return q, nil
	}
	hosts, err := h.scopedHosts(ctx, sc)
	q.Scoped, q.HostIn = true, hosts
	return q, err
}

// alertByID finds an alert in the ring, then in the store.
func (h *Hub) alertByID(ctx context.Context, id string) (alert.Alert, bool, error) {
	h.mu.Lock()
	st := h.store
	for i := len(h.alerts) - 1; i >= 0; i-- {
		if h.alerts[i].ID == id {
			a := h.alerts[i]
			h.mu.Unlock()
			return a, true, nil
		}
	}
	h.mu.Unlock()
	if st == nil {
		return alert.Alert{}, false, nil
	}
	return st.AlertByID(ctx, id)
}

// alertHosts returns the hosts of the alerts that can be found (ring or
// store) and whether every id was found.
func (h *Hub) alertHosts(ctx context.Context, ids []string) (hosts []string, all bool, err error) {
	all = true
	for _, id := range ids {
		a, ok, err := h.alertByID(ctx, id)
		if err != nil {
			return nil, false, err
		}
		if !ok {
			all = false
			continue
		}
		hosts = append(hosts, a.Host)
	}
	return hosts, all, nil
}
