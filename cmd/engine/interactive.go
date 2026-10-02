// The interactive terminal is a read-only view of the running pipeline.
// Pausing, searching and selecting never interrupt detection or delivery.
package main

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

const recentAlertsCap = 100

type liveStats struct {
	mu      sync.Mutex
	start   time.Time
	events  uint64
	alerts  uint64
	bySev   map[string]int
	recent  []alert.Alert
	catalog []rules.Rule
}

func newLiveStats() *liveStats {
	return &liveStats{start: time.Now(), bySev: map[string]int{}}
}

func (s *liveStats) setRuleCatalog(rs []rules.Rule) {
	s.mu.Lock()
	s.catalog = append([]rules.Rule(nil), rs...)
	s.mu.Unlock()
}

func (s *liveStats) recordEvent() {
	s.mu.Lock()
	s.events++
	s.mu.Unlock()
}

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

type statsSnapshot struct {
	events  uint64
	alerts  uint64
	bySev   map[string]int
	recent  []alert.Alert
	catalog []rules.Rule
	uptime  time.Duration
	rules   int
}

func (s *liveStats) snapshot() statsSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	bySev := make(map[string]int, len(s.bySev))
	for k, v := range s.bySev {
		bySev[k] = v
	}
	return statsSnapshot{
		events: s.events, alerts: s.alerts, bySev: bySev,
		recent:  append([]alert.Alert(nil), s.recent...),
		catalog: append([]rules.Rule(nil), s.catalog...),
		uptime:  time.Since(s.start), rules: len(s.catalog),
	}
}

type tuiMeta struct {
	rulesPath  string
	ingestAddr string
	apiAddr    string
	webhookURL string
	seqCount   int
}

type tickMsg struct{}

var tuiSeverities = []string{"", rules.SevCritical, rules.SevHigh, rules.SevMedium, rules.SevLow, rules.SevInfo}

type tuiModel struct {
	meta         tuiMeta
	stats        *liveStats
	snap         statsSnapshot
	width        int
	height       int
	tab          int // 0 alerts, 1 rules
	cursor       int // newest alert is index 0
	offset       int // first visible row
	severity     int
	query        string
	searching    bool
	paused       bool
	detail       bool
	detailOffset int
	help         bool
}

func runInteractive(ctx context.Context, meta tuiMeta, stats *liveStats) error {
	m := &tuiModel{meta: meta, stats: stats, snap: stats.snapshot()}
	p := tea.NewProgram(m, tea.WithAltScreen())
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

// Init implements tea.Model.
func (m *tuiModel) Init() tea.Cmd { return tickCmd() }

// Update implements tea.Model with contextual keys: text entry never
// fires shortcuts, Escape returns to the queue, q/Ctrl+C shut down.
func (m *tuiModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tickMsg:
		if !m.paused {
			m.refresh()
		}
		return m, tickCmd()
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.clampSelection()
	case tea.KeyMsg:
		key := msg.String()
		if key == "ctrl+c" {
			return m, tea.Quit
		}
		if m.searching {
			switch key {
			case "esc":
				m.searching, m.query = false, ""
			case "enter":
				m.searching = false
			case "backspace", "ctrl+h":
				rs := []rune(m.query)
				if len(rs) > 0 {
					m.query = string(rs[:len(rs)-1])
				}
			case "ctrl+u":
				m.query = ""
			default:
				if msg.Type == tea.KeyRunes {
					for _, r := range msg.Runes {
						if !unicode.IsControl(r) && !unicode.Is(unicode.Cf, r) && len([]rune(m.query)) < 120 {
							m.query += string(r)
						}
					}
				} else if msg.Type == tea.KeySpace && len([]rune(m.query)) < 120 {
					m.query += " "
				}
			}
			m.cursor, m.offset, m.detailOffset = 0, 0, 0
			m.clampSelection()
			return m, nil
		}
		switch key {
		case "q", "Q":
			return m, tea.Quit
		case "esc":
			if m.help {
				m.help = false
			} else if m.detail {
				m.detail = false
			} else {
				m.query, m.severity = "", 0
				m.cursor, m.offset = 0, 0
			}
			m.detailOffset = 0
		case "?", "h":
			m.help = !m.help
			m.detailOffset = 0
		case "tab", "shift+tab", "1", "2":
			if key == "1" {
				m.tab = 0
			} else if key == "2" {
				m.tab = 1
			} else {
				m.tab = 1 - m.tab
			}
			m.cursor, m.offset, m.detailOffset = 0, 0, 0
			m.detail, m.help = false, false
		case "/":
			m.searching, m.detail, m.help = true, false, false
		case "s":
			m.severity = (m.severity + 1) % len(tuiSeverities)
			m.cursor, m.offset, m.detailOffset = 0, 0, 0
			m.detail, m.help = false, false
		case "p", " ":
			m.paused = !m.paused
			if !m.paused {
				m.refresh()
			}
		case "enter":
			if m.rowCount() > 0 && !m.help {
				m.detail = !m.detail
				m.detailOffset = 0
			}
		case "up", "k", "down", "j", "pgup", "pgdown", "home", "end":
			delta := 1
			if key == "up" || key == "k" {
				delta = -1
			} else if key == "pgup" {
				delta = -m.pageSize()
			} else if key == "pgdown" {
				delta = m.pageSize()
			}
			if m.detail || m.help {
				m.detailOffset += delta
				if key == "home" {
					m.detailOffset = 0
				} else if key == "end" {
					m.detailOffset = len(m.detailLines())
				}
				m.clampDetailOffset()
			} else {
				m.cursor += delta
				if key == "home" {
					m.cursor = 0
				} else if key == "end" {
					m.cursor = m.rowCount() - 1
				}
			}
		}
		m.clampSelection()
	}
	return m, nil
}

