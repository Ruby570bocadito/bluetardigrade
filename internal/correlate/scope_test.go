package correlate

import (
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func userEv(host, user string, offset time.Duration) *model.Event {
	e := ev(host, offset)
	e.User = user
	return e
}

const lateralYAML = `
- name: "Credenciales y ejecucion remota en varios equipos"
  id: lat-1
  severity: critical
  window: 1h
  scope: user
  min_hosts: 2
  steps:
    - rules: ["Volcado A", "Volcado B"]
    - rules: ["PsExec", "WMI remoto"]
- name: "Cuenta saltando entre equipos"
  id: lat-2
  severity: high
  window: 1h
  scope: user
  min_hosts: 3
  steps:
    - rules: ["PsExec", "WMI remoto"]
`

func TestAlternativeRulesAdvanceAStep(t *testing.T) {
	c := &collector{}
	m, err := LoadDir(writeSeq(t, `
- name: "Cadena"
  id: alt-1
  severity: high
  window: 5m
  steps:
    - rules: ["Volcado A", "Volcado B"]
    - rule: "PsExec"
`), c.emit)
	if err != nil {
		t.Fatal(err)
	}
	m.Observe(ev("PC-01", 0), "Volcado B")
	m.Observe(ev("PC-01", time.Minute), "PsExec")
	if c.count() != 1 {
		t.Fatalf("an alternative must advance its step: %d alerts", c.count())
	}
	if got := c.alerts[0].Summary; !strings.Contains(got, "Volcado A | Volcado B -> PsExec") {
		t.Fatalf("summary: %q", got)
	}
	info := m.Snapshot()[0]
	if info.Scope != ScopeHost || info.MinHosts != 1 || len(info.StepRules[0]) != 2 || info.Steps[0] != "Volcado A | Volcado B" {
		t.Fatalf("snapshot: %+v", info)
	}
}

func TestUserScopeFollowsOneAccountAcrossHosts(t *testing.T) {
	c := &collector{}
	m, err := LoadDir(writeSeq(t, lateralYAML), c.emit)
	if err != nil {
		t.Fatal(err)
	}
	// both steps on ONE host: not lateral, no alert
	m.Observe(userEv("PC-01", `CORP\ana`, 0), "Volcado A")
	m.Observe(userEv("PC-01", `CORP\ana`, time.Minute), "PsExec")
	if c.count() != 0 {
		t.Fatalf("one host is not lateral movement: %+v", c.alerts)
	}
	// the same account on a second host completes the 2-host chain
	m.Observe(userEv("SRV-02", `corp\ANA`, 2*time.Minute), "WMI remoto")
	if c.count() != 1 {
		t.Fatalf("expected the cross-host chain, got %d", c.count())
	}
	a := c.alerts[0]
	if a.RuleID != "lat-1" || !strings.Contains(a.Summary, "2 equipos") || !strings.Contains(a.Summary, "PC-01") || !strings.Contains(a.Summary, "SRV-02") {
		t.Fatalf("alert: %+v", a)
	}
}

func TestUserScopeSkipsServiceAccountsAndOtherUsers(t *testing.T) {
	c := &collector{}
	m, _ := LoadDir(writeSeq(t, lateralYAML), c.emit)
	for i, host := range []string{"A", "B", "C", "D"} {
		m.Observe(userEv(host, `NT AUTHORITY\SYSTEM`, time.Duration(i)*time.Minute), "PsExec")
		m.Observe(userEv(host, `CORP\PC-0`+host+`$`, time.Duration(i)*time.Minute), "PsExec")
	}
	if c.count() != 0 {
		t.Fatalf("service and machine accounts are never followed: %+v", c.alerts)
	}
	m.Observe(userEv("A", `CORP\ana`, 0), "PsExec")
	m.Observe(userEv("B", `CORP\luis`, time.Minute), "PsExec")
	m.Observe(userEv("C", `CORP\marta`, 2*time.Minute), "PsExec")
	if c.count() != 0 {
		t.Fatalf("three different users are not one account hopping: %+v", c.alerts)
	}
	m.Observe(userEv("B", `CORP\ana`, 3*time.Minute), "WMI remoto")
	m.Observe(userEv("C", `CORP\ana`, 4*time.Minute), "PsExec")
	if c.count() != 1 || c.alerts[0].RuleID != "lat-2" || !strings.Contains(c.alerts[0].Summary, "3 equipos") {
		t.Fatalf("one account on three hosts: %+v", c.alerts)
	}
}

func TestScopeValidation(t *testing.T) {
	bad := []string{
		"- {name: a, id: a, severity: high, scope: planet, steps: [{rule: x}, {rule: y}]}",
		"- {name: a, id: a, severity: high, min_hosts: 2, steps: [{rule: x}, {rule: y}]}",
		"- {name: a, id: a, severity: high, scope: user, min_hosts: 99, steps: [{rule: x}, {rule: y}]}",
		"- {name: a, id: a, severity: high, scope: user, steps: [{rule: x}]}",
		"- {name: a, id: a, severity: high, steps: [{rules: []}, {rule: y}]}",
	}
	for _, body := range bad {
		if _, err := LoadDir(writeSeq(t, body), nil); err == nil {
			t.Fatalf("accepted: %s", body)
		}
	}
	if _, err := LoadDir(writeSeq(t, "- {name: a, id: a, severity: high, scope: user, min_hosts: 2, steps: [{rule: x}]}"), nil); err != nil {
		t.Fatalf("a single step repeated across hosts is valid: %v", err)
	}
	if trackedAccount(`CORP\ana`) != `corp\ana` || trackedAccount("SYSTEM") != "" || trackedAccount(`corp\srv01$`) != "" || trackedAccount(" ") != "" {
		t.Fatal("trackedAccount")
	}
}
