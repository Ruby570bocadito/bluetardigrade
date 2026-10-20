package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/forensic"
	"github.com/Ruby570bocadito/bluetardigrade/internal/hostgroup"
	"github.com/Ruby570bocadito/bluetardigrade/internal/incident"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// scopedHub: the groupsDoc groups over the groupsFleet machines, one
// alert and one event per machine. With withStore the records live in
// SQLite and the rings are empty, so both backends are exercised.
func scopedHub(t *testing.T, withStore bool) (*Hub, string, map[string]string) {
	t.Helper()
	h, addr := newTestHub(t)
	groupsFleet(t, h)
	set, err := hostgroup.Parse([]byte(groupsDoc))
	if err != nil {
		t.Fatal(err)
	}
	h.SetHostGroups(filepath.Join(t.TempDir(), "host-groups.yaml"), set, [32]byte{})
	var st *store.Store
	if withStore {
		if st, err = store.Open(filepath.Join(t.TempDir(), "sf.db")); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { st.Close() })
	}
	ids := map[string]string{}
	now := time.Now().UTC()
	for i, host := range []string{"PC-MAD-01", "SRV-01", "laptop-9.corp.example.invalid", "PC-BCN-02"} {
		ev := &model.Event{ID: fmt.Sprintf("ev-%d", i), Timestamp: now, Type: model.TypeProcessCreate, Host: host}
		a := alert.Alert{ID: fmt.Sprintf("00000000000000a%d", i), RuleID: "r", RuleName: "regla", Severity: "high", Host: host, Timestamp: now.Format(time.RFC3339Nano)}
		ids[host] = a.ID
		if st != nil {
			if err := st.InsertEvent(ev); err != nil {
				t.Fatal(err)
			}
			if err := st.InsertAlert(a); err != nil {
				t.Fatal(err)
			}
			continue
		}
		h.RecordEvent(ev)
		h.RecordAlert(a)
	}
	if st != nil {
		h.SetStore(st)
	}
	return h, addr, ids
}

