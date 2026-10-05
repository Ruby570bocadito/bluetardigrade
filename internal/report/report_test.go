package report

import (
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func at(s string) string { return s }

func testWindow() Window {
	return Window{
		Preset: "24h",
		From:   time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC),
		Until:  time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC),
	}
}

func alert(id, rule, sev, host, ts, status string, tags ...string) AlertInput {
	return AlertInput{
		ID: id, RuleID: rule, RuleName: "rule " + rule, Severity: sev, Host: host,
		Timestamp: ts, Tags: tags, Status: status,
	}
}

// ------------------------------------------------------------- window

func TestParseWindowDefaultsAndAcceptsPresets(t *testing.T) {
	for _, kind := range []string{KindExecutive, KindFleet, KindSoc, KindNoise} {
		w, err := ParseWindow(kind, "")
		if err != nil {
			t.Fatalf("%s default: %v", kind, err)
		}
		if w.Preset == "" || w.From.IsZero() || !w.Until.After(w.From) {
			t.Fatalf("%s default window = %+v", kind, w)
		}
	}
	w, err := ParseWindow(KindNoise, "24h")
	if err != nil || w.Preset != "24h" {
		t.Fatalf("24h preset: %+v, %v", w, err)
	}
	if _, err = ParseWindow(KindNoise, "90d"); err == nil {
		t.Fatal("a window beyond the kind's max must be rejected")
	}
	if _, err = ParseWindow(KindExecutive, "10m"); err == nil {
		t.Fatal("a window below the kind's min must be rejected")
	}
	if _, err = ParseWindow(KindExecutive, "yesterday"); err == nil {
		t.Fatal("a non-duration window must be rejected")
	}
	if _, err = ParseWindow("nope", "24h"); err == nil {
		t.Fatal("an unknown kind must be rejected")
	}
}

// The documented presets of the report catalog ("24h | 7d | 30d") must
// parse: the API catalog, openapi.yaml and the invalid-window error
// message itself advertise them. time.ParseDuration has no day unit,
// so the parser rewrites "<n>d" to hours before parsing; the window
// echoes the requested preset verbatim.
func TestParseWindowAcceptsDocumentedDayPresets(t *testing.T) {
	for _, tc := range []struct {
		kind string
		in   string
		want time.Duration
	}{
		{KindExecutive, "7d", 168 * time.Hour},
		{KindExecutive, "30d", 30 * 24 * time.Hour},
		{KindNoise, "2d", 48 * time.Hour},
		{KindFleet, "1.5d", 36 * time.Hour},
	} {
		w, err := ParseWindow(tc.kind, tc.in)
		if err != nil {
			t.Fatalf("%s window %q: %v", tc.kind, tc.in, err)
		}
		if w.Preset != tc.in {
			t.Fatalf("preset must echo the request verbatim: got %q, want %q", w.Preset, tc.in)
		}
		if d := w.Until.Sub(w.From); d != tc.want {
			t.Fatalf("%q resolved to %s, want %s", tc.in, d, tc.want)
		}
	}
	for _, bad := range []string{"31d", "0d", "-7d", "7dd", "d7", "7 d", "d"} {
		if _, err := ParseWindow(KindExecutive, bad); err == nil {
			t.Fatalf("window %q must be rejected", bad)
		}
	}
}

// ------------------------------------------------------------- tactic

func TestTacticOf(t *testing.T) {
	cases := []struct {
		tags []string
		want string
	}{
		{[]string{"attack.credential-access", "attack.t1003.001"}, "Credential Access"},
		{[]string{"attack.t1003.001", "attack.defense-evasion"}, "Defense Evasion"},
		{[]string{"attack.t1003.001"}, ""},
		{nil, ""},
	}
	for _, c := range cases {
		if got := tacticOf(c.tags); got != c.want {
			t.Fatalf("tacticOf(%v) = %q, want %q", c.tags, got, c.want)
		}
	}
}

// ------------------------------------------------------------- executive

