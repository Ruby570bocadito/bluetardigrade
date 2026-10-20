package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ad"
	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
	"github.com/Ruby570bocadito/bluetardigrade/internal/hostgroup"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

const groupsDoc = `version: 1
groups:
  - name: madrid
    label: Sede de Madrid
    hosts: ["pc-mad-*"]
    ad_ou: ["OU=Madrid,DC=corp,DC=example,DC=invalid"]
  - name: servidores
    identities: ["sede-servidores"]
  - name: vacio
    hosts: ["nadie-*"]
`

// groupsFleet: PC-MAD-01 by name, SRV-01 by ingest identity, LAPTOP-9
// by its AD computer's OU, PC-BCN-02 in no group.
func groupsFleet(t *testing.T, h *Hub) {
	t.Helper()
	tr := fleet.New()
	now := time.Now()
	tr.Observe(&model.Event{Host: "PC-MAD-01", Type: "process.create"}, "10.0.0.1", now)
	tr.Observe(&model.Event{Host: "SRV-01", Type: "process.create", Attributes: map[string]string{fleet.IdentityAttribute: "sede-servidores"}}, "10.0.0.2", now)
	tr.Observe(&model.Event{Host: "laptop-9.corp.example.invalid", Type: "process.create"}, "10.0.0.3", now)
	tr.Observe(&model.Event{Host: "PC-BCN-02", Type: "process.create"}, "10.0.0.4", now)
	h.SetFleet(tr)

	st, err := store.Open(filepath.Join(t.TempDir(), "ad.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	computers := []*store.ADObject{
		{DN: "CN=LAPTOP-9,OU=Portatiles,OU=Madrid,DC=corp,DC=example,DC=invalid", Kind: store.ADKindComputer, Name: "LAPTOP-9$", Attributes: map[string]string{"dNSHostName": "laptop-9.corp.example.invalid"}},
		{DN: "CN=PC-BCN-02,OU=Barcelona,DC=corp,DC=example,DC=invalid", Kind: store.ADKindComputer, Name: "PC-BCN-02$"},
	}
	if err := st.ReplaceADSnapshot(computers, nil); err != nil {
		t.Fatalf("ReplaceADSnapshot: %v", err)
	}
	conn, err := ad.New(&ad.Config{
		Server:       "dc01.corp.example.invalid",
		BaseDN:       "DC=corp,DC=example,DC=invalid",
		CAFile:       "/nonexistent/ca.pem",
		BindDN:       "CN=svc-ro,DC=corp,DC=example,DC=invalid",
		PasswordFile: "/nonexistent/secret.bin",
	}, st, log.New(io.Discard, "", 0), nil)
	if err != nil {
		t.Fatalf("ad.New: %v", err)
	}
	h.SetAD(conn)
}

func TestGroupsDisarmedAndGated(t *testing.T) {
	h, addr := newTestHub(t)
	var out groupsPayload
	getJSON(t, fmt.Sprintf("http://%s/api/groups", addr), &out)
	if out.Enabled || out.Writable || len(out.Groups) != 0 {
		t.Fatalf("disarmed payload: %+v", out)
	}
	res, body := doJSON(t, "PUT", "http://"+addr+"/api/settings/groups", `{"groups":[]}`)
	if res.StatusCode != http.StatusForbidden || !strings.Contains(body, "-api-write") {
		t.Fatalf("PUT without -api-write: %d %s", res.StatusCode, body)
	}
	h.mu.Lock()
	h.writeEnabled = true
	h.mu.Unlock()
	res, body = doJSON(t, "PUT", "http://"+addr+"/api/settings/groups", `{"groups":[]}`)
	if res.StatusCode != http.StatusNotImplemented || !strings.Contains(body, "-host-groups") {
		t.Fatalf("PUT without -host-groups: %d %s", res.StatusCode, body)
	}
}

func TestGroupsMembershipByNameIdentityAndOU(t *testing.T) {
	h, addr := newTestHub(t)
	groupsFleet(t, h)
	set, err := hostgroup.Parse([]byte(groupsDoc))
	if err != nil {
		t.Fatal(err)
	}
	h.SetHostGroups(filepath.Join(t.TempDir(), "host-groups.yaml"), set, [32]byte{})

	var out groupsPayload
	getJSON(t, fmt.Sprintf("http://%s/api/groups", addr), &out)
	if !out.Enabled || !out.AD || len(out.Groups) != 3 {
		t.Fatalf("payload: %+v", out)
	}
	members := map[string][]string{}
	for _, g := range out.Groups {
		members[g.Name] = g.Members
	}
	want := map[string][]string{
		"madrid":     {"PC-MAD-01", "laptop-9.corp.example.invalid"},
		"servidores": {"SRV-01"},
		"vacio":      {},
	}
	if !reflect.DeepEqual(members, want) {
		t.Fatalf("members = %v, want %v", members, want)
	}
	if !reflect.DeepEqual(out.Ungrouped, []string{"PC-BCN-02"}) {
		t.Fatalf("ungrouped = %v", out.Ungrouped)
	}

	var fl fleetPayload
	getJSON(t, fmt.Sprintf("http://%s/api/fleet", addr), &fl)
	got := map[string][]string{}
	for _, host := range fl.Hosts {
		got[host.Host] = host.Groups
	}
	if !reflect.DeepEqual(got["laptop-9.corp.example.invalid"], []string{"madrid"}) || got["PC-BCN-02"] != nil || !reflect.DeepEqual(got["SRV-01"], []string{"servidores"}) {
		t.Fatalf("fleet groups = %v", got)
	}
}

func TestGroupsPutWritesValidatesAndRefusesDrift(t *testing.T) {
	h, addr := newTestHub(t)
	groupsFleet(t, h)
	path := filepath.Join(t.TempDir(), "host-groups.yaml")
	h.mu.Lock()
	h.writeEnabled = true
	h.mu.Unlock()
	h.SetHostGroups(path, &hostgroup.Set{}, [32]byte{})
	url := "http://" + addr + "/api/settings/groups"

	res, body := doJSON(t, "PUT", url, `{"groups":[{"name":"barcelona","label":"Sede BCN","hosts":["PC-BCN-*"]}]}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("PUT: %d %s", res.StatusCode, body)
	}
	var out groupsPayload
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Groups) != 1 || !reflect.DeepEqual(out.Groups[0].Members, []string{"PC-BCN-02"}) || out.Groups[0].Hosts[0] != "pc-bcn-*" {
		t.Fatalf("PUT answer: %+v", out)
	}
	written, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(written), "name: barcelona") {
		t.Fatalf("file: %v %s", err, written)
	}
	if set, _, err := hostgroup.Load(path); err != nil || !reflect.DeepEqual(set.Names(), []string{"barcelona"}) {
		t.Fatalf("written file does not load back: %v %v", set, err)
	}

	for body, want := range map[string]string{
		`{"groups":[{"name":"Mal"}]}`:                "inválido",
		`{"groups":[{"name":"a"},{"name":"a"}]}`:     "repetido",
		`{"groups":[{"name":"a","hosts":["pc-["]}]}`: "mal formado",
		`{"groups":[{"name":"a","colour":"red"}]}`:   "unknown field",
		`{"groups":`: "invalid JSON",
	} {
		res, got := doJSON(t, "PUT", url, body)
		if res.StatusCode != http.StatusBadRequest || !strings.Contains(got, want) {
			t.Errorf("PUT %s: %d %s (want 400 mentioning %q)", body, res.StatusCode, got, want)
		}
	}
	// a refused PUT leaves the file and the groups as they were
	if again, _ := os.ReadFile(path); string(again) != string(written) {
		t.Fatal("a refused PUT changed the file")
	}

	// a hand edit after the last load or write is never clobbered
	if err := os.WriteFile(path, append(written, []byte("# editado a mano\n")...), 0o600); err != nil {
		t.Fatal(err)
	}
	res, body = doJSON(t, "PUT", url, `{"groups":[]}`)
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("PUT after a hand edit: %d %s", res.StatusCode, body)
	}
}
