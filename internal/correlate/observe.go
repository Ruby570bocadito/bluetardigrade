package correlate

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// Observe feeds one rule hit into every sequence that references it.
// Completing a sequence emits one alert and re-arms the chain.
func (m *Manager) Observe(ev *model.Event, ruleName string) {
	if ev == nil || ruleName == "" {
		return
	}
	m.mu.Lock()
	wall := m.clock()
	ts := ev.DetectionTime(wall)
	emit := m.emit
	var completed []alert.Alert
	hostLower := strings.ToLower(ev.Host) // hoisted (sesión 100agentes-2, agente 24): 1 alloc por EVENTO, no por secuencia referenciadora
	for _, c := range m.seqs {
		if !c.references(ruleName) {
			continue
		}
		entity := hostLower
		if c.scope == ScopeUser {
			account := trackedAccount(ev.User)
			if account == "" {
				continue // no user, or a service account shared by every host
			}
			entity = "user:" + account
		}
		key := stateKey{seqID: c.seq.ID, host: entity}
		st := m.state[key]
		if st == nil || st.fp != c.fp {
			// st.fp != c.fp: the sequence's steps changed under
			// a hot-reload — old progress maps to a layout that
			// no longer exists, so the chain restarts (the
			// Reload prune handles the map-wide pass; this
			// guard covers the state before its next prune).
			if st == nil {
				if len(m.state) >= maxTrackedStates && !m.reclaimLocked(wall, false) {
					continue
				}
			}
			st = &state{fp: c.fp, at: map[int]time.Time{}, hosts: map[string]string{}}
		}
		if h := strings.ToLower(ev.Host); h != "" && len(st.hosts) < maxMinHosts {
			if _, ok := st.hosts[h]; !ok {
				st.hosts[h] = ev.Host
			}
		}
		// Any contributing event marked as simulated flags the whole
		// chain: the alert fired on completion carries the same tag.
		if alert.EventIsSimulated(ev) {
			st.simulated = true
		}
		// Pick the step this hit advances: an unmatched step naming
		// the rule wins; otherwise the matched one holding the OLDEST
		// time is refreshed, but only by a newer hit (a late, older
		// event never pushes recorded progress back in time).
		stepIdx := -1
		for i := range c.seq.Steps {
			if !contains(c.steps[i], ruleName) {
				continue
			}
			prev, seen := st.at[i]
			if !seen {
				stepIdx = i
				break
			}
			if ts.After(prev) && (stepIdx < 0 || prev.Before(st.at[stepIdx])) {
				stepIdx = i
			}
		}
		if stepIdx < 0 {
			continue
		}
		st.at[stepIdx] = ts
		st.expires = wall.Add(c.window)
		// el host-scope no mira st.hosts: la entidad de la clave YA es
		// el host (state.go) y compile garantiza minHosts==1 sin
		// scope:user — un feed con Host vacío nunca registraba
		// st.hosts y clavaba la cadena hasta expirar sin alertar
		// (sesión 100agentes-3, agente 35/48, P2)
		hostsOK := c.scope == ScopeHost || len(st.hosts) >= c.minHosts
		if span := st.span(); span > c.window {
			// re-anclaje: pasos con t < ts-window ya no pueden
			// completar NINGUNA cadena futura anclada en ts' >= ts;
			// soltar el ancla vieja evita el estado inmortal que se
			// refrescaba expires en cada hit sin poder completar
			// (agente 35/48, P3)
			stale := ts.Add(-c.window)
			for i, t := range st.at {
				if t.Before(stale) {
					delete(st.at, i)
				}
			}
		} else if len(st.at) == len(c.seq.Steps) && hostsOK {
			completed = append(completed, m.fire(c, span, ev, st))
			delete(m.state, key) // re-arm
			continue
		}
		m.state[key] = st
	}
	m.mu.Unlock()
	// Deliver OUTSIDE mu (the accumulated O1 — the
	// same pattern beacon had): the pipeline takes the hub lock and
	// can block on SQLite, webhook and risk, and no stats read should
	// queue behind delivery under this manager's lock. Chain state
	// transitions stay atomic under mu; only delivery moves out. One
	// Observe emits its completions in detection order and the engine
	// observes from one goroutine, so delivery order on every real
	// path is unchanged. emit was captured under mu, so SetEmit stays
	// race-free.
	for _, a := range completed {
		if emit != nil {
			emit(a)
		}
	}
}

