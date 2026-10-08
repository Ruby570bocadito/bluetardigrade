package intel

// Tests del índice CIDR/LPM y de la carga con aislamiento por fichero
// (sesión 100agentes-3, agentes 31/32/33). El oráculo diferencial
// compara lookupNet contra el escaneo lineal del snapshot para que un
// bucket-miss silencioso sea imposible de meter sin que la CI grite.

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// linearScanNet replica el bucle pre-índice (primero que gana por orden
// de carga) como oráculo de COBERTURA; el orden de PRIORIDAD nuevo se
// testea aparte en TestMatchNetMostSpecificWins.
func linearScanNet(m *Matcher, ip net.IP) (netEntry, bool) {
	for _, e := range m.nets {
		if e.net.Contains(ip) {
			return e, true
		}
	}
	return netEntry{}, false
}

func TestIntelNetIndexMatchesSameAsLinearScan(t *testing.T) {
	dir := t.TempDir()
	var b strings.Builder
	b.WriteString("10.0.0.0/8\n10.1.2.0/24\n203.0.113.0/24\n198.51.100.128/25\n100.64.0.0/10\n")
	b.WriteString("2001:db8::/32\n2400:cb00::/32\n0.0.0.0/1\n128.0.0.0/1\n")
	writeList(t, dir, "mix.txt", b.String())
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	probes := []string{
		"10.0.0.1", "10.1.2.3", "10.2.0.1", "10.255.255.255", "11.0.0.1",
		"203.0.113.7", "203.0.114.7", "198.51.100.130", "198.51.100.127",
		"100.64.0.1", "100.127.255.254", "100.128.0.1", "8.8.8.8", "127.0.0.1",
		"2001:db8::1", "2001:db9::1", "2400:cb00::5", "2606:4700::1",
		"1.2.3.4", "255.255.255.255", "128.0.0.1", "127.255.255.254",
	}
	for _, p := range probes {
		ip := net.ParseIP(p)
		if ip == nil {
			t.Fatalf("bad probe %q", p)
		}
		got, ok := m.lookupNet(ip)
		// cobertura: el índice debe encontrar TODO lo que el escaneo
		// lineal encuentra (el ganador puede diferir por el nuevo orden
		// más-específico-primero; eso se fija en su propio test).
		want, wantOK := linearScanNet(m, ip)
		if !ok {
			if wantOK {
				t.Fatalf("%s: index missed %s that the linear scan finds (%s)", p, want.net, want.list)
			}
			continue
		}
		if !wantOK {
			t.Fatalf("%s: index found %s but linear scan finds nothing (impossible)", p, got.net)
		}
		if !got.net.Contains(ip) {
			t.Fatalf("%s: index winner %s does not contain the probe", p, got.net)
		}
	}
}

func TestMatchNetMostSpecificWins(t *testing.T) {
	dir := t.TempDir()
	// la /8 se carga primero (orden alfabético de ficheros) pero la /24
	// es más específica: antes del índice ganaba el orden de carga.
	writeList(t, dir, "a_wide.txt", "10.0.0.0/8\n")
	writeList(t, dir, "z_narrow.txt", "10.1.2.0/24\n")
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	hits := m.Match(&model.Event{Network: &model.Network{DestinationIP: "10.1.2.3"}})
	if len(hits) != 1 || hits[0].Value != "10.1.2.0/24" {
		t.Fatalf("most specific must win: %+v", hits)
	}
	outside := m.Match(&model.Event{Network: &model.Network{DestinationIP: "10.3.4.5"}})
	if len(outside) != 1 || outside[0].Value != "10.0.0.0/8" {
		t.Fatalf("wide fallback: %+v", outside)
	}
}

