// Presentation layer of the CLI: lipgloss palette and renderers for
// the rules table, the validate report, the version block, the banner
// and the help screens. All styling goes through lipgloss, so ANSI is
// stripped automatically when NO_COLOR is set or stdout is not a
// terminal (dark background assumed when it is).
package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/lipgloss/table"
	"golang.org/x/term"
)

// Palette: critical=red, high=orange, medium=amber, low=sky,
// info=cyan, accent emerald for OK/status.
var (
	colorCritical = lipgloss.Color("196")
	colorHigh     = lipgloss.Color("208")
	colorMedium   = lipgloss.Color("214")
	colorLow      = lipgloss.Color("117")
	colorInfo     = lipgloss.Color("81")
	colorOK       = lipgloss.Color("#10b981") // emerald accent
	colorDim      = lipgloss.Color("244")
)

var (
	titleStyle   = lipgloss.NewStyle().Bold(true).Foreground(colorOK)
	dimStyle     = lipgloss.NewStyle().Foreground(colorDim)
	okStyle      = lipgloss.NewStyle().Bold(true).Foreground(colorOK)
	warnStyle    = lipgloss.NewStyle().Bold(true).Foreground(colorMedium)
	errStyle     = lipgloss.NewStyle().Bold(true).Foreground(colorCritical)
	tagAttackSty = lipgloss.NewStyle().Foreground(colorInfo)
	tagOtherSty  = lipgloss.NewStyle().Foreground(colorDim)
	tableHeadSty = lipgloss.NewStyle().Bold(true).Foreground(colorOK)
	sectionSty   = lipgloss.NewStyle().Bold(true).Foreground(colorOK)
)

// stdoutIsTTY gates the TUI: lipgloss alone would already degrade the
// colors, but the panel itself only makes sense on a real terminal.
func stdoutIsTTY() bool {
	return term.IsTerminal(int(os.Stdout.Fd()))
}

// sevStyle maps a severity to its palette color.
func sevStyle(sev string) lipgloss.Style {
	base := lipgloss.NewStyle()
	switch strings.ToLower(sev) {
	case rules.SevCritical:
		return base.Foreground(colorCritical).Bold(true)
	case rules.SevHigh:
		return base.Foreground(colorHigh)
	case rules.SevMedium:
		return base.Foreground(colorMedium)
	case rules.SevLow:
		return base.Foreground(colorLow)
	default:
		return base.Foreground(colorInfo)
	}
}

// renderTags colors ATT&CK tags (attack.*) in cyan and the rest dim.
func renderTags(tags []string) string {
	parts := make([]string, 0, len(tags))
	for _, tg := range tags {
		tg = redact.TerminalText(tg)
		if strings.HasPrefix(tg, "attack.") {
			parts = append(parts, tagAttackSty.Render(tg))
		} else {
			parts = append(parts, tagOtherSty.Render(tg))
		}
	}
	return strings.Join(parts, " ")
}

// renderRulesSummary is the one-line status printed above the table.
func renderRulesSummary(path string, eng *rules.Engine) string {
	if eng.Count() == 0 {
		return warnStyle.Render("AVISO") + "  0 reglas en " + path + " (no se activara ninguna deteccion)"
	}
	return okStyle.Render("OK") + "  " + fmt.Sprintf("%d reglas desde %s (tipos: %v)", eng.Count(), path, eng.Types())
}

// renderRulesTable renders the loaded rules: id, nombre, severidad,
// tipo de evento y tags ATT&CK. Snapshot is sorted by ID, so the table
// is stable across invocations and hot-reloads.
func renderRulesTable(rs []rules.Rule) string {
	t := table.New().
		Border(lipgloss.RoundedBorder()).
		BorderStyle(lipgloss.NewStyle().Foreground(colorDim)).
		Headers("ID", "NOMBRE", "SEVERIDAD", "TIPO", "TAGS").
		StyleFunc(func(row, col int) lipgloss.Style {
			if row == table.HeaderRow {
				return tableHeadSty
			}
			return lipgloss.NewStyle()
		})
	for _, r := range rs {
		id := redact.TerminalText(r.ID)
		if len(id) > 8 {
			id = id[:8]
		}
		t.Row(
			dimStyle.Render(id),
			redact.TerminalText(r.Name),
			sevStyle(r.Severity).Render(strings.ToUpper(r.Severity)),
			redact.TerminalText(r.EventType),
			renderTags(r.Tags),
		)
	}
	return t.Render()
}