// refresh keeps the selected historical row steady as new alerts arrive.
// At the head of the queue, selection continues following the live feed.
func (m *tuiModel) refresh() {
	selected := ""
	selectedRule := ""
	if m.tab == 1 && (m.cursor > 0 || m.detail) {
		list := m.filteredRules()
		if m.cursor < len(list) {
			selectedRule = list[m.cursor].ID
		}
	}
	if m.tab == 0 && (m.cursor > 0 || m.detail) {
		list := m.filteredAlerts()
		if m.cursor < len(list) {
			selected = alertIdentity(list[m.cursor])
		}
	}
	m.snap = m.stats.snapshot()
	if selected != "" {
		found := false
		for i, a := range m.filteredAlerts() {
			if alertIdentity(a) == selected {
				m.cursor = i
				found = true
				break
			}
		}
		if !found {
			m.detail = false
			m.cursor, m.offset = 0, 0
		}
	}
	if selectedRule != "" {
		found := false
		for i, r := range m.filteredRules() {
			if r.ID == selectedRule {
				m.cursor = i
				found = true
				break
			}
		}
		if !found {
			m.detail = false
			m.cursor, m.offset = 0, 0
		}
	}
	m.clampSelection()
}

func alertIdentity(a alert.Alert) string {
	if a.ID != "" {
		return a.ID
	}
	return a.Timestamp + "\x00" + a.RuleID + "\x00" + a.EventID
}

func matchesTui(query, severity, sev string, fields ...string) bool {
	if severity != "" && severity != sev {
		return false
	}
	haystack := strings.ToLower(strings.Join(fields, " "))
	for _, term := range strings.Fields(strings.ToLower(query)) {
		if !strings.Contains(haystack, term) {
			return false
		}
	}
	return true
}

func (m *tuiModel) filteredAlerts() []alert.Alert {
	out := make([]alert.Alert, 0, len(m.snap.recent))
	for i := len(m.snap.recent) - 1; i >= 0; i-- {
		a := m.snap.recent[i]
		if matchesTui(m.query, tuiSeverities[m.severity], a.Severity,
			a.ID, a.EventID, a.EventType, a.RuleID, a.RuleName, a.Host, a.User, a.Summary, a.Message, a.Source, strings.Join(a.Tags, " "), strings.Join(model.ObservationSearchFields(a.Attributes, a.Network), " ")) {
			out = append(out, a)
		}
	}
	return out
}

func (m *tuiModel) filteredRules() []rules.Rule {
	out := make([]rules.Rule, 0, len(m.snap.catalog))
	for _, r := range m.snap.catalog {
		if matchesTui(m.query, tuiSeverities[m.severity], r.Severity,
			r.ID, r.Name, r.Description, r.EventType, strings.Join(r.Tags, " ")) {
			out = append(out, r)
		}
	}
	return out
}

func (m *tuiModel) rowCount() int {
	if m.tab == 1 {
		return len(m.filteredRules())
	}
	return len(m.filteredAlerts())
}

