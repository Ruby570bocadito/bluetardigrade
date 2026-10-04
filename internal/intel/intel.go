// Package intel matches telemetry against offline threat-intelligence
// lists: plain text files in one directory, one indicator per line (IP,
// CIDR, domain, URL or file hash; hosts-file lines are understood too).
// Matching is local and needs no API key: a list is just a file, kept
// current with `engine intel-update` or by any process the operator
// trusts. The directory is re-read when its files change.
package intel

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

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
	for field, hashes := range map[string]model.Hashes{"process.hashes": processHashes(ev), "file.hashes": fileHashes(ev)} {
		for _, v := range hashes {
			v = strings.ToLower(strings.TrimSpace(v))
			if list, ok := m.hashes[v]; ok {
				add(Hit{List: list, Kind: KindHash, Value: v, Field: field})
			}
		}
	}
	return hits
}

// Allow reports whether a hit on host may raise an alert now: the same
// indicator on the same host alerts at most once per cooldown, so a
// beaconing implant does not produce one alert per connection.
func (m *Matcher) Allow(h Hit, host string, now time.Time) bool {
	key := h.List + "|" + h.Value + "|" + strings.ToLower(host)
	m.cmu.Lock()
	defer m.cmu.Unlock()
	if last, ok := m.lastSeen[key]; ok && now.Sub(last) < cooldown {
		return false
	}
	if len(m.lastSeen) >= maxCooldownKeys {
		for k, at := range m.lastSeen {
			if now.Sub(at) >= cooldown {
				delete(m.lastSeen, k)
			}
		}
		if len(m.lastSeen) >= maxCooldownKeys {
			return false
		}
	}
	m.lastSeen[key] = now
	return true
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
	f, err := os.Open(path)
	if err != nil {
		return l, fmt.Errorf("intel: %s: %w", path, err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
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

func stripComment(line string) string {
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
	token = strings.Trim(token, `"'`)
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
	if d := normalizeDomain(lower); d != "" {
		return KindDomain, d
	}
	return "", ""
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
func normalizeDomain(s string) string {
	d := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(s)), ".")
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
