package redact

// Scrubber de secretos en evidencia SALIENTE (sesión 100agentes-3,
// agentes 41/42/49): los valores con forma de secreto viajan a la
// consola, al JSON log, al ring/SSE, a SQLite alerts, al webhook, a
// los sumideros SIEM y al bundle forense; la evidencia CRUDA
// (SQLite events, timeline del bundle) no se reescribe nunca — el
// scrub corre en el punto de estrangulamiento del Alert, no en la
// store.
//
// Regla de la casa (cuarta copia, ver redact.go): los patrones viven
// aquí; el enchufe en internal/alert; los flags en cmd/engine. Cada
// marcador [REDACTED#kind#tail] es inerte para los 13 patrones:
// Scrub(Scrub(x)) == Scrub(x).

import (
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
)

// Mode del scrubber: -redact-secrets (default ON) y -redact-mode tail4|full.
type Mode int

const (
	ModeOff   Mode = iota // -redact-secrets=false (laboratorio)
	ModeFull              // [REDACTED#kind]
	ModeTail4             // [REDACTED#kind#xxxx] (default)
)

// MaxFieldBytes: cota por campo. Se redacta PRIMERO sobre el valor
// completo y solo después se trunca (truncar antes podría dejar a la
// vista la cabeza de un secreto cortado).
const MaxFieldBytes = 8192

// Pattern es un patrón del scrubber.
type Pattern struct {
	Kind       string
	RE         *regexp.Regexp
	Prefilter  []string // any-of; se chequea contra strings.ToLower(valor)
	ValueGroup int      // 0 = el valor es el match completo; N = solo el grupo N es el valor (el resto del match se conserva: "password=", "//user:@", "Bearer ")
	TailGroup  int      // 0 = tail del grupo ValueGroup; N (legacy) = tail del grupo N
	NoTail     bool     // marcador sin tail (PEM: el tail son '----')
}

func tail4(s string) string {
	r := []rune(s)
	if len(r) > 4 {
		r = r[len(r)-4:]
	}
	var b strings.Builder
	for _, c := range r {
		switch {
		case c >= '0' && c <= '9', c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z':
			b.WriteRune(c)
		default:
			b.WriteRune('_')
		}
	}
	return b.String()
}