func (m *tuiModel) dimensions() (int, int) {
	w, h := m.width, m.height
	if w <= 0 {
		w = 80
	}
	if h <= 0 {
		h = 24
	}
	return w, h
}

func (m *tuiModel) pageSize() int {
	_, h := m.dimensions()
	return max(1, h-12)
}

func (m *tuiModel) clampSelection() {
	m.cursor = max(0, min(m.cursor, m.rowCount()-1))
	m.offset = max(0, min(m.offset, max(0, m.rowCount()-m.pageSize())))
	if m.cursor < m.offset {
		m.offset = m.cursor
	}
	if m.cursor >= m.offset+m.pageSize() {
		m.offset = m.cursor - m.pageSize() + 1
	}
	m.clampDetailOffset()
}

func (m *tuiModel) clampDetailOffset() {
	if m.detail || m.help {
		m.detailOffset = max(0, min(m.detailOffset, max(0, len(m.detailLines())-m.pageSize())))
	} else {
		m.detailOffset = 0
	}
}

// View implements tea.Model. Every line and the final frame are bounded
// by terminal dimensions, including Unicode and narrow split panes.
func (m *tuiModel) View() string {
	w, h := m.dimensions()
	if w < 32 || h < 12 {
		return fitTerminal(titleStyle.Render("SECURITY-FRAMEWORK")+"\n"+
			fmt.Sprintf("%d eventos · %d alertas\n", m.snap.events, m.snap.alerts)+
			"Amplía el terminal (mín. 32×12)\nq salir · ctrl+c salir", w, h)
	}
	state := okStyle.Render("EN VIVO")
	if m.paused {
		state = warnStyle.Render("VISTA PAUSADA · motor activo")
	}
	banner := renderBanner(m.meta, m.snap.rules)
	tabs := []string{"1 Alertas", "2 Reglas"}
	tabs[m.tab] = titleStyle.Render("[ " + tabs[m.tab] + " ]")
	filter := "todas las severidades"
	if m.severity > 0 {
		filter = strings.ToUpper(tuiSeverities[m.severity])
	}
	query := " / buscar"
	if m.query != "" || m.searching {
		query = " / " + redact.TerminalText(m.query)
		if m.searching {
			query += "▏"
		}
	}
	label := "ALERTAS RECIENTES"
	total := len(m.snap.recent)
	if m.tab == 1 {
		label, total = "CATÁLOGO DE REGLAS", len(m.snap.catalog)
	}
	label += fmt.Sprintf(" · %d/%d", m.rowCount(), total)
	if m.help {
		label = "AYUDA · la detección sigue activa"
	} else if m.detail {
		label = "DETALLE · esc volver"
	}
	innerW := w - 4
	var lines []string
	if m.detail || m.help {
		all := m.detailLines()
		end := min(len(all), m.detailOffset+m.pageSize())
		start := min(m.detailOffset, end)
		lines = all[start:end]
	} else {
		lines = m.queueLines(innerW)
	}
	box := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).
		BorderForeground(colorDim).Width(w - 2).Height(m.pageSize()).
		Render(strings.Join(lines, "\n"))
	footer := "↑↓ seleccionar · enter detalle · / buscar · s severidad · p pausa · ? ayuda · q salir"
	if m.searching {
		footer = "Escribe para filtrar · enter aplicar · esc limpiar · ctrl+u borrar · ctrl+c salir"
	}
	return fitTerminal(lipgloss.JoinVertical(lipgloss.Left,
		banner, statsLine(m.snap), state, strings.Join(tabs, "    "),
		dimStyle.Render("s "+filter+query), dimStyle.Render(label), box, dimStyle.Render(footer)), w, h)
}

func (m *tuiModel) queueLines(width int) []string {
	lines := []string{}
	if m.tab == 1 {
		list := m.filteredRules()
		for i := m.offset; i < min(len(list), m.offset+m.pageSize()); i++ {
			r := list[i]
			row := sevStyle(r.Severity).Render(pad(strings.ToUpper(r.Severity), 8)) +
				" " + redact.TerminalText(r.Name) + " · " + dimStyle.Render(redact.TerminalText(r.EventType))
			lines = append(lines, selectedLine(row, i == m.cursor, width))
		}
	} else {
		list := m.filteredAlerts()
		for i := m.offset; i < min(len(list), m.offset+m.pageSize()); i++ {
			lines = append(lines, selectedLine(alertLine(list[i], width-2), i == m.cursor, width))
		}
	}
	if len(lines) == 0 {
		msg := "Sin coincidencias. Esc limpia los filtros."
		if m.query == "" && m.severity == 0 {
			msg = "Esperando alertas del motor. La telemetría sigue activa."
			if m.tab == 1 {
				msg = "No hay reglas cargadas."
			}
		}
		lines = []string{dimStyle.Render(ansi.Truncate(msg, width, "…"))}
	}
	return lines
}

