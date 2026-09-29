// Interactive panel (-i/--interactive): a single bubbletea panel over
// the running engine. It is strictly a presentation layer: the ingest,
// rules, correlate, alert, api and webhook components run exactly as
// in the classic path; the panel only renders a live snapshot of them
// (uptime, events, alerts with severity breakdown, recent alerts and
// the loaded rule set). If stdout is not a TTY the panel is skipped
// and the run degrades to the classic flat output.
package main

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/rules"
	"github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// recentAlertsCap bounds the ring of latest alerts shown in the panel.
const recentAlertsCap = 100

// liveStats is the shared presentation state written by the engine
// loop and read by the panel once per tick.
type liveStats struct {
	mu     sync.Mutex
	start  time.Time
	events uint64
	alerts uint64
	bySev  map[string]int
	recent []alert.Alert
	rules  int
}

func newLiveStats() *liveStats {
	return &liveStats{start: time.Now(), bySev: map[string]int{}}
}

func (s *liveStats) setRules(n int) {
	s.mu.Lock()
	s.rules = n
	s.mu.Unlock()
}

func (s *liveStats) recordEvent() {
	s.mu.Lock()
	s.events++
	s.mu.Unlock()
}

// recordAlert stores one raised alert. Deduplicated hits never reach
// this point (alert.Manager drops them before the observer fires).
func (s *liveStats) recordAlert(a alert.Alert) {
	s.mu.Lock()
	s.alerts++
	s.bySev[a.Severity]++
	if len(s.recent) >= recentAlertsCap {
		copy(s.recent, s.recent[1:])
		s.recent[len(s.recent)-1] = a
	} else {
		s.recent = append(s.recent, a)
	}
	s.mu.Unlock()
}

// statsSnapshot is the immutable view the panel renders per tick.
type statsSnapshot struct {
	events uint64
	alerts uint64
	bySev  map[string]int
	recent []alert.Alert
	uptime time.Duration
	rules  int
}

func (s *liveStats) snapshot() statsSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	bySev := make(map[string]int, len(s.bySev))
	for k, v := range s.bySev {
		bySev[k] = v
	}
	recent := make([]alert.Alert, len(s.recent))
	copy(recent, s.recent)
	return statsSnapshot{
		events: s.events,
		alerts: s.alerts,
		bySev:  bySev,
		recent: recent,
		uptime: time.Since(s.start),
		rules:  s.rules,
	}
}

// tuiMeta is the static configuration the panel shows in its banner.
type tuiMeta struct {
	rulesPath  string
	ruleTypes  []string
	ingestAddr string
	apiAddr    string
	webhookURL string
	seqCount   int
}

type tickMsg struct{}

type tuiModel struct {
	meta   tuiMeta
	stats  *liveStats
	snap   statsSnapshot
	width  int
	height int
	offset int // how many alerts scrolled back from the newest (0 = follow)
}

// runInteractive blocks until the user quits the panel (q/Ctrl+C) or
// the engine context is canceled (SIGTERM from outside).
func runInteractive(ctx context.Context, meta tuiMeta, stats *liveStats) error {
	m := &tuiModel{meta: meta, stats: stats}
	m.snap = stats.snapshot()
	p := tea.NewProgram(m, tea.WithAltScreen())
	// SIGTERM while the panel is up: tear the panel down cleanly; the
	// engine loop then drains and the classic shutdown summary prints.
	go func() {
		<-ctx.Done()
		p.Quit()
	}()
	_, err := p.Run()
	return err
}

func tickCmd() tea.Cmd {
	return tea.Tick(250*time.Millisecond, func(time.Time) tea.Msg { return tickMsg{} })
}

func (m *tuiModel) Init() tea.Cmd {
	return tickCmd()
}

func (m *tuiModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tickMsg:
		m.snap = m.stats.snapshot()
		return m, tickCmd()
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.clampOffset()
		return m, nil
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "Q", "ctrl+c", "esc":
			return m, tea.Quit
		case "up", "k":
			m.offset++
			m.clampOffset()
			return m, nil
		case "down", "j":
			m.offset--
			m.clampOffset()
			return m, nil
		case "pgup":
			m.offset += 10
			m.clampOffset()
			return m, nil
		case "pgdown":
			m.offset -= 10
			m.clampOffset()
			return m, nil
		}
	}
	return m, nil
}

