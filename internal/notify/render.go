package notify

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
)

// Severity ranks for the per-channel min_severity floor. The order
// mirrors the rule package's own severity ladder; an unknown severity
// string ranks below info so an operator filtering for, say, medium
// never receives a value they did not sign up for.
const (
	rankAny      = -1 // no floor configured
	rankInfo     = 0
	rankLow      = 1
	rankMedium   = 2
	rankHigh     = 3
	rankCritical = 4
)

func severityRank(sev string) int {
	switch sev {
	case rules.SevInfo:
		return rankInfo
	case rules.SevLow:
		return rankLow
	case rules.SevMedium:
		return rankMedium
	case rules.SevHigh:
		return rankHigh
	case rules.SevCritical:
		return rankCritical
	default:
		return rankInfo - 1 // unknown: below every configured floor
	}
}

// parseSeverity maps a config min_severity value to its rank. The
// caller validates before calling; the default branch keeps the
// mapping total.
func parseSeverity(sev string) int {
	if sev == "" {
		return rankAny
	}
	return severityRank(sev)
}

// validSeverity reports whether a config min_severity value is one of
// the documented ladder steps.
func validSeverity(sev string) bool {
	switch sev {
	case "", rules.SevInfo, rules.SevLow, rules.SevMedium, rules.SevHigh, rules.SevCritical:
		return true
	default:
		return false
	}
}

// Text caps per channel family. They sit well below the platform
// limits (Telegram 4096, Slack ~40k) so the rendered message can
// never be rejected for size and the operator sees a stable shape.
const (
	maxChatRunes    = 3500
	maxSubjectRunes = 200
)

// renderText is the one human-readable shape every channel shares:
// "[SEVERITY] rule @ host — summary (user)". A missing user is left
// out rather than rendered as a placeholder; a missing summary falls
// back to the event type so the line is never empty.
func renderText(a alert.Alert) string {
	var b strings.Builder
	fmt.Fprintf(&b, "[%s] %s @ %s", strings.ToUpper(a.Severity), a.RuleName, a.Host)
	switch {
	case a.Summary != "":
		fmt.Fprintf(&b, " — %s", a.Summary)
	case a.EventType != "":
		fmt.Fprintf(&b, " — %s", a.EventType)
	}
	if a.User != "" {
		fmt.Fprintf(&b, " (user: %s)", a.User)
	}
	return b.String()
}

// linker is implemented by the channels that put the alert's console
// link in their message; Build hands them the configured console_url.
type linker interface {
	setConsoleURL(string)
}

// alertLink is the console address of an alert (the alert queue with
// that alert open; the console falls back to the history when it is no
// longer in the live window), or "" without a console_url or an id.
func alertLink(consoleURL string, a alert.Alert) string {
	if consoleURL == "" || a.ID == "" {
		return ""
	}
	return consoleURL + "/?view=alertas&alert=" + url.QueryEscape(a.ID)
}

// withLink appends the alert's console link on its own line.
func withLink(text, link string) string {
	if link == "" {
		return text
	}
	return text + "\n" + link
}

// renderMailBody is the email body: the shared human line first, then
// the full structured payload, so the mailbox keeps a forensic copy
// exactly like the webhook's JSON consumers do.
func renderMailBody(a alert.Alert, link string) string {
	payload, err := json.Marshal(a)
	if err != nil {
		return withLink(renderText(a), link)
	}
	return withLink(renderText(a), link) + "\n\n---\n" + string(payload)
}

// mailSubject renders the email subject and clamps it to a length
// mail servers accept. Header safety: every component is stripped of
// CR/LF and control characters first — rule names and summaries are
// operator- or event-controlled text and must never be able to break
// out of the Subject header.
func mailSubject(a alert.Alert) string {
	line := fmt.Sprintf("[security-framework] [%s] %s @ %s",
		strings.ToUpper(a.Severity), oneLine(a.RuleName), oneLine(a.Host))
	return truncate(oneLine(line), maxSubjectRunes)
}

// oneLine collapses CR/LF and tabs to spaces.
func oneLine(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return ' '
		}
		return r
	}, s)
}

// truncate clamps a string to max runes, appending an ellipsis when it
// actually cut something. Rune-safe on purpose: chat APIs count
// characters, not bytes, and cutting a UTF-8 sequence mid-rune would
// send malformed JSON payloads.
func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}