// trackedAccount normalizes the account a user-scoped chain follows, or
// returns "" for accounts that are the same name on every machine and
// would stitch unrelated hosts together: built-in service identities
// (SYSTEM, LOCAL SERVICE, NETWORK SERVICE, anonymous logon, in any
// Windows language), virtual service accounts (NT SERVICE\x, IIS
// APPPOOL\x, DWM-n, UMFD-n), machine accounts (NAME$) and, for sensors
// that report SIDs (the ETW sensor), every well-known SID: only user
// SIDs (S-1-5-21-..., Entra ID S-1-12-1-...) are followed.
func trackedAccount(user string) string {
	u := strings.ToLower(strings.TrimSpace(user))
	if u == "" || u == "-" {
		return ""
	}
	if strings.HasPrefix(u, "s-1-") {
		if strings.HasPrefix(u, "s-1-5-21-") || strings.HasPrefix(u, "s-1-12-1-") {
			return u
		}
		return ""
	}
	domain, name := "", u
	if i := strings.LastIndexAny(u, `\/`); i >= 0 {
		domain, name = u[:i], u[i+1:]
	}
	if builtinAuthority(domain) {
		return ""
	}
	switch name {
	case "", "system", "sistema", "système", "systeme", "local service", "network service", "localservice", "networkservice",
		"servicio local", "servicio de red", "anonymous logon", "inicio de sesión anónimo", "inicio de sesion anonimo":
		return ""
	}
	if strings.HasSuffix(name, "$") {
		return "" // machine accounts
	}
	for _, prefix := range []string{"dwm-", "umfd-"} {
		if rest, ok := strings.CutPrefix(name, prefix); ok && rest != "" && strings.Trim(rest, "0123456789") == "" {
			return "" // Window Manager / Font Driver Host session accounts
		}
	}
	return u
}

// builtinAuthority reports whether a domain part names Windows itself
// rather than a directory: NT AUTHORITY (localized: AUTORIDAD NT,
// AUTORITE NT, NT-AUTORITÄT...), NT SERVICE, IIS APPPOOL, Window Manager,
// Font Driver Host, NT VIRTUAL MACHINE.
func builtinAuthority(domain string) bool {
	switch domain {
	case "nt service", "iis apppool", "window manager", "font driver host", "nt virtual machine":
		return true
	}
	return strings.Contains(domain, "nt") && (strings.Contains(domain, "author") || strings.Contains(domain, "autor"))
}

// fire builds the sequence alert for a completed chain. Caller holds
// mu; the returned alert is delivered by Observe AFTER mu is released —
// the pipeline takes the hub lock and can block, and no stats read
// should queue behind that (see Observe).
func (m *Manager) fire(c *compiled, span time.Duration, ev *model.Event, st *state) alert.Alert {
	steps := make([]string, 0, len(c.steps))
	for _, names := range c.steps {
		steps = append(steps, stepLabel(names))
	}
	span = span.Round(time.Second)
	summary := fmt.Sprintf("%s en %d pasos: %s", strings.Join(steps, " -> "), len(steps), span)
	if c.scope == ScopeUser {
		hosts := make([]string, 0, len(st.hosts))
		for _, h := range st.hosts {
			hosts = append(hosts, h)
		}
		sort.Strings(hosts)
		summary = fmt.Sprintf("la cuenta %s en %d equipos (%s): %s, en %s",
			ev.User, len(hosts), strings.Join(hosts, ", "), strings.Join(steps, " -> "), span)
	}
	a := alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    c.seq.ID,
		RuleName:  c.seq.Name,
		Severity:  c.seq.Severity,
		Host:      ev.Host,
		User:      ev.User,
		EventID:   ev.ID,
		EventType: ev.Type,
		Summary:   summary,
		MatchedOn: steps,
		Tags:      c.seq.Tags,
		Enrich:    ev.Enrichment,
	}
	if st.simulated {
		alert.MarkSimulated(&a)
	}
	return a
}
