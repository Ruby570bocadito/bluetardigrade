// Package intel matches telemetry against offline threat-intelligence
// lists: plain text files in one directory, one indicator per line (IP,
// CIDR, domain, URL or file hash; hosts-file lines are understood too).
// Matching is local and needs no API key: a list is just a file, kept
// current with `engine intel-update` or by any process the operator
// trusts. The directory is re-read when its files change.
package intel

import (
	"bufio"
	"bytes"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// Indicator kinds.
const (
	KindIP     = "ip"
	KindNet    = "cidr"
	KindDomain = "domain"
	KindHash   = "hash"
)

const (
	maxFileBytes    = 64 << 20
	maxIndicators   = 2_000_000 // across every list
	maxLineBytes    = 4096
	cooldown        = 10 * time.Minute
	maxCooldownKeys = 100_000
	// reclaimEvery rate-limits the cooldown-map eviction sweep (same
	// pattern as correlate's reclaimEvery): a full map must not turn
	// every Allow into a full-map scan.
	reclaimEvery    = time.Second
	maxHitsPerEvent = 3
)

// List describes one loaded file.
type List struct {
	Name       string         `json:"name"`
	File       string         `json:"file"`
	Indicators int            `json:"indicators"`
	ByKind     map[string]int `json:"by_kind"`
	Modified   time.Time      `json:"modified"`
	Skipped    int            `json:"skipped"`
}

// Hit is one indicator found in an event.
type Hit struct {
	List  string
	Kind  string
	Value string
	Field string
}

type netEntry struct {
	net  *net.IPNet
	list string
}

// Matcher is safe for concurrent use.
type Matcher struct {
	mu      sync.RWMutex
	dir     string
	sig     string
	ips     map[string]string // value -> list
	nets    []netEntry
	domains map[string]string
	hashes  map[string]string
	lists   []List

	cmu      sync.Mutex
	lastSeen map[string]time.Time // list|value|host -> last alert
	hits     uint64               // hits allowed to alert since start (under cmu)
	// lastReclaim rate-limits the full-map eviction sweep (sesión
	// 100agentes-2, agentes 13+19): con el mapa lleno, cada Allow
	// recorría 2×100k entradas — una inundación de indicadores únicos
	// serializaba ~200k iteraciones por evento bajo cmu.
	lastReclaim time.Time
}

// Load reads every *.txt and *.list file of dir. A missing directory
// is an empty matcher, not an error.
//
// On error the returned matcher is still usable (empty) and the next
// Reload retries, so a bad list never stops the engine.
func Load(dir string) (*Matcher, error) {
	m := &Matcher{dir: dir, lastSeen: map[string]time.Time{}}
	_, err := m.Reload()
	return m, err
}

// Reload re-reads the directory when the set of files, their sizes or
// their modification times changed. It reports whether it reloaded.
func (m *Matcher) Reload() (bool, error) {
	files, sig, err := scan(m.dir)
	if err != nil {
		return false, err
	}
	m.mu.RLock()
	same := sig == m.sig
	m.mu.RUnlock()
	if same {
		return false, nil
	}
	ips := map[string]string{}
	domains := map[string]string{}
	hashes := map[string]string{}
	var nets []netEntry
	var lists []List
	total := 0
	for _, f := range files {
		l, err := loadFile(f, ips, domains, hashes, &nets, &total)
		if err != nil {
			return false, err
		}
		lists = append(lists, l)
	}
	m.mu.Lock()
	m.sig, m.ips, m.domains, m.hashes, m.nets, m.lists = sig, ips, domains, hashes, nets, lists
	m.mu.Unlock()
	return true, nil
}

// Lists returns the loaded lists, sorted by name.
func (m *Matcher) Lists() []List {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := append([]List(nil), m.lists...)
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Total is the number of indicators loaded.
func (m *Matcher) Total() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.ips) + len(m.domains) + len(m.hashes) + len(m.nets)
}

// Dir is the directory the matcher reads.
func (m *Matcher) Dir() string { return m.dir }