// clampOffset keeps the scroll offset inside [0, len(recent)].
func (m *tuiModel) clampOffset() {
	max := len(m.snap.recent)
	if m.offset > max {
		m.offset = max
	}
	if m.offset < 0 {
		m.offset = 0
	}
}

func (m *tuiModel) View() string {
	banner := renderBanner(m.meta, m.snap.rules)
	stats := statsLine(m.snap)
	rulesLine := dimStyle.Render(fmt.Sprintf("reglas %d  %s  tipos: %s",
		m.snap.rules, m.meta.rulesPath, strings.Join(m.meta.ruleTypes, ", ")))
	footer := dimStyle.Render("q/ctrl+c salir   up/down scroll   pgup/pgdn salto")

	used := lipgloss.Height(banner) + lipgloss.Height(stats) +
		lipgloss.Height(rulesLine) + lipgloss.Height(footer) + 3
	boxH := m.height - used
	if boxH < 5 {
		boxH = 5
	}
	title := "ULTIMAS ALERTAS"
	if n := len(m.snap.recent); n > 0 {
		title += fmt.Sprintf(" (%d)", n)
	}
	if m.offset > 0 {
		title += fmt.Sprintf("  +%d en el historico", m.offset)
	}
	box := alertsBox(m.snap, m.width, boxH, m.offset)

	return lipgloss.JoinVertical(lipgloss.Left,
		banner, stats,
		dimStyle.Render(title), box, rulesLine, footer)
}

// statsLine is the live KPI row: uptime, events, alerts and the
// severity breakdown, each with its palette color.
func statsLine(s statsSnapshot) string {
	cell := func(label, value string) string {
		return dimStyle.Render(label+" ") + lipgloss.NewStyle().Bold(true).Render(value)
	}
	parts := []string{
		cell("uptime", s.uptime.Round(time.Second).String()),
		cell("eventos", fmt.Sprintf("%d", s.events)),
		cell("alertas", fmt.Sprintf("%d", s.alerts)),
		severityBreakdown(s.bySev),
	}
	return strings.Join(parts, "   ")
}

// severityBreakdown renders CRITICAL/HIGH/MEDIUM/LOW/INFO counts in
// their severity colors (dim when zero).
func severityBreakdown(bySev map[string]int) string {
	order := []string{rules.SevCritical, rules.SevHigh, rules.SevMedium, rules.SevLow, rules.SevInfo}
	parts := make([]string, 0, len(order))
	for _, sev := range order {
		label := strings.ToUpper(sev)
		n := bySev[sev]
		if n == 0 {
			parts = append(parts, dimStyle.Render(label+" 0"))
			continue
		}
		parts = append(parts, sevStyle(sev).Render(fmt.Sprintf("%s %d", label, n)))
	}
	return strings.Join(parts, "  ")
}

// alertsBox renders the scrolling recent-alerts panel: height is the
// outer height (border included), offset scrolls back in history.
func alertsBox(s statsSnapshot, width, height, offset int) string {
	innerW := width - 4
	if innerW < 20 {
		innerW = 20
	}
	innerH := height - 2
	if innerH < 1 {
		innerH = 1
	}
	total := len(s.recent)
	end := total - offset
	if end < 0 {
		end = 0
	}
	start := end - innerH
	if start < 0 {
		start = 0
	}
	lines := make([]string, 0, innerH)
	for i := start; i < end; i++ {
		lines = append(lines, alertLine(s.recent[i], innerW))
	}
	if len(lines) == 0 {
		lines = append(lines, dimStyle.Render("sin alertas todavia; los hits de reglas y las secuencias completadas aparecen aqui"))
	}
	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(colorDim).
		Width(innerW).
		Height(innerH).
		Render(strings.Join(lines, "\n"))
}

// alertLine formats one alert: time, severity badge, rule id, summary
// and host, hard-truncated to the panel width (ANSI aware via lipgloss).
func alertLine(a alert.Alert, width int) string {
	when := "??:??:??"
	if t, err := time.Parse(time.RFC3339Nano, a.Timestamp); err == nil {
		when = t.Format("15:04:05")
	}
	id := a.RuleID
	if len(id) > 8 {
		id = id[:8]
	}
	line := when + " " +
		sevStyle(a.Severity).Render(pad(strings.ToUpper(a.Severity), 8)) + " " +
		dimStyle.Render(id) + " " + a.Summary + " " + dimStyle.Render("host="+a.Host)
	return lipgloss.NewStyle().MaxWidth(width).Render(line)
}
