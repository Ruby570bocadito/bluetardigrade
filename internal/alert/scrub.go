package alert

// Scrub de secretos en el punto de estrangulamiento del Alert
// (sesión 100agentes-3, agentes 42/49): UNA pasada antes de
// writeConsole/writeJSON/onAlert cubre consola, JSON log, ring, SSE,
// SQLite alerts, webhook, notify, Elastic, Splunk y el bloque de
// alerta del bundle forense. La evidencia cruda (eventos de SQLite,
// timeline del bundle) no se toca: Attributes/Enrich son ALIAS de los
// mapas del evento (buildAlert), así que el scrub clona SOLO cuando un
// valor cambia — cero coste en alertas limpias, cero mutación de
// evidencia en vuelo (pin de store_test.go TestInsertEventFirstWriteWins).

import "github.com/Ruby570bocadito/bluetardigrade/internal/redact"

// SetSecretScrubber wires the outbound secret scrubber: invoked once
// per alert BEFORE prepare (the rendered Message inherits the masked
// summary) and before every consumer. Nil keeps raw evidence (the
// documented -redact-secrets=false laboratory mode; the startup banner
// states the state either way, so an engine that is not redacting is
// never silent about it).
func (m *Manager) SetSecretScrubber(fn func(*Alert)) {
	m.mu.Lock()
	m.scrub = fn
	m.mu.Unlock()
}

// scrubAlert applies the redact package to the alert's free-text
// fields. Fields that carry correlation/routing identity (ID, RuleID,
// Host, User, Severity, Network, Tags, MatchedOn) are never touched.
func scrubAlert(mode redact.Mode, a *Alert) {
	a.Summary = redact.String(mode, a.Summary)
	a.Message = redact.String(mode, a.Message)
	a.Attributes = redact.Map(mode, a.Attributes)
	a.Enrich = redact.Map(mode, a.Enrich)
}

// ScrubWith applies the given redaction mode directly to an alert.
// The engine wiring uses it as the SetSecretScrubber callback.
func ScrubWith(mode redact.Mode, a *Alert) { scrubAlert(mode, a) }