func TestBuildExecutiveCounts(t *testing.T) {
	w := testWindow()
	in := ExecutiveInputs{
		Source: SourceStore,
		Alerts: []AlertInput{
			alert("a1", "R1", "high", "PC-1", at("2026-10-05T10:00:00Z"), "new", "attack.credential-access"),
			alert("a2", "R1", "high", "PC-1", at("2026-10-05T09:00:00Z"), "closed"),
			alert("a3", "R2", "low", "PC-2", at("2026-10-04T13:00:00Z"), "acknowledged", "attack.lateral-movement"),
			// outside the window: excluded
			alert("a4", "R1", "critical", "PC-3", at("2026-10-03T09:00:00Z"), "new"),
		},
		Incidents:    []IncidentTimes{{CreatedAt: "2026-10-05T08:00:00Z", ClosedAt: "2026-10-05T11:00:00Z"}},
		IncidentOpen: 1,
		FleetEnabled: true,
		FleetHosts: []FleetHostInput{
			{Host: "PC-1", Status: "online"},
			{Host: "PC-2", Status: "silent"},
			{Host: "PC-9", Status: "idle"},
		},
	}
	e := BuildExecutive(in, w, w.Until)
	if e.Kind != KindExecutive || e.Source != SourceStore {
		t.Fatalf("envelope = %+v", e)
	}
	if e.AlertsTotal != 3 {
		t.Fatalf("alerts_total = %d, want 3 (the outside-window alert is excluded)", e.AlertsTotal)
	}
	if e.BySeverity["high"] != 2 || e.BySeverity["low"] != 1 || len(e.BySeverity) != 2 {
		t.Fatalf("by_severity = %v", e.BySeverity)
	}
	if e.ByStatus["new"] != 1 || e.ByStatus["closed"] != 1 || e.ByStatus["acknowledged"] != 1 {
		t.Fatalf("by_status = %v", e.ByStatus)
	}
	if e.ByTactic["Credential Access"] != 1 || e.ByTactic["Lateral Movement"] != 1 {
		t.Fatalf("by_tactic = %v", e.ByTactic)
	}
	if e.HostsAffected != 2 {
		t.Fatalf("hosts_affected = %d, want 2", e.HostsAffected)
	}
	if len(e.TopRules) != 2 || e.TopRules[0].RuleID != "R1" || e.TopRules[0].Count != 2 {
		t.Fatalf("top_rules = %+v", e.TopRules)
	}
	if e.Incidents.OpenedInWindow != 1 || e.Incidents.ClosedInWindow != 1 || e.Incidents.Open != 1 {
		t.Fatalf("incidents = %+v", e.Incidents)
	}
	if !e.Fleet.Enabled || e.Fleet.Total != 3 || e.Fleet.Online != 1 || e.Fleet.Silent != 1 || e.Fleet.Idle != 1 {
		t.Fatalf("fleet = %+v", e.Fleet)
	}
}

func TestBuildExecutiveTopRulesCapAndOrder(t *testing.T) {
	in := ExecutiveInputs{Source: SourceRing}
	// Seven rules with descending counts: the summary caps the list at
	// five, count desc then id asc.
	for i := 0; i < 7; i++ {
		rule := "R" + string(rune('1'+i))
		for j := 0; j < 7-i; j++ {
			in.Alerts = append(in.Alerts, alert("a", rule, "low", "PC-1", at("2026-10-05T10:00:00Z"), "new"))
		}
	}
	e := BuildExecutive(in, testWindow(), testWindow().Until)
	if len(e.TopRules) != 5 {
		t.Fatalf("top rules capped at 5, got %d", len(e.TopRules))
	}
	for i, want := range []string{"R1", "R2", "R3", "R4", "R5"} {
		if e.TopRules[i].RuleID != want || e.TopRules[i].Count != 7-i {
			t.Fatalf("top rules[%d] = %+v, want %s", i, e.TopRules[i], want)
		}
	}
}

// ------------------------------------------------------------- fleet

func TestBuildFleetCoverageFlagsNoSignalHosts(t *testing.T) {
	w := testWindow()
	in := FleetInputs{
		Enabled: true,
		Hosts: []FleetHostInput{
			{Host: "PC-B", Status: "online"},
			{Host: "PC-A", Status: "silent"},
			{Host: "PC-C", Status: "idle"},
		},
		EventsInWindow: map[string]int{"PC-B": 400, "PC-A": 0},
		Source:         SourceStore,
	}
	f := BuildFleetCoverage(in, w, w.Until)
	if f.Kind != KindFleet || f.Summary.Total != 3 || f.Summary.NoSignalInWindow != 2 {
		t.Fatalf("summary = %+v", f.Summary)
	}
	// Hosts are ordered by name for deterministic CSV and diffs.
	if f.Hosts[0].Host != "PC-A" || f.Hosts[1].Host != "PC-B" || f.Hosts[2].Host != "PC-C" {
		t.Fatalf("host order = %q %q %q", f.Hosts[0].Host, f.Hosts[1].Host, f.Hosts[2].Host)
	}
	if f.Hosts[1].EventsInWindow != 400 || f.Hosts[0].EventsInWindow != 0 {
		t.Fatalf("events_in_window = %+v", f.Hosts)
	}
	csv := f.CSV()
	if len(csv.Rows) != 3 || csv.Header[0] != "host" {
		t.Fatalf("csv = %+v", csv)
	}
}

