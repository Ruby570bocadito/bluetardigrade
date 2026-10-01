package main

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/rules"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

func testPanel() *tuiModel {
	s := newLiveStats()
	s.recordAlert(alert.Alert{ID: "first", RuleName: "PowerShell", Host: "LAB-A", Summary: "encoded command", Severity: "high"})
	s.recordAlert(alert.Alert{ID: "second", RuleName: "LSASS", Host: "LAB-B", Summary: "credential access", Severity: "critical"})
	return &tuiModel{stats: s, snap: s.snapshot(), width: 80, height: 24}
}

func panelKey(m *tuiModel, key string) {
	special := map[string]tea.KeyType{
		"enter": tea.KeyEnter, "esc": tea.KeyEsc, "up": tea.KeyUp,
		"down": tea.KeyDown, "end": tea.KeyEnd, "home": tea.KeyHome, "space": tea.KeySpace,
	}
	if kind, ok := special[key]; ok {
		m.Update(tea.KeyMsg{Type: kind})
	} else {
		m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(key)})
	}
}

func TestInteractiveSearchIsContextual(t *testing.T) {
	m := testPanel()
	panelKey(m, "/")
	panelKey(m, "LAB")
	panelKey(m, "space")
	panelKey(m, "q")
	if m.query != "LAB q" || !m.searching {
		t.Fatalf("search must accept space and q as text: %q", m.query)
	}
	panelKey(m, "esc")
	panelKey(m, "/")
	panelKey(m, "lSaSs")
	panelKey(m, "enter")
	if got := m.filteredAlerts(); len(got) != 1 || got[0].ID != "second" {
		t.Fatalf("case-insensitive search failed: %+v", got)
	}
	panelKey(m, "esc")
	panelKey(m, "s") // critical
	if got := m.filteredAlerts(); len(got) != 1 || got[0].Severity != "critical" {
		t.Fatalf("severity filter failed: %+v", got)
	}
}

func TestInteractivePauseDoesNotPauseEngine(t *testing.T) {
	m := testPanel()
	panelKey(m, "p")
	m.stats.recordEvent()
	m.stats.recordAlert(alert.Alert{ID: "third", Severity: "medium"})
	m.Update(tickMsg{})
	if m.snap.alerts != 2 || m.stats.snapshot().alerts != 3 {
		t.Fatal("pause must freeze only the presentation snapshot")
	}
	panelKey(m, "p")
	if m.snap.alerts != 3 || m.snap.events != 1 {
		t.Fatal("resume must catch up immediately")
	}
}

func TestInteractiveHistorySelectionAndEviction(t *testing.T) {
	m := testPanel()
	panelKey(m, "end")
	panelKey(m, "enter")
	m.stats.recordAlert(alert.Alert{ID: "third", Severity: "low"})
	m.Update(tickMsg{})
	if m.filteredAlerts()[m.cursor].ID != "first" {
		t.Fatal("new alerts moved the selected historical detail")
	}
	for i := 0; i < recentAlertsCap; i++ {
		m.stats.recordAlert(alert.Alert{ID: fmt.Sprint(i), Severity: "low"})
	}
	m.Update(tickMsg{})
	if m.detail || m.cursor != 0 || len(m.snap.recent) != recentAlertsCap {
		t.Fatal("eviction must return to the queue instead of showing an unrelated detail")
	}
	panelKey(m, "end")
	for i := 0; i < 150; i++ {
		panelKey(m, "down")
	}
	if m.cursor != m.rowCount()-1 || strings.Contains(m.View(), "Sin coincidencias") {
		t.Fatal("scrolling past the oldest alert must not produce an empty queue")
	}
}

func TestInteractiveRulesFollowReload(t *testing.T) {
	m := testPanel()
	panelKey(m, "2")
	m.stats.setRuleCatalog([]rules.Rule{{ID: "r1", Name: "Regla nueva", Severity: "high"}})
	m.Update(tickMsg{})
	if m.rowCount() != 1 || m.snap.rules != 1 || !strings.Contains(m.View(), "Regla nueva") {
		t.Fatal("catalogue and rule count must refresh together")
	}
	panelKey(m, "enter")
	m.stats.setRuleCatalog([]rules.Rule{
		{ID: "r0", Name: "Insertada", Severity: "high"},
		{ID: "r1", Name: "Regla nueva", Severity: "high"},
	})
	m.Update(tickMsg{})
	if !m.detail || m.filteredRules()[m.cursor].ID != "r1" {
		t.Fatal("hot reload must preserve the selected rule detail")
	}
	m.stats.setRuleCatalog(nil)
	m.Update(tickMsg{})
	if m.detail {
		t.Fatal("removed rules must close their detail instead of switching evidence")
	}
}

func TestInteractiveFramesFitTerminal(t *testing.T) {
	for _, size := range [][2]int{{24, 8}, {32, 12}, {48, 16}, {80, 24}, {120, 40}} {
		m := testPanel()
		m.width, m.height = size[0], size[1]
		m.stats.recordAlert(alert.Alert{ID: "unicode", Host: "主机", Summary: strings.Repeat("alerta界 ", 80), Severity: "high"})
		m.refresh()
		for _, detail := range []bool{false, true} {
			m.detail = detail
			frame := m.View()
			if lipgloss.Width(frame) > size[0] || lipgloss.Height(frame) > size[1] {
				t.Fatalf("%dx%d detail=%v overflow: %dx%d", size[0], size[1], detail, lipgloss.Width(frame), lipgloss.Height(frame))
			}
		}
	}
}

func TestInteractiveBannerAndAlertAreSafe(t *testing.T) {
	banner := renderBanner(tuiMeta{webhookURL: "https://user:password@siem.example/secret-key?token=hidden"}, 1)
	for _, secret := range []string{"user", "password", "secret-key", "hidden"} {
		if strings.Contains(banner, secret) {
			t.Fatalf("banner leaked %q", secret)
		}
	}
	line := alertLine(alert.Alert{Host: "lab\nfake", Summary: "\x1b[2Jattack\u202e.exe", Severity: "high"}, 100)
	if strings.ContainsAny(line, "\x1b\n\u202e") {
		t.Fatalf("unsafe telemetry in alert display: %q", line)
	}
}

func TestRoutedCommandsRejectUnparsedArguments(t *testing.T) {
	for _, command := range []string{"run", "rules", "validate", "sigma"} {
		root := newRootCmd()
		root.SetArgs([]string{command, "typo", "-rules", "missing"})
		if err := root.Execute(); err == nil || !strings.Contains(err.Error(), "argumentos inesperados") {
			t.Fatalf("%s accepted ignored arguments: %v", command, err)
		}
	}
}

func TestCommandOutputUsesCobraWriter(t *testing.T) {
	for _, args := range [][]string{{"help"}, {"run", "-h"}, {"version"}} {
		var out bytes.Buffer
		root := newRootCmd()
		root.SetOut(&out)
		root.SetArgs(args)
		if err := root.Execute(); err != nil || out.Len() == 0 {
			t.Fatalf("%v bypassed its configured output writer: %v", args, err)
		}
	}
}