func TestMatchNetIPv6AndCrossFamily(t *testing.T) {
	dir := t.TempDir()
	writeList(t, dir, "v6.txt", "2001:db8:1::/48\n2000::/3\n")
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	in := m.Match(&model.Event{Network: &model.Network{DestinationIP: "2001:db8:1::5"}})
	if len(in) != 1 || in[0].Value != "2001:db8:1::/48" {
		t.Fatalf("v6 /48: %+v", in)
	}
	wide := m.Match(&model.Event{Network: &model.Network{DestinationIP: "2600::1"}})
	if len(wide) != 1 || wide[0].Value != "2000::/3" {
		t.Fatalf("v6 wide (wide6): %+v", wide)
	}
	if got := m.Match(&model.Event{Network: &model.Network{DestinationIP: "4000::1"}}); len(got) != 0 {
		t.Fatalf("outside 2000::/3 must not match: %+v", got)
	}
	// sin cruce de familias: una net v6 no matchea un evento v4 ni al revés
	if got := m.Match(&model.Event{Network: &model.Network{DestinationIP: "2001:db8:1::5", SourceIP: "10.0.0.1"}}); len(got) != 1 {
		t.Fatalf("v6 dest with v4 src: %+v", got)
	}
	if got := m.Match(&model.Event{Network: &model.Network{DestinationIP: "10.0.0.1"}}); len(got) != 0 {
		t.Fatalf("v4 event must not match v6 nets: %+v", got)
	}
}

func TestMatchNetIPv4MappedEvent(t *testing.T) {
	dir := t.TempDir()
	writeList(t, dir, "n.txt", "198.51.100.0/24\n")
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	hits := m.Match(&model.Event{Network: &model.Network{DestinationIP: "::ffff:198.51.100.77"}})
	if len(hits) != 1 {
		t.Fatalf("mapped v4 event must match the /24: %+v", hits)
	}
}