func TestBuildFleetCoverageWithoutTrackerIsEnabledFalse(t *testing.T) {
	f := BuildFleetCoverage(FleetInputs{Source: SourceRing}, testWindow(), testWindow().Until)
	if f.Enabled || f.Summary.Total != 0 {
		t.Fatalf("disabled fleet must stay disabled: %+v", f)
	}
}

// ------------------------------------------------------------- soc

func TestBuildSocActivityBucketsAndMeans(t *testing.T) {
	w := testWindow()
	in := SocInputs{
		Source: SourceStore,
		Alerts: []AlertInput{
			{ID: "a1", RuleID: "R1", Severity: "high", Host: "PC-1", Timestamp: "2026-10-05T10:00:00Z", Status: "closed", StatusAt: "2026-10-05T10:30:00Z", StatusBy: "ana"},
			{ID: "a2", RuleID: "R1", Severity: "low", Host: "PC-2", Timestamp: "2026-10-05T09:00:00Z", Status: "acknowledged", StatusAt: "2026-10-05T09:10:00Z", StatusBy: "bob"},
			{ID: "a3", RuleID: "R2", Severity: "medium", Host: "PC-1", Timestamp: "2026-10-05T11:00:00Z", Status: "new"},
		},
		Lifecycle: []LifecycleEvent{
			{AlertID: "a1", Status: "closed", At: "2026-10-05T10:30:00Z", By: "ana"},
			{AlertID: "a2", Status: "acknowledged", At: "2026-10-05T09:10:00Z", By: "bob"},
			// an alert whose content left the ring but whose triage entry
			// remains: the closed work of that day still counts
			{AlertID: "old", Status: "closed", At: "2026-10-04T20:00:00Z", By: "ana"},
		},
	}
	s := BuildSocActivity(in, w, w.Until)
	if s.Kind != KindSoc || s.Created != 3 {
		t.Fatalf("created = %d", s.Created)
	}
	if s.Backlog.New != 1 || s.Backlog.Acknowledged != 1 || s.Backlog.Closed != 1 {
		t.Fatalf("backlog = %+v", s.Backlog)
	}
	if s.MeanTimeToCloseSeconds != 1800 {
		t.Fatalf("mttc = %v, want 1800", s.MeanTimeToCloseSeconds)
	}
	if s.MeanTimeToAckSeconds != 600 {
		t.Fatalf("mtta = %v, want 600", s.MeanTimeToAckSeconds)
	}
	if s.ByOperator["ana"] != 2 || s.ByOperator["bob"] != 1 {
		t.Fatalf("by_operator = %v", s.ByOperator)
	}
	var dayCreated, dayClosed int
	for _, d := range s.Days {
		if d.Day == "2026-10-05" {
			dayCreated, dayClosed = d.Created, d.Closed
		}
	}
	if dayCreated != 3 {
		t.Fatalf("created on 2026-10-05 = %d, want 3", dayCreated)
	}
	if dayClosed != 1 {
		t.Fatalf("closed on 2026-10-05 = %d, want 1 (the unjoined 'old' close lands on 2026-10-04)", dayClosed)
	}
	// Days ascend.
	if len(s.Days) < 2 || s.Days[0].Day >= s.Days[1].Day {
		t.Fatalf("days not ascending: %+v", s.Days)
	}
}