// scoped sends one request as a caller limited to groups (nil: none).
func scoped(t *testing.T, method, url string, groups *string, body string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if groups != nil {
		req.Header.Set(ScopeHeader, *groups)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(raw)
}

func ptr(s string) *string { return &s }

func hostsOf(t *testing.T, body string) []string {
	t.Helper()
	var rows []struct {
		Host string `json:"host"`
	}
	if err := json.Unmarshal([]byte(body), &rows); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	out := []string{}
	for _, r := range rows {
		out = append(out, r.Host)
	}
	sort.Strings(out)
	return out
}

func TestScopeNarrowsListsSearchAndExports(t *testing.T) {
	for _, withStore := range []bool{false, true} {
		t.Run(fmt.Sprintf("store=%v", withStore), func(t *testing.T) {
			_, addr, _ := scopedHub(t, withStore)
			base := "http://" + addr
			madrid := []string{"PC-MAD-01", "laptop-9.corp.example.invalid"}
			for _, tc := range []struct {
				groups *string
				want   []string
			}{
				{nil, []string{"PC-BCN-02", "PC-MAD-01", "SRV-01", "laptop-9.corp.example.invalid"}},
				{ptr("madrid"), madrid},
				{ptr("madrid, servidores"), []string{"PC-MAD-01", "SRV-01", "laptop-9.corp.example.invalid"}},
				{ptr("no-existe"), []string{}},
				{ptr(""), []string{}},
				{ptr("vacio"), []string{}},
			} {
				for _, path := range []string{"/api/events", "/api/alerts"} {
					code, body := scoped(t, "GET", base+path, tc.groups, "")
					if code != 200 {
						t.Fatalf("%s: %d %s", path, code, body)
					}
					if got := hostsOf(t, body); strings.Join(got, ",") != strings.Join(tc.want, ",") {
						t.Errorf("%s scope=%v: %v, want %v", path, tc.groups, got, tc.want)
					}
				}
			}
			// an explicit host outside the scope finds nothing
			if _, body := scoped(t, "GET", base+"/api/alerts?host=pc-bcn-02", ptr("madrid"), ""); len(hostsOf(t, body)) != 0 {
				t.Errorf("host filter escaped the scope: %s", body)
			}
			code, body := scoped(t, "GET", base+"/api/alerts/search", ptr("madrid"), "")
			var page alertSearchPage
			if code != 200 || json.Unmarshal([]byte(body), &page) != nil || len(page.Items) != 2 {
				t.Fatalf("search: %d %s", code, body)
			}
			for _, it := range page.Items {
				if it.Host == "PC-BCN-02" || it.Host == "SRV-01" {
					t.Errorf("search leaked %s", it.Host)
				}
			}
			for _, path := range []string{"/api/alerts/export?format=jsonl", "/api/events/export?format=jsonl"} {
				_, body := scoped(t, "GET", base+path, ptr("madrid"), "")
				if strings.Contains(body, "PC-BCN-02") || strings.Contains(body, "SRV-01") || !strings.Contains(body, "PC-MAD-01") {
					t.Errorf("%s: %s", path, body)
				}
			}
			for _, path := range []string{"/api/noise", "/api/reports/executive", "/api/reports/fleet"} {
				code, body := scoped(t, "GET", base+path, ptr("madrid"), "")
				if code != 200 || strings.Contains(body, "PC-BCN-02") || strings.Contains(body, "SRV-01") {
					t.Errorf("%s: %d %s", path, code, body)
				}
			}
		})
	}
}

func TestScopeOnSingleRecords(t *testing.T) {
	for _, withStore := range []bool{false, true} {
		t.Run(fmt.Sprintf("store=%v", withStore), func(t *testing.T) {
			_, addr, ids := scopedHub(t, withStore)
			base := "http://" + addr
			status := `{"status":"acknowledged"}`
			if code, body := scoped(t, "POST", base+"/api/alerts/"+ids["PC-BCN-02"]+"/status", ptr("madrid"), status); code != http.StatusNotFound {
				t.Errorf("triage outside the scope: %d %s", code, body)
			}
			if code, body := scoped(t, "POST", base+"/api/alerts/ffffffffffffffff/status", ptr("madrid"), status); code != http.StatusNotFound {
				t.Errorf("triage of an unknown alert, scoped: %d %s", code, body)
			}
			if code, body := scoped(t, "POST", base+"/api/alerts/"+ids["PC-MAD-01"]+"/status", ptr("madrid"), status); code != 200 {
				t.Errorf("triage inside the scope: %d %s", code, body)
			}
			if code, body := scoped(t, "POST", base+"/api/alerts/ffffffffffffffff/status", nil, status); code != 200 {
				t.Errorf("unrestricted triage of an evicted alert: %d %s", code, body)
			}
			_, body := scoped(t, "GET", base+"/api/baseline?host=PC-BCN-02", ptr("madrid"), "")
			if strings.Contains(body, `"known":true`) {
				t.Errorf("baseline outside the scope: %s", body)
			}
		})
	}
}

func TestScopeOnIncidents(t *testing.T) {
	_, addr, ids := scopedHub(t, true)
	base := "http://" + addr
	open := func(groups *string, body string) (int, incident.Incident) {
		t.Helper()
		code, raw := scoped(t, "POST", base+"/api/incidents", groups, body)
		var inc incident.Incident
		_ = json.Unmarshal([]byte(raw), &inc)
		return code, inc
	}
	code, mixed := open(nil, `{"title":"mixto","hosts":["PC-MAD-01","PC-BCN-02"]}`)
	if code != http.StatusCreated {
		t.Fatalf("unrestricted create: %d", code)
	}
	_, own := open(nil, `{"title":"madrid","hosts":["PC-MAD-01"]}`)
	_, nobody := open(nil, `{"title":"sin equipos"}`)

	_, body := scoped(t, "GET", base+"/api/incidents", ptr("madrid"), "")
	if !strings.Contains(body, own.ID) || strings.Contains(body, mixed.ID) || strings.Contains(body, nobody.ID) {
		t.Errorf("scoped list: %s", body)
	}
	if _, body := scoped(t, "GET", base+"/api/incidents", nil, ""); !strings.Contains(body, mixed.ID) || !strings.Contains(body, nobody.ID) {
		t.Errorf("unrestricted list lost incidents: %s", body)
	}
	for _, tc := range []struct{ method, path, body string }{
		{"GET", "/api/incidents/" + mixed.ID, ""},
		{"PATCH", "/api/incidents/" + mixed.ID, `{"status":"closed"}`},
		{"POST", "/api/incidents/" + mixed.ID + "/notes", `{"text":"x"}`},
		{"POST", "/api/incidents/" + mixed.ID + "/alerts", `{"alert_ids":["` + ids["PC-MAD-01"] + `"]}`},
		{"GET", "/api/reports/incident?id=" + mixed.ID, ""},
	} {
		if code, body := scoped(t, tc.method, base+tc.path, ptr("madrid"), tc.body); code != http.StatusNotFound {
			t.Errorf("%s %s on a mixed incident: %d %s", tc.method, tc.path, code, body)
		}
	}
	if code, body := scoped(t, "POST", base+"/api/incidents/"+own.ID+"/notes", ptr("madrid"), `{"text":"visto"}`); code != 200 {
		t.Errorf("note on an own incident: %d %s", code, body)
	}
	// adding another group's machine or alert to an own incident
	if code, _ := scoped(t, "POST", base+"/api/incidents/"+own.ID+"/alerts", ptr("madrid"), `{"hosts":["PC-BCN-02"]}`); code != http.StatusForbidden {
		t.Errorf("foreign host added: %d", code)
	}
	if code, _ := scoped(t, "POST", base+"/api/incidents/"+own.ID+"/alerts", ptr("madrid"), `{"alert_ids":["`+ids["PC-BCN-02"]+`"]}`); code != http.StatusNotFound {
		t.Errorf("foreign alert added: %d", code)
	}
	// scoped creation: own alert ok (its machine comes from the store),
	// a foreign one 404, none at all 400
	if code, inc := open(ptr("madrid"), `{"title":"x","alert_ids":["`+ids["laptop-9.corp.example.invalid"]+`"]}`); code != http.StatusCreated || len(inc.Hosts) != 1 {
		t.Errorf("scoped create from an own alert: %d %+v", code, inc)
	}
	if code, _ := open(ptr("madrid"), `{"title":"x","alert_ids":["`+ids["SRV-01"]+`"]}`); code != http.StatusNotFound {
		t.Errorf("scoped create from a foreign alert: %d", code)
	}
	if code, _ := open(ptr("madrid"), `{"title":"x"}`); code != http.StatusBadRequest {
		t.Errorf("scoped create without machines: %d", code)
	}
}

func TestScopeOnFleetGroupsStatsAndPlatform(t *testing.T) {
	h, addr, _ := scopedHub(t, false)
	base := "http://" + addr
	_, body := scoped(t, "GET", base+"/api/fleet", ptr("madrid"), "")
	var fl struct {
		Hosts []struct {
			Host string `json:"host"`
		} `json:"hosts"`
	}
	if json.Unmarshal([]byte(body), &fl) != nil || len(fl.Hosts) != 2 {
		t.Errorf("scoped fleet: %s", body)
	}
	_, body = scoped(t, "GET", base+"/api/groups", ptr("madrid"), "")
	var gp groupsPayload
	if json.Unmarshal([]byte(body), &gp) != nil || len(gp.Groups) != 1 || gp.Groups[0].Name != "madrid" || len(gp.Ungrouped) != 0 {
		t.Errorf("scoped groups: %s", body)
	}
	_, body = scoped(t, "GET", base+"/api/stats", ptr("madrid"), "")
	var st statsPayload
	if json.Unmarshal([]byte(body), &st) != nil || !st.Scoped || st.AlertsTotal != 2 || st.BySeverity["high"] != 2 || st.EventsTotal != 2 || st.RiskHostsTracked != 2 {
		t.Errorf("scoped stats: %+v", st)
	}
	for _, hr := range st.HotHosts {
		if hr.Host == "PC-BCN-02" || hr.Host == "SRV-01" {
			t.Errorf("hot host leaked: %s", hr.Host)
		}
	}
	_, body = scoped(t, "GET", base+"/api/stats", nil, "")
	var all statsPayload
	if json.Unmarshal([]byte(body), &all) != nil || all.Scoped || all.AlertsTotal != 4 {
		t.Errorf("unrestricted stats: %+v", all)
	}
	h.mu.Lock()
	h.writeEnabled = true
	h.mu.Unlock()
	for _, tc := range []struct{ method, path string }{
		{"GET", "/metrics"},
		{"GET", "/api/ad/status"},
		{"GET", "/api/ad/posture"},
		{"GET", "/api/ad/objects/computer"},
		{"GET", "/api/settings/ad"},
		{"PUT", "/api/settings/ad"},
		{"POST", "/api/ad/test"},
		{"PUT", "/api/settings/groups"},
		{"POST", "/api/enroll/tokens"},
	} {
		if code, body := scoped(t, tc.method, base+tc.path, ptr("madrid"), "{}"); code != http.StatusForbidden || !strings.Contains(body, "limitada a grupos") {
			t.Errorf("%s %s scoped: %d %s", tc.method, tc.path, code, body)
		}
	}
	if code, _ := scoped(t, "GET", base+"/metrics", nil, ""); code != 200 {
		t.Errorf("unrestricted /metrics: %d", code)
	}
}

func TestScopeOnSuppressions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "suppressions.yaml")
	if err := suppress.SaveFile(path, []suppress.Entry{
		{RuleID: "r", Host: "pc-bcn-02", Reason: "otra sede"},
		{RuleID: "r2", Reason: "todas"},
	}); err != nil {
		t.Fatal(err)
	}
	h, addr, _ := scopedHub(t, false)
	m := suppress.New()
	if err := m.LoadFile(path); err != nil {
		t.Fatal(err)
	}
	h.SetSuppressions(m)
	h.EnableSuppressionsWrite(path)
	base := "http://" + addr
	if _, body := scoped(t, "GET", base+"/api/suppressions", ptr("madrid"), ""); strings.Contains(body, "pc-bcn-02") || !strings.Contains(body, "todas") {
		t.Errorf("scoped list: %s", body)
	}
	for _, body := range []string{`{"rule_id":"r","reason":"x"}`, `{"rule_id":"r","host":"pc-bcn-02","reason":"x"}`} {
		if code, out := scoped(t, "POST", base+"/api/suppressions", ptr("madrid"), body); code != http.StatusForbidden {
			t.Errorf("scoped create %s: %d %s", body, code, out)
		}
	}
	if code, out := scoped(t, "DELETE", base+"/api/suppressions?rule_id=r&host=pc-bcn-02", ptr("madrid"), ""); code != http.StatusForbidden {
		t.Errorf("scoped delete of a foreign entry: %d %s", code, out)
	}
	code, out := scoped(t, "POST", base+"/api/suppressions", ptr("madrid"), `{"rule_id":"r","host":"pc-mad-01","reason":"propio"}`)
	if code != 200 || strings.Contains(out, "pc-bcn-02") || !strings.Contains(out, "pc-mad-01") {
		t.Errorf("scoped create of an own entry: %d %s", code, out)
	}
}