func selectedLine(line string, selected bool, width int) string {
	prefix := "  "
	if selected {
		prefix = titleStyle.Render("› ")
	}
	return ansi.Truncate(prefix+line, width, "…")
}

func (m *tuiModel) detailLines() []string {
	w, _ := m.dimensions()
	width := max(1, w-4)
	var rows []string
	if m.help {
		rows = []string{
			"1 / 2 / tab     Cambiar entre alertas y reglas",
			"↑↓ / j k        Seleccionar una fila; desplazar detalle",
			"pgup / pgdown   Saltar una página",
			"home / end      Inicio / final de la lista",
			"enter           Abrir / cerrar detalle",
			"/               Buscar ID, tipo, regla, host, usuario o tag",
			"                Cada término debe aparecer en la evidencia",
			"s               Rotar filtro de severidad",
			"p / espacio     Pausar / reanudar SOLO la vista",
			"esc             Volver; limpiar filtros en la lista",
			"? / h           Mostrar / cerrar esta ayuda",
			"q / ctrl+c      Salir y apagar el motor limpiamente",
			"Las últimas 100 alertas se retienen en este panel.",
			"API, correlación y entregas siguen activas al pausar.",
		}
	} else {
		add := func(label, value string) {
			if value != "" {
				rows = append(rows, label+": "+redact.TerminalText(value))
			}
		}
		if m.tab == 1 {
			list := m.filteredRules()
			if m.cursor < len(list) {
				r := list[m.cursor]
				add("Regla", r.Name)
				add("ID", r.ID)
				add("Severidad", r.Severity)
				add("Tipo", r.EventType)
				add("Descripción", r.Description)
				add("Tags", strings.Join(r.Tags, " "))
				for _, c := range r.Conditions {
					add("Condición", fmt.Sprintf("%s %s %v", c.Field, c.Operator, c.Value))
				}
			}
		} else {
			list := m.filteredAlerts()
			if m.cursor < len(list) {
				a := list[m.cursor]
				add("Regla", a.RuleName)
				add("ID alerta", a.ID)
				add("ID regla", a.RuleID)
				add("Momento", a.Timestamp)
				add("Severidad", a.Severity)
				add("Host", a.Host)
				add("Usuario", a.User)
				add("Evento", a.EventType+" · "+a.EventID)
				add("Fuente declarada", a.Source)
				add("Observaciones", strings.Join(model.ObservationSearchFields(a.Attributes, a.Network), " · "))
				add("Informe humano", "engine report --alert "+a.ID+" --interactive --out reports/"+a.ID+".md")
				add("Resumen", a.Summary)
				add("Mensaje", a.Message)
				add("Coincidencias", strings.Join(a.MatchedOn, ", "))
				add("Tags", strings.Join(a.Tags, " "))
			}
		}
	}
	wrapped := lipgloss.NewStyle().Width(width).Render(strings.Join(rows, "\n"))
	return strings.Split(wrapped, "\n")
}

func fitTerminal(frame string, width, height int) string {
	lines := strings.Split(frame, "\n")
	if len(lines) > height {
		lines = lines[:height]
	}
	for i, line := range lines {
		lines[i] = ansi.Truncate(line, width, "…")
	}
	return strings.Join(lines, "\n")
}

func statsLine(s statsSnapshot) string {
	return fmt.Sprintf("uptime %s   eventos %d   alertas %d   reglas %d",
		s.uptime.Round(time.Second), s.events, s.alerts, s.rules)
}

func alertLine(a alert.Alert, width int) string {
	when := "??:??:??"
	if t, err := time.Parse(time.RFC3339Nano, a.Timestamp); err == nil {
		when = t.Local().Format("15:04:05")
	}
	line := dimStyle.Render(when) + " " +
		sevStyle(a.Severity).Render(pad(strings.ToUpper(redact.TerminalText(a.Severity)), 8)) +
		" " + redact.TerminalText(a.Host) + " · " + redact.TerminalText(a.Summary)
	return ansi.Truncate(line, width, "…")
}