// Match returns the indicators found in ev (at most maxHitsPerEvent).
func (m *Matcher) Match(ev *model.Event) []Hit {
	if ev == nil {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.ips)+len(m.domains)+len(m.hashes)+len(m.nets) == 0 {
		return nil
	}
	var hits []Hit
	add := func(h Hit) {
		if len(hits) < maxHitsPerEvent {
			hits = append(hits, h)
		}
	}
	if n := ev.Network; n != nil {
		for _, f := range []struct{ field, value string }{{"network.destination_ip", n.DestinationIP}, {"network.source_ip", n.SourceIP}} {
			ip := net.ParseIP(strings.TrimSpace(f.value))
			if ip == nil {
				continue
			}
			key := ip.String()
			if list, ok := m.ips[key]; ok {
				add(Hit{List: list, Kind: KindIP, Value: key, Field: f.field})
				continue
			}
			for _, e := range m.nets {
				if e.net.Contains(ip) {
					add(Hit{List: e.list, Kind: KindNet, Value: e.net.String(), Field: f.field})
					break
				}
			}
		}
		if d := normalizeDomain(n.Domain); d != "" {
			for candidate := d; strings.Count(candidate, ".") >= 1; {
				if list, ok := m.domains[candidate]; ok {
					add(Hit{List: list, Kind: KindDomain, Value: candidate, Field: "network.domain"})
					break
				}
				i := strings.IndexByte(candidate, '.')
				if i < 0 {
					break
				}
				candidate = candidate[i+1:]
			}
		}
	}
	// Orden determinista (sesión 100agentes-2, agente 19, P3): el
	// map literal hacía aleatorio qué hash llegaba al tope de
	// maxHitsPerEvent, y model.Hashes es un mapa — se itera por
	// clave ordenada.
	for _, field := range []string{"file.hashes", "process.hashes"} {
		hashes := fileHashes(ev)
		if field == "process.hashes" {
			hashes = processHashes(ev)
		}
		for _, kind := range sortedHashKinds(hashes) {
			v := strings.ToLower(strings.TrimSpace(hashes[kind]))
			if list, ok := m.hashes[v]; ok {
				add(Hit{List: list, Kind: KindHash, Value: v, Field: field})
			}
		}
	}
	return hits
}

// sortedHashKinds returns the hash map keys sorted so hit reporting is
// deterministic when maxHitsPerEvent truncates (map iteration order is
// otherwise random: which hash surfaced changed run to run).
func sortedHashKinds(h model.Hashes) []string {
	kinds := make([]string, 0, len(h))
	for k := range h {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	return kinds
}

// Allow reports whether a hit on host may raise an alert now: the same
// indicator on the same host alerts at most once per cooldown, so a
// beaconing implant does not produce one alert per connection.
//
// Full-map behavior (audit 5.13 #3): when the cooldown map is full and
// nothing has aged out, the OLDEST entry is evicted instead of
// dropping the new hit. The old fail-closed answer silenced intel for
// every NEW indicator until the oldest aged naturally — exactly the
// window an attacker wants (touch enough indicators, then act): intel
// went blind DURING the attack. Evicting the least-recently-ALLOWed
// entry keeps the map bounded without ever dropping the hit itself.
func (m *Matcher) Allow(h Hit, host string, now time.Time) bool {
	key := h.List + "|" + h.Value + "|" + strings.ToLower(host)
	m.cmu.Lock()
	defer m.cmu.Unlock()
	if last, ok := m.lastSeen[key]; ok && now.Sub(last) < cooldown {
		return false
	}
	if len(m.lastSeen) >= maxCooldownKeys {
		if now.Sub(m.lastReclaim) >= reclaimEvery {
			// Ventana de barrido completa: expira vencidos y, si sigue
			// lleno, expulsa el más viejo (mismo contrato LRU del
			// audit 5.13 #3, ahora como máximo 1 sweep/segundo).
			m.lastReclaim = now
			for k, at := range m.lastSeen {
				if now.Sub(at) >= cooldown {
					delete(m.lastSeen, k)
				}
			}
			for len(m.lastSeen) >= maxCooldownKeys {
				oldest, oldestAt := "", now
				for k, at := range m.lastSeen {
					if oldest == "" || at.Before(oldestAt) {
						oldest, oldestAt = k, at
					}
				}
				if oldest == "" {
					break
				}
				delete(m.lastSeen, oldest)
			}
		} else {
			// Entre barridos: expulsa el más viejo de una muestra
			// acotada (64 claves) — el mapa sigue acotado con coste
			// O(64) por evento en lugar de O(100k).
			oldest, oldestAt := "", now
			n := 0
			for k, at := range m.lastSeen {
				if oldest == "" || at.Before(oldestAt) {
					oldest, oldestAt = k, at
				}
				if n++; n >= 64 {
					break
				}
			}
			if oldest != "" {
				delete(m.lastSeen, oldest)
			}
		}
	}
	m.lastSeen[key] = now
	m.hits++
	return true
}

// Hits counts the hits allowed to raise an alert since the engine
// started.
func (m *Matcher) Hits() uint64 {
	m.cmu.Lock()
	defer m.cmu.Unlock()
	return m.hits
}

func processHashes(ev *model.Event) model.Hashes {
	if ev.Process == nil {
		return nil
	}
	return ev.Process.Hashes
}

func fileHashes(ev *model.Event) model.Hashes {
	if ev.File == nil {
		return nil
	}
	return ev.File.Hashes
}

func scan(dir string) ([]string, string, error) {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", fmt.Errorf("intel: read %s: %w", dir, err)
	}
	var files []string
	var sig strings.Builder
	for _, e := range entries {
		name := e.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if e.IsDir() || (ext != ".txt" && ext != ".list") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, filepath.Join(dir, name))
		fmt.Fprintf(&sig, "%s|%d|%d;", name, info.Size(), info.ModTime().UnixNano())
	}
	sort.Strings(files)
	return files, sig.String(), nil
}