func TestScopeOnTheStream(t *testing.T) {
	h, addr, _ := scopedHub(t, false)
	req, _ := http.NewRequest("GET", "http://"+addr+"/api/stream", nil)
	req.Header.Set(ScopeHeader, "madrid")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	frames := make(chan string, 16)
	go func() {
		sc := bufio.NewScanner(res.Body)
		var cur strings.Builder
		for sc.Scan() {
			cur.WriteString(sc.Text() + "\n")
			if sc.Text() == "" {
				frames <- cur.String()
				cur.Reset()
			}
		}
	}()
	time.Sleep(150 * time.Millisecond)
	now := time.Now().UTC()
	h.RecordEvent(&model.Event{ID: "ev-foreign", Timestamp: now, Type: model.TypeProcessCreate, Host: "PC-BCN-02"})
	h.broadcast("incident", incident.Incident{ID: "inc-mixed"}, "PC-MAD-01", "PC-BCN-02")
	h.broadcast("incident", incident.Incident{ID: "inc-none"})
	h.RecordEvent(&model.Event{ID: "ev-own", Timestamp: now, Type: model.TypeProcessCreate, Host: "pc-mad-01"})
	deadline := time.After(3 * time.Second)
	for {
		select {
		case f := <-frames:
			for _, leak := range []string{"ev-foreign", "inc-mixed", "inc-none"} {
				if strings.Contains(f, leak) {
					t.Fatalf("scoped stream got %s: %s", leak, f)
				}
			}
			if strings.Contains(f, "ev-own") {
				return
			}
		case <-deadline:
			t.Fatal("the own event never arrived")
		}
	}
}

func TestScopeOnForensicBundles(t *testing.T) {
	h, addr, _ := scopedHub(t, false)
	r := forensic.New(t.TempDir())
	h.SetForensic(r)
	now := time.Now().UTC()
	for id, host := range map[string]string{"0123456789abcd01": "PC-MAD-01", "0123456789abcd02": "PC-BCN-02"} {
		a := alert.Alert{ID: id, Timestamp: now.Format(time.RFC3339), RuleID: "r1", Severity: "critical", Host: host}
		if _, ok, err := r.Capture(a, now); err != nil || !ok {
			t.Fatalf("Capture: %v %v", ok, err)
		}
	}
	base := "http://" + addr + "/api/alerts/"
	if code, _ := scoped(t, "GET", base+"0123456789abcd01/forensics", ptr("madrid"), ""); code != 200 {
		t.Errorf("own bundle: %d", code)
	}
	if code, _ := scoped(t, "GET", base+"0123456789abcd02/forensics", ptr("madrid"), ""); code != http.StatusNotFound {
		t.Errorf("foreign bundle: %d", code)
	}
	if code, _ := scoped(t, "GET", base+"0123456789abcd02/forensics", nil, ""); code != 200 {
		t.Errorf("unrestricted bundle: %d", code)
	}
}
