package api

// Host groups (F2, internal/hostgroup): which machines belong together
// (a site, a department, an AD OU, servers or workstations). Groups are
// what operator access is scoped by; this file only names them.
//
//   GET /api/groups            the groups, their criteria and the
//                              machines of the inventory each one holds
//   PUT /api/settings/groups   replace every group (the console editor
//                              sends the whole list): validate -> drift
//                              check -> atomic write -> swap
//
// The PUT sits behind -api-write like every settings write (the
// engine's single bearer token has no role model; the console lets
// only administrators send it) and needs -host-groups (the file path).
// A missing file is an empty list: the first PUT creates it. A hand
// edit after startup is never clobbered: the PUT answers 409 until the
// engine is restarted with it.

import (
	"crypto/sha256"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
	"github.com/Ruby570bocadito/bluetardigrade/internal/hostgroup"
)

// groupsMaxBodyBytes caps the PUT body: 64 groups of a few hundred
// short criteria at most.
const groupsMaxBodyBytes = 256 * 1024

// adDNTTL is how long the AD computer -> DN map is reused: the
// connector re-synchronizes every few minutes at most, and the fleet
// view polls every few seconds.
const adDNTTL = time.Minute

type adDNCache struct {
	at     time.Time
	byHost map[string]string
}

// SetHostGroups arms the groups surface with the -host-groups file and
// what the engine loaded from it (sum: the sha256 of the bytes read,
// zero when the file did not exist yet).
func (h *Hub) SetHostGroups(path string, set *hostgroup.Set, sum [sha256.Size]byte) {
	h.mu.Lock()
	h.hostGroupsPath = path
	h.hostGroups = set
	h.hostGroupsSum = sum
	h.mu.Unlock()
}

func (h *Hub) currentHostGroups() (*hostgroup.Set, string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.hostGroups, h.hostGroupsPath
}

// computerDNByHost returns the AD computer DNs by host name (cached), or nil
// without a connector or before its first synchronization.
func (h *Hub) computerDNByHost(now time.Time) map[string]string {
	c := h.adConnector()
	if c == nil {
		return nil
	}
	h.mu.Lock()
	cached := h.computerDN
	h.mu.Unlock()
	if cached.byHost != nil && now.Sub(cached.at) < adDNTTL {
		return cached.byHost
	}
	dnByHost, err := c.ComputerDNByHost()
	if err != nil {
		log.Printf("[API] host groups: AD computers unavailable: %v", err)
		return cached.byHost
	}
	h.mu.Lock()
	h.computerDN = adDNCache{at: now, byHost: dnByHost}
	h.mu.Unlock()
	return dnByHost
}

// groupMember is what membership is decided on for an inventory host.
func groupMember(host fleet.Host, dnByHost map[string]string) hostgroup.Host {
	name := strings.ToLower(host.Host)
	dn := dnByHost[name]
	if dn == "" {
		dn = dnByHost[strings.SplitN(name, ".", 2)[0]]
	}
	return hostgroup.Host{Name: host.Host, Identity: host.Identity, DN: dn}
}

// groupWire is one group as GET /api/groups serves it.
type groupWire struct {
	hostgroup.Group
	// Members are the inventory machines in the group, sorted.
	Members []string `json:"members"`
}

type groupsPayload struct {
	// Enabled is false without -host-groups: groups cannot be saved.
	Enabled bool `json:"enabled"`
	// Writable is false without -api-write.
	Writable bool `json:"writable"`
	// AD tells whether OU criteria can match (a connector is armed).
	AD     bool        `json:"ad"`
	Groups []groupWire `json:"groups"`
	// Ungrouped are the inventory machines in no group.
	Ungrouped []string `json:"ungrouped"`
}

func (h *Hub) groupsPayload(now time.Time) groupsPayload {
	set, path := h.currentHostGroups()
	h.mu.Lock()
	writable, t := h.writeEnabled, h.fleet
	h.mu.Unlock()
	out := groupsPayload{Enabled: path != "", Writable: writable, AD: h.adConnector() != nil, Groups: []groupWire{}, Ungrouped: []string{}}
	members := map[string][]string{}
	if t != nil {
		dnByHost := h.computerDNByHost(now)
		for _, host := range t.Snapshot(now) {
			groups := set.Of(groupMember(host, dnByHost))
			if len(groups) == 0 {
				out.Ungrouped = append(out.Ungrouped, host.Host)
			}
			for _, g := range groups {
				members[g] = append(members[g], host.Host)
			}
		}
	}
	sort.Strings(out.Ungrouped)
	for _, g := range set.Groups() {
		m := members[g.Name]
		sort.Strings(m)
		if m == nil {
			m = []string{}
		}
		out.Groups = append(out.Groups, groupWire{Group: g, Members: m})
	}
	return out
}

func (h *Hub) handleGroups(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, h.groupsPayload(time.Now()))
}

type groupsUpdate struct {
	Groups []hostgroup.Group `json:"groups"`
}

func (h *Hub) handleGroupsPut(w http.ResponseWriter, r *http.Request) {
	set, path := h.currentHostGroups()
	h.mu.Lock()
	writable := h.writeEnabled
	h.mu.Unlock()
	if !writable {
		writeErr(w, http.StatusForbidden, "api writes are disabled: restart the engine with -api-write (or SF_API_WRITE=1) to edit host groups")
		return
	}
	if path == "" {
		writeErr(w, http.StatusNotImplemented, "host groups are not armed: start the engine with -host-groups <file.yaml> (the Windows launcher passes tools\\config\\host-groups.yaml)")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, groupsMaxBodyBytes))
	if err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "body over the host-groups limit")
		return
	}
	var in groupsUpdate
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	next, err := hostgroup.New(in.Groups)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	h.hostGroupsMu.Lock()
	defer h.hostGroupsMu.Unlock()
	// drift: the file must still be what the engine loaded (or wrote)
	h.mu.Lock()
	baseline := h.hostGroupsSum
	h.mu.Unlock()
	var current [sha256.Size]byte
	if raw, err := os.ReadFile(path); err == nil {
		current = sha256.Sum256(raw)
	} else if !os.IsNotExist(err) {
		writeErr(w, http.StatusInternalServerError, "cannot read the host-groups file: "+err.Error())
		return
	}
	if current != baseline {
		writeErr(w, http.StatusConflict, "the host-groups file changed on disk since the engine loaded it: restart the engine to load it, then edit again")
		return
	}
	data, err := next.Marshal()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	sum, err := hostgroup.WriteFile(path, data)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.SetHostGroups(path, next, sum)
	log.Printf("[API] WRITE host-groups groups=%d (was %d) by=api (file %s)", len(next.Names()), len(set.Names()), oneLine(path))
	writeJSON(w, h.groupsPayload(time.Now()))
}