func TestBuildSocActivityNegativeElapsedClampsToZero(t *testing.T) {
	w := testWindow()
	s := BuildSocActivity(SocInputs{
		Alerts: []AlertInput{{
			ID: "a1", RuleID: "R1", Severity: "low", Host: "PC-1",
			Timestamp: "2026-10-05T10:00:00Z", Status: "closed",
			StatusAt: "2026-10-05T09:00:00Z", // status stamped before the alert: skewed clock
		}},
	}, w, w.Until)
	if s.MeanTimeToCloseSeconds != 0 {
		t.Fatalf("negative elapsed must clamp to 0, got %v", s.MeanTimeToCloseSeconds)
	}
}

// ------------------------------------------------------------- incident

func TestBuildIncidentKeepsMissingAlertsListed(t *testing.T) {
	in := IncidentInputs{
		Case: IncidentCase{ID: "0123456789abcdef", Title: "Caso", Severity: "high", Status: "open"},
		Alerts: []IncidentAlert{
			{AlertInput: alert("a1", "R1", "high", "PC-1", at("2026-10-05T10:00:00Z"), "closed"), Found: true},
			{AlertInput: AlertInput{ID: "a2", Status: "new"}, Found: false},
		},
	}
	r := BuildIncident(in, testWindow().Until)
	if r.Kind != KindIncident || len(r.Alerts) != 2 {
		t.Fatalf("report = %+v", r)
	}
	if r.Alerts[0].Found != true || r.Alerts[1].Found != false {
		t.Fatalf("found flags = %v %v", r.Alerts[0].Found, r.Alerts[1].Found)
	}
	csv := r.CSV()
	if len(csv.Rows) != 2 || csv.Rows[1][4] != "new" || csv.Rows[1][5] != "false" {
		t.Fatalf("incident csv = %+v", csv)
	}
}

// ------------------------------------------------------------- noise

func dnsEvent(host, domain, ts string) *model.Event {
	return &model.Event{
		ID: "evt-" + host + "-" + domain, Type: model.TypeNetworkConnect, Host: host,
		Timestamp: mustTime(ts), Network: &model.Network{Protocol: "dns", Domain: domain},
	}
}

func procEvent(host, image, ts, parentName string) *model.Event {
	ev := &model.Event{
		ID: "evt-" + host + "-" + image + ts, Type: model.TypeProcessCreate, Host: host,
		Timestamp: mustTime(ts),
		Process:   &model.Process{Name: "vantage.exe", Image: image, Hashes: model.Hashes{"sha256": "abc"}},
	}
	if parentName != "" {
		ev.Enrichment = map[string]string{"parent_name": parentName}
	}
	return ev
}

func mustTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestBuildNoiseAggregatesProcessesDomainsRules(t *testing.T) {
	w := testWindow()
	in := NoiseInputs{
		Source: SourceStore,
		Events: []*model.Event{
			procEvent("PC-1", `C:\Program Files\Lenovo\vantage.exe`, "2026-10-05T10:00:00Z", ""),
			procEvent("PC-1", `c:\PROGRAM FILES\Lenovo\VANTAGE.EXE`, "2026-10-05T10:01:00Z", "explorer.exe"),
			procEvent("PC-2", `C:\Program Files\Lenovo\vantage.exe`, "2026-10-05T10:02:00Z", "explorer.exe"),
			dnsEvent("PC-1", "Update.Lenovo.com", "2026-10-05T10:00:30Z"),
			dnsEvent("PC-1", "update.lenovo.com", "2026-10-05T10:03:30Z"),
			dnsEvent("PC-2", "www.google.com", "2026-10-05T10:04:30Z"),
		},
		Alerts: []AlertInput{
			alert("a1", "R1", "low", "PC-1", at("2026-10-05T10:00:00Z"), "closed"),
			alert("a2", "R1", "low", "PC-1", at("2026-10-05T10:05:00Z"), "acknowledged"),
			alert("a3", "R1", "medium", "PC-2", at("2026-10-05T10:06:00Z"), "new"),
			alert("a4", "R2", "high", "PC-2", at("2026-10-05T10:07:00Z"), "new"),
		},
	}
	n := BuildNoise(in, w, w.Until)
	if n.Kind != KindNoise || n.Scanned.Events != 6 || n.Scanned.Alerts != 4 || n.Scanned.Truncated {
		t.Fatalf("envelope = %+v", n)
	}
	// Case-insensitive image grouping: 3 boots of the same executable.
	if len(n.Processes) != 1 {
		t.Fatalf("processes = %+v", n.Processes)
	}
	p := n.Processes[0]
	if p.Image != `c:\program files\lenovo\vantage.exe` || p.Count != 3 || p.DistinctHosts != 2 {
		t.Fatalf("process = %+v", p)
	}
	if p.SHA256 != "abc" || p.Parent != "explorer.exe" {
		t.Fatalf("process sample = %+v", p)
	}
	// Case-insensitive DNS grouping.
	if len(n.Domains) != 2 || n.Domains[0].Domain != "update.lenovo.com" || n.Domains[0].Count != 2 {
		t.Fatalf("domains = %+v", n.Domains)
	}
	// Rule aggregation with the triage proxy percentages.
	if len(n.Rules) != 2 {
		t.Fatalf("rules = %+v", n.Rules)
	}
	r1 := n.Rules[0]
	if r1.RuleID != "R1" || r1.Count != 3 || r1.DistinctHosts != 2 {
		t.Fatalf("rule R1 = %+v", r1)
	}
	if r1.ClosedPct != 33.3 || r1.AcknowledgedPct != 33.3 {
		t.Fatalf("R1 percentages = closed %v ack %v", r1.ClosedPct, r1.AcknowledgedPct)
	}
	if r1.BySeverity["low"] != 2 || r1.BySeverity["medium"] != 1 {
		t.Fatalf("R1 severities = %v", r1.BySeverity)
	}
}