func TestIntelNetIndexRebuiltOnReload(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "n.txt")
	if err := os.WriteFile(p, []byte("203.0.113.0/24\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := m.Match(&model.Event{Network: &model.Network{DestinationIP: "203.0.113.9"}}); len(got) != 1 {
		t.Fatalf("pre-reload: %+v", got)
	}
	if err := os.WriteFile(p, []byte("198.51.100.0/24\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Reload(); err != nil {
		t.Fatal(err)
	}
	if got := m.Match(&model.Event{Network: &model.Network{DestinationIP: "203.0.113.9"}}); len(got) != 0 {
		t.Fatalf("stale index: old CIDR still matches: %+v", got)
	}
	if got := m.Match(&model.Event{Network: &model.Network{DestinationIP: "198.51.100.77"}}); len(got) != 1 {
		t.Fatalf("new CIDR not indexed: %+v", got)
	}
}

// F1 (agente 32): un fichero roto ya no congela TODA la actualización.
func TestIntelReloadPartialSwapsGoodFiles(t *testing.T) {
	dir := t.TempDir()
	writeList(t, dir, "good.txt", "5.5.5.5\n")
	writeList(t, dir, "broken.txt", strings.Repeat("A", 5000)+"\n") // > maxLineBytes
	var partial *PartialLoadError
	m, err := Load(dir)
	if !asPartial(err, &partial) {
		t.Fatalf("initial load with a broken file must report PartialLoadError, got %v", err)
	}
	_ = err // el matcher vive con lo que cargó: el operador ve el parcial en el log de arranque
	// IOC nuevo en un fichero bueno mientras el roto sigue roto
	writeList(t, dir, "fresh.txt", "6.6.6.6\n")
	changed, err := m.Reload()
	if !changed {
		t.Fatal("partial failure must still swap what loaded")
	}
	if !asPartial(err, &partial) {
		t.Fatalf("partial load must report PartialLoadError, got %v", err)
	}
	if got := m.Match(&model.Event{Network: &model.Network{DestinationIP: "6.6.6.6"}}); len(got) != 1 {
		t.Fatalf("fresh IOC from the good file must match despite the broken one: %+v", got)
	}
	if got := m.Match(&model.Event{Network: &model.Network{DestinationIP: "5.5.5.5"}}); len(got) != 1 {
		t.Fatalf("previously loaded IOC list was dropped: %+v", got)
	}
}

// F1 (agente 32): fallo TOTAL conserva el snapshot anterior.
func TestIntelReloadTotalFailureKeepsPrevious(t *testing.T) {
	dir := t.TempDir()
	writeList(t, dir, "a.txt", "5.5.5.5\n")
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	// TODOS los ficheros pasan a estar rotos
	writeList(t, dir, "a.txt", strings.Repeat("A", 5000)+"\n")
	writeList(t, dir, "b.txt", strings.Repeat("B", 5000)+"\n")
	changed, err := m.Reload()
	if changed {
		t.Fatal("total failure must keep the previous snapshot")
	}
	var partial *PartialLoadError
	if !asPartial(err, &partial) {
		t.Fatalf("total failure must report PartialLoadError, got %v", err)
	}
	if got := m.Match(&model.Event{Network: &model.Network{DestinationIP: "5.5.5.5"}}); len(got) != 1 {
		t.Fatalf("previous lists must survive a total failure: %+v", got)
	}
}

// F6 (agente 32): userinfo en URL no se come el host.
func TestParseLineURLWithUserinfo(t *testing.T) {
	kind, value := parseLine("http://user:pass@evil.example.com/path")
	if kind != KindDomain || value != "evil.example.com" {
		t.Fatalf("userinfo URL -> %s %s, want domain evil.example.com", kind, value)
	}
	kind, value = parseLine("http://h4x:pw@203.0.113.9/x")
	if kind != KindIP || value != "203.0.113.9" {
		t.Fatalf("userinfo URL with IP -> %s %s, want ip 203.0.113.9", kind, value)
	}
}

// F4/F5 (agente 32): duplicados cuentan como skipped y nets se dedup.
func TestIntelListStatsCountDuplicates(t *testing.T) {
	dir := t.TempDir()
	writeList(t, dir, "dupes.txt", "8.8.8.8\n8.8.8.8\nevil.example.com\nEVIL.example.com\n198.51.100.0/24\n198.51.100.0/24\n")
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if m.Total() != 3 {
		t.Fatalf("duplicates must not inflate Total: %d", m.Total())
	}
	for _, l := range m.Lists() {
		if l.Name != "dupes" {
			continue
		}
		if l.Indicators != 3 || l.Skipped != 3 {
			t.Fatalf("dupes.txt: indicators=%d skipped=%d, want 3/3", l.Indicators, l.Skipped)
		}
	}
}

func asPartial(err error, target **PartialLoadError) bool {
	if err == nil {
		return false
	}
	if p, ok := err.(*PartialLoadError); ok {
		*target = p
		return true
	}
	return false
}

// Benchmark del P1 original (backlog sesión 2 #2): con 20k CIDRs el
// escaneo lineal por evento costaba cientos de µs; el índice por
// octeto debe quedar ~3 órdenes por debajo en el no-hit (peor caso).
func BenchmarkIntelMatchNets(b *testing.B) {
	for _, n := range []int{1000, 20000} {
		b.Run(fmt.Sprintf("no_hit_%d", n), func(b *testing.B) {
			dir := b.TempDir()
			var sb strings.Builder
			for i := 0; i < n; i++ {
				fmt.Fprintf(&sb, "10.%d.%d.0/24\n", i/256%256, i%256)
			}
			if err := os.WriteFile(filepath.Join(dir, "big.txt"), []byte(sb.String()), 0o600); err != nil {
				b.Fatal(err)
			}
			m, err := Load(dir)
			if err != nil {
				b.Fatal(err)
			}
			ev := &model.Event{Network: &model.Network{DestinationIP: "203.0.113.9"}}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if hits := m.Match(ev); len(hits) != 0 {
					b.Fatalf("unexpected hit %+v", hits)
				}
			}
		})
		b.Run(fmt.Sprintf("hit_%d", n), func(b *testing.B) {
			dir := b.TempDir()
			var sb strings.Builder
			for i := 0; i < n; i++ {
				fmt.Fprintf(&sb, "10.%d.%d.0/24\n", i/256%256, i%256)
			}
			if err := os.WriteFile(filepath.Join(dir, "big.txt"), []byte(sb.String()), 0o600); err != nil {
				b.Fatal(err)
			}
			m, err := Load(dir)
			if err != nil {
				b.Fatal(err)
			}
			ev := &model.Event{Network: &model.Network{DestinationIP: "10.199.199.55"}}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if hits := m.Match(ev); len(hits) == 0 {
					b.Fatal("expected a hit")
				}
			}
		})
	}
	_ = time.Now
}