func loadFile(path string, ips, domains, hashes map[string]string, nets *[]netEntry, total *int) (List, error) {
	name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	l := List{Name: name, File: filepath.Base(path), ByKind: map[string]int{}}
	info, err := os.Stat(path)
	if err != nil {
		return l, fmt.Errorf("intel: %s: %w", path, err)
	}
	l.Modified = info.ModTime()
	if info.Size() > maxFileBytes {
		return l, fmt.Errorf("intel: %s is %d bytes, over the %d byte cap", path, info.Size(), maxFileBytes)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return l, fmt.Errorf("intel: %s: %w", path, err)
	}
	sc := bufio.NewScanner(bytes.NewReader(decodeText(raw)))
	sc.Buffer(make([]byte, 0, maxLineBytes), maxLineBytes)
	for sc.Scan() {
		kind, value := parseLine(sc.Text())
		if kind == "" {
			if strings.TrimSpace(stripComment(sc.Text())) != "" {
				l.Skipped++
			}
			continue
		}
		if *total >= maxIndicators {
			l.Skipped++
			continue
		}
		switch kind {
		case KindIP:
			if _, dup := ips[value]; dup {
				continue
			}
			ips[value] = name
		case KindDomain:
			if _, dup := domains[value]; dup {
				continue
			}
			domains[value] = name
		case KindHash:
			if _, dup := hashes[value]; dup {
				continue
			}
			hashes[value] = name
		case KindNet:
			_, n, _ := net.ParseCIDR(value)
			*nets = append(*nets, netEntry{net: n, list: name})
		}
		*total++
		l.Indicators++
		l.ByKind[kind]++
	}
	if err := sc.Err(); err != nil {
		return l, fmt.Errorf("intel: %s: %w", path, err)
	}
	return l, nil
}

// decodeText returns the file as UTF-8 without a byte-order mark. Lists
// saved on Windows often carry a UTF-8 BOM (Set-Content -Encoding UTF8
// in PowerShell 5) or are UTF-16 (the '>' redirection of PowerShell 5);
// read as-is, the first indicator or the whole file would be skipped.
//
// Regression (live fuzzing 2026-10-06, SEC-A): a list saved TWICE
// carries two BOMs — and a UTF-16 payload can even start with a U+FEFF
// of its own — so the first indicator came out glued to a BOM
// character and never matched. The loop keeps stripping until no BOM
// encoding remains; every consumed iteration shrinks b by at least two
// bytes, so it terminates on any input.
func decodeText(b []byte) []byte {
	for {
		switch {
		case bytes.HasPrefix(b, []byte{0xEF, 0xBB, 0xBF}):
			b = b[3:]
		case bytes.HasPrefix(b, []byte{0xFF, 0xFE}), bytes.HasPrefix(b, []byte{0xFE, 0xFF}):
			big := b[0] == 0xFE
			b = b[2:]
			units := make([]uint16, 0, len(b)/2)
			for i := 0; i+1 < len(b); i += 2 {
				if big {
					units = append(units, uint16(b[i])<<8|uint16(b[i+1]))
				} else {
					units = append(units, uint16(b[i+1])<<8|uint16(b[i]))
				}
			}
			b = []byte(string(utf16.Decode(units)))
		default:
			return b
		}
	}
}