// La tabla se compila UNA vez. ORDEN DE APLICACIÓN: PEM > jwt >
// formatos propietarios > url > http-auth > net use > flags > KV
// (catch-all). Verificado en RE2 sin lookbehind/lookahead: \b,
// clases de exclusión y grupos de captura hacen el trabajo.
var table = []Pattern{
	{Kind: "pem_key_block",
		RE:        regexp.MustCompile(`(?s:-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----` + strings.Repeat(`[A-Za-z0-9+/=\n]{0,1000}`, 4) + `-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----)`),
		Prefilter: []string{"private key"}, NoTail: true},
	{Kind: "pem_key_truncated",
		RE:        regexp.MustCompile(`(?s:-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[A-Za-z0-9+/=\s]{20,})`),
		Prefilter: []string{"private key"}, NoTail: true},
	{Kind: "jwt",
		RE:        regexp.MustCompile(`eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]{6,})?`),
		Prefilter: []string{"eyj"}},
	{Kind: "aws_key_id",
		RE:        regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`),
		Prefilter: []string{"akia", "asia"}},
	{Kind: "aws_secret_key", ValueGroup: 1,
		RE:        regexp.MustCompile(`(?i)(?:aws[^a-z0-9]{0,5})?(?:secret|signing)[^a-z0-9]{0,3}(?:access[^a-z0-9]{0,3})?(?:key|token|password)["']?\s*(?:[=:]\s*|\s+)["']?([A-Za-z0-9/+=]{40,})`),
		Prefilter: []string{"secret", "signing"}},
	{Kind: "github_token",
		RE:        regexp.MustCompile(`\b(?:gh[posur]_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z]{22}_[0-9A-Za-z]{59})\b`),
		Prefilter: []string{"ghp_", "gho_", "ghs_", "ghu_", "ghr_", "github_pat_"}},
	{Kind: "slack_token",
		RE:        regexp.MustCompile(`\b(?:xox[a-z]|xapp)(?:-\d)?-[0-9A-Za-z]{8,}(?:-[0-9A-Za-z]+){0,6}\b`),
		Prefilter: []string{"xox", "xapp"}},
	{Kind: "url_userinfo", ValueGroup: 2,
		RE:        regexp.MustCompile(`//([^\s/@:\[#]*):([^\s/@\[#]+)@`),
		Prefilter: []string{"@", "//"}},
	{Kind: "http_auth_header", ValueGroup: 2,
		RE:        regexp.MustCompile(`(?i)\b((?:bearer|basic)\s+)([A-Za-z0-9._~+/=-]{21,})`),
		Prefilter: []string{"bearer", "basic"}},
	{Kind: "http_auth_basic", ValueGroup: 2,
		RE:        regexp.MustCompile(`\b(?i:(basic)\s+)([a-z0-9+/]{0,100}[A-Z0-9][A-Za-z0-9+/]{11,}={0,2})`),
		Prefilter: []string{"basic"}},
	{Kind: "net_use_password", ValueGroup: 1,
		RE:        regexp.MustCompile(`(?i)\bnet\s+use\s.{0,120}?/user:\S+\s+("[^"\[\n]*"|[^\s"'/\-\[#][^\s"'\n\[\]#]*)`),
		Prefilter: []string{"/user:", "net use"}},
	{Kind: "cli_flag_value", ValueGroup: 1,
		RE:        regexp.MustCompile(`(?i)(?:^|\s)--?(?:password|passwd|passphrase|passin|passout|secret|token|api[_-]?key|apikey|access[_-]?key|client[_-]?secret|private[_-]?key|auth)\b(?:[=:]\s*|\s+)\s*("[^"\[\n]*"|'[^'\[\n]*'|[^\s"'\[\n;&<>#]{3,})`),
		Prefilter: []string{"-password", "-passwd", "-passphrase", "-passin", "-passout", "-secret", "-token", "-api-key", "-api_key", "-apikey", "-access-key", "-client-secret", "-private-key", "-auth"}},
	{Kind: "kv_secret", ValueGroup: 1,
		RE:        regexp.MustCompile(`(?i)(?:password|passwd|passphrase|secret|token|api[_-]?key|apikey|client[_-]?secret|access[_-]?token|auth[_-]?token|session[_-]?token)s?\s*[=:]\s*("[^"\[\n]*"|'[^'\[\n]*'|[^\s"',;)\]}&<>#\[]{3,})`),
		Prefilter: []string{"password", "passwd", "passphrase", "secret", "token", "api_key", "api-key", "apikey", "client_secret", "access_token", "auth_token", "session_token"}},
}

func prefilterHit(pref []string, v string) bool {
	lo := strings.ToLower(v)
	for _, sub := range pref {
		if strings.Contains(lo, sub) {
			return true
		}
	}
	return false
}

func (p *Pattern) marker(tailSrc string, mode Mode) string {
	if mode == ModeFull || p.NoTail {
		return "[REDACTED#" + p.Kind + "]"
	}
	t := tail4(tailSrc)
	if t == "" {
		return "[REDACTED#" + p.Kind + "]"
	}
	return "[REDACTED#" + p.Kind + "#" + t + "]"
}

func (p *Pattern) replace(s string, mode Mode) string {
	return p.RE.ReplaceAllStringFunc(s, func(m string) string {
		countHit(p.Kind)
		if p.ValueGroup > 0 {
			// solo el grupo del valor se sustituye: el contexto de
			// triaje ("password=", "//user:@", "Bearer ") sobrevive
			idx := p.RE.FindStringSubmatchIndex(m)
			g := 2 * p.ValueGroup
			if len(idx) < g+2 {
				return m
			}
			gs, ge := idx[g], idx[g+1]
			if gs < 0 || ge < gs {
				return m
			}
			return m[:gs] + p.marker(m[gs:ge], mode) + m[ge:]
		}
		src := m
		if !p.NoTail && p.TailGroup > 0 {
			if sub := p.RE.FindStringSubmatch(m); len(sub) > p.TailGroup {
				src = sub[p.TailGroup]
			}
		}
		return p.marker(src, mode)
	})
}

// contadores por kind (agente 44): getter-polling por scrape, la
// convención de la casa (intel.Hits, threshold.Fired, beacon.Fired).
var (
	scrubMu    sync.Mutex
	scrubHits  = map[string]*atomic.Uint64{}
	scrubNames = func() []string {
		names := make([]string, 0, len(table))
		seen := map[string]bool{}
		for _, p := range table {
			if !seen[p.Kind] {
				seen[p.Kind] = true
				names = append(names, p.Kind)
			}
		}
		return names
	}()
)

func countHit(kind string) {
	scrubMu.Lock()
	c := scrubHits[kind]
	if c == nil {
		c = &atomic.Uint64{}
		scrubHits[kind] = c
	}
	scrubMu.Unlock()
	c.Add(1)
}

// KindStats is one row of the scrubber counters (agente 44).
type KindStats struct {
	Kind string `json:"kind"`
	Hits uint64 `json:"hits"`
}

// ScrubStats returns the per-kind hit counters, sorted by kind for a
// deterministic /metrics render. Cardinality acotada por construcción:
// el vocabulario es la tabla de arriba, nada dinámico.
func ScrubStats() []KindStats {
	scrubMu.Lock()
	defer scrubMu.Unlock()
	out := make([]KindStats, 0, len(scrubNames))
	for _, name := range scrubNames {
		var n uint64
		if c := scrubHits[name]; c != nil {
			n = c.Load()
		}
		if n > 0 {
			out = append(out, KindStats{Kind: name, Hits: n})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Kind < out[j].Kind })
	return out
}

// String redacta un valor de campo de alerta (Summary, Message, valor
// de Attributes o de Enrich). Idempotente: los marcadores
// [REDACTED#...] no vuelven a matchear. El campo se corta a
// MaxFieldBytes DESPUÉS de redactar.
func String(mode Mode, v string) string {
	if mode == ModeOff || v == "" {
		return v
	}
	for i := range table {
		p := &table[i]
		if !prefilterHit(p.Prefilter, v) {
			continue
		}
		v = p.replace(v, mode)
	}
	if len(v) > MaxFieldBytes {
		r := []rune(v)
		if len(r) > MaxFieldBytes {
			v = string(r[:MaxFieldBytes])
		}
	}
	return v
}

// Scrub es el nombre canónico de String: el punto de entrada del
// scrubber para tests y para el wiring del engine.
func Scrub(mode Mode, v string) string { return String(mode, v) }

// Map redacta los VALORES de un mapa de alerta (Attributes y Enrich).
// Las CLAVES nunca se tocan: son vocabulario del esquema del sensor.
// Devuelve el mismo mapa si nada cambia (cero coste en alertas
// limpias); uno nuevo con los valores redactados si hay hit — el
// llamador debe sustituirlo, NUNCA mutar el alias del evento.
func Map(mode Mode, m map[string]string) map[string]string {
	if mode == ModeOff || len(m) == 0 {
		return m
	}
	var out map[string]string
	for k, v := range m {
		nv := String(mode, v)
		if nv != v {
			if out == nil {
				out = make(map[string]string, len(m))
				for k2, v2 := range m {
					out[k2] = v2
				}
			}
			out[k] = nv
		}
	}
	if out != nil {
		return out
	}
	return m
}