func TestBuildNoiseLimitAndOrdering(t *testing.T) {
	w := testWindow()
	in := NoiseInputs{Limit: 2, Source: SourceRing}
	for i := 0; i < 5; i++ {
		d := "d" + string(rune('a'+i)) + ".example"
		for j := 0; j <= i; j++ {
			in.Events = append(in.Events, dnsEvent("PC-1", d, "2026-10-05T10:00:00Z"))
		}
	}
	n := BuildNoise(in, w, w.Until)
	if len(n.Domains) != 2 {
		t.Fatalf("limit respected: %+v", n.Domains)
	}
	if n.Domains[0].Count != 5 || n.Domains[1].Count != 4 {
		t.Fatalf("ordering by count desc: %+v", n.Domains)
	}
}

func TestBuildNoiseIgnoresNonDNSAndNonCreateEvents(t *testing.T) {
	w := testWindow()
	in := NoiseInputs{
		Source: SourceRing,
		Events: []*model.Event{
			{ID: "1", Type: model.TypeNetworkConnect, Host: "PC-1", Timestamp: mustTime("2026-10-05T10:00:00Z"),
				Network: &model.Network{Protocol: "tcp", Domain: "not-a-dns.example"}},
			{ID: "2", Type: model.TypeProcessTerminate, Host: "PC-1", Timestamp: mustTime("2026-10-05T10:00:00Z"),
				Process: &model.Process{Name: "gone.exe"}},
		},
	}
	n := BuildNoise(in, w, w.Until)
	if len(n.Domains) != 0 || len(n.Processes) != 0 {
		t.Fatalf("non-matching events leaked into the aggregates: %+v", n)
	}
}

// ------------------------------------------------------------- csv

func TestSafeCellEscapesFormulaPrefixes(t *testing.T) {
	cases := map[string]string{
		"=cmd":   "'=cmd",
		"+1":     "'+1",
		"-1":     "'-1",
		"@x":     "'@x",
		" plain": " plain", // leading space without a formula char stays
		"=x\n=y": "'=x\n=y",
		"hola":   "hola",
	}
	for in, want := range cases {
		if got := SafeCell(in); got != want {
			t.Fatalf("SafeCell(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExecutiveCSVMetricRowsAreDeterministic(t *testing.T) {
	w := testWindow()
	in := ExecutiveInputs{
		Source: SourceStore,
		Alerts: []AlertInput{
			alert("a1", "R1", "high", "PC-1", at("2026-10-05T10:00:00Z"), "new", "attack.credential-access"),
		},
	}
	first := BuildExecutive(in, w, w.Until).CSV()
	second := BuildExecutive(in, w, w.Until).CSV()
	if len(first.Rows) == 0 || len(first.Rows) != len(second.Rows) {
		t.Fatalf("csv rows differ between runs")
	}
	for i := range first.Rows {
		if strings.Join(first.Rows[i], "|") != strings.Join(second.Rows[i], "|") {
			t.Fatalf("row %d differs: %v vs %v", i, first.Rows[i], second.Rows[i])
		}
	}
}