func stripComment(line string) string {
	// "!" opens a comment line in AdBlock-style lists
	if strings.HasPrefix(strings.TrimSpace(line), "!") {
		return ""
	}
	if i := strings.IndexAny(line, "#;"); i >= 0 {
		return line[:i]
	}
	return line
}

// parseLine classifies one line; "" kind means nothing usable.
func parseLine(raw string) (string, string) {
	fields := strings.FieldsFunc(stripComment(raw), func(r rune) bool { return r == ' ' || r == '\t' || r == ',' })
	if len(fields) == 0 {
		return "", ""
	}
	token := fields[0]
	// hosts-file form: "0.0.0.0 evil.example" / "127.0.0.1 evil.example"
	if len(fields) >= 2 && (token == "0.0.0.0" || token == "127.0.0.1" || token == "::") {
		token = fields[1]
	}
	token = normalizeToken(token)
	lower := strings.ToLower(token)
	if isHex(lower) && (len(lower) == 32 || len(lower) == 40 || len(lower) == 64) {
		return KindHash, lower
	}
	if strings.Contains(token, "/") && !strings.Contains(token, "://") {
		if ip, n, err := net.ParseCIDR(token); err == nil && usableIP(ip) {
			return KindNet, n.String()
		}
	}
	if ip := net.ParseIP(token); ip != nil {
		if !usableIP(ip) {
			return "", ""
		}
		return KindIP, ip.String()
	}
	// URLs keep only their host
	if i := strings.Index(lower, "://"); i >= 0 {
		lower = lower[i+3:]
		if j := strings.IndexAny(lower, "/?#"); j >= 0 {
			lower = lower[:j]
		}
		if j := strings.LastIndexByte(lower, ':'); j >= 0 && !strings.Contains(lower[j:], "]") {
			lower = lower[:j]
		}
		if ip := net.ParseIP(strings.Trim(lower, "[]")); ip != nil {
			if !usableIP(ip) {
				return "", ""
			}
			return KindIP, ip.String()
		}
	}
	// host:port, [v6]:port
	if host, _, err := net.SplitHostPort(lower); err == nil && host != "" {
		if ip := net.ParseIP(host); ip != nil {
			if !usableIP(ip) {
				return "", ""
			}
			return KindIP, ip.String()
		}
		lower = host
	}
	if d := normalizeDomain(lower); d != "" {
		return KindDomain, d
	}
	return "", ""
}

// refang undoes the usual defanging of indicators copied from reports.
var refang = strings.NewReplacer("[.]", ".", "(.)", ".", "{.}", ".", "[dot]", ".", "(dot)", ".", "[:]", ":", "hxxps://", "https://", "hxxp://", "http://", "HXXPS://", "https://", "HXXP://", "http://")

// normalizeToken strips quotes, refangs, and removes the wrappers of
// blocklist formats: AdBlock "||name^" and wildcards "*.name".
func normalizeToken(t string) string {
	t = refang.Replace(strings.Trim(t, `"'`))
	t = strings.TrimPrefix(t, "||")
	if i := strings.IndexByte(t, '^'); i > 0 {
		t = t[:i]
	}
	t = strings.TrimPrefix(t, "*.")
	return t
}

// usableIP rejects addresses that would only produce noise: unspecified,
// loopback, link-local and multicast.
func usableIP(ip net.IP) bool {
	return !(ip.IsUnspecified() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsMulticast())
}

func isHex(s string) bool {
	for _, r := range s {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f') {
			return false
		}
	}
	return s != ""
}

// normalizeDomain lowercases and validates a domain name; "" if invalid.
// Every trailing dot is stripped: FQDNs legitimately end in the root dot
// ("example.com."), but malformed input like "000.." must not survive
// with a degenerate trailing dot — a single TrimSuffix turned "000.."
// into the "valid" domain "000.", which is not idempotent and let list
// junk ("abc..") pair with a hostile event domain ("x.abc..") to forge
// an intel hit (found by FuzzParseLine, SEC-7).
func normalizeDomain(s string) string {
	d := strings.TrimRight(strings.ToLower(strings.TrimSpace(s)), ".")
	if len(d) < 4 || len(d) > 253 || !strings.Contains(d, ".") || d == "localhost" {
		return ""
	}
	for _, r := range d {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '.' || r == '_') {
			return ""
		}
	}
	if strings.HasPrefix(d, ".") || strings.Contains(d, "..") {
		return ""
	}
	return d
}