// renderVersion prints the version block: engine version, Go runtime
// and OS/arch of the running binary.
func renderVersion(b buildInfo) string {
	label := lipgloss.NewStyle().Foreground(colorOK).Bold(true)
	line := func(l, v string) string {
		return "  " + label.Render(pad(l, 11)) + v
	}
	var sb strings.Builder
	sb.WriteString(titleStyle.Render("bluetardigrade engine") + dimStyle.Render("  "+b.Version) + "\n")
	sb.WriteString(line("version", b.Version) + "\n")
	sb.WriteString(line("runtime", b.Go) + "\n")
	sb.WriteString(line("plataforma", b.OS+"/"+b.Arch) + "\n")
	return sb.String()
}

// renderValidateReport turns the validation result into a readable
// report: one line per check with OK/AVISO/ERROR and a final verdict.
func renderValidateReport(rep *validationReport) string {
	var sb strings.Builder
	sb.WriteString(titleStyle.Render("engine validate") + "\n\n")
	sb.WriteString("  " + dimStyle.Render(pad("reglas", 11)) + rep.rulesPath + "\n")
	sb.WriteString("  " + dimStyle.Render(pad("secuencias", 11)) + rep.seqsPath + "\n\n")
	for _, c := range rep.checks {
		var word string
		switch c.status {
		case checkWarn:
			word = warnStyle.Render(pad("AVISO", 6))
		case checkError:
			word = errStyle.Render(pad("ERROR", 6))
		default:
			word = okStyle.Render(pad("OK", 6))
		}
		sb.WriteString("  " + word + " " + c.detail + "\n")
	}
	sb.WriteString("\n")
	if rep.failed() {
		sb.WriteString("  resultado: " + errStyle.Render("ERRORES") +
			dimStyle.Render(fmt.Sprintf("  (%d error/es, %d aviso/s, exit 1)", rep.errCount, rep.warnCount)) + "\n")
	} else {
		sb.WriteString("  resultado: " + okStyle.Render("OK") +
			dimStyle.Render(fmt.Sprintf("  (%d aviso/s, exit 0)", rep.warnCount)) + "\n")
	}
	return sb.String()
}

// renderBanner is the interactive panel header: nombre, version,
// reglas cargadas y puertos de escucha.
func renderBanner(meta tuiMeta, rulesCount int) string {
	wh := meta.webhookURL
	if wh == "" {
		wh = "off"
	} else {
		wh = redact.EndpointLabel(wh)
	}
	api := meta.apiAddr
	if api == "" {
		api = "off"
	}
	head := titleStyle.Render("SECURITY-FRAMEWORK ENGINE") + dimStyle.Render("  "+engineVersion)
	l1 := "reglas " + fmt.Sprintf("%d", rulesCount) + dimStyle.Render("  "+redact.TerminalText(meta.rulesPath))
	l2 := "ingest " + redact.TerminalText(meta.ingestAddr) + "   api " + redact.TerminalText(api) + "   webhook " + dimStyle.Render(redact.TerminalText(wh))
	if meta.seqCount > 0 {
		l2 += "   secuencias " + fmt.Sprintf("%d", meta.seqCount)
	}
	return lipgloss.JoinVertical(lipgloss.Left, head, l1, dimStyle.Render(l2))
}

// pad right-pads s with spaces to width display columns (labels are
// plain ASCII, so bytes equal display width here).
func pad(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return s + strings.Repeat(" ", width-len(s))
}
