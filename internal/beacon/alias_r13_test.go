package beacon

// Tests del feature alias dominio/IP (sesión 100agentes-3, agente 52):
// el tráfico a un dominio y al mismo destino conocido solo por IP caen
// en la MISMA clave (fusión E3+ETW), con TTL, cap y excludes honestos.

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
)

func TestBeaconAliasMergesDomainAndIPIntoOneAlert(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	fired := 0
	var lastSummary string
	m.SetEmit(func(a alert.Alert) { fired++; lastSummary = a.Summary })

	// mitad de las muestras con dominio (E3/Sysmon), mitad solo-IP (ETW)
	for i := 0; i < 8; i++ {
		if i%2 == 0 {
			m.Observe(netEv("LAB-WKS-01", "203.0.113.50", "c2.evil.test", 443), base.Add(time.Duration(i)*time.Second))
		} else {
			m.Observe(netEv("LAB-WKS-01", "203.0.113.50", "", 443), base.Add(time.Duration(i)*time.Second))
		}
	}
	if got := len(m.state); got != 1 {
		t.Fatalf("domain and IP-only traffic must share one key, got %d keys", got)
	}
	if fired != 1 {
		t.Fatalf("merged evidence must fire once (fired=%d)", fired)
	}
	if !strings.Contains(lastSummary, "c2.evil.test") || !strings.Contains(lastSummary, "(alias 203.0.113.50)") {
		t.Fatalf("summary must name the domain and the aliased IP: %q", lastSummary)
	}
}

func TestBeaconAliasTTLExpiredDoesNotResolve(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	m.Observe(netEv("LAB-WKS-01", "203.0.113.50", "c2.evil.test", 443), base)
	if len(m.alias) != 1 {
		t.Fatalf("alias must be recorded, got %d", len(m.alias))
	}
	// tráfico solo-IP tras el TTL: sin alias vivo abre la clave por IP
	// (la clave de dominio del primer evento sigue existiendo: son 2)
	m.Observe(netEv("LAB-WKS-01", "203.0.113.50", "", 443), base.Add(aliasTTL+time.Minute))
	if len(m.state) != 2 {
		t.Fatalf("expired alias must open an IP-keyed ring (2 keys), got %d", len(m.state))
	}
	for key := range m.state {
		if key.host == "lab-wks-01" && key.dest == "203.0.113.50" {
			return // the IP-only ring exists as expected
		}
	}
	t.Fatal("IP-keyed ring missing")
}

func TestBeaconAliasCapBoundsMap(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	for i := 0; i < aliasMax+64; i++ {
		ip := fmt.Sprintf("198.18.%d.%d", i/254%254, i%254)
		m.Observe(netEv("LAB-WKS-01", ip, "d.evil.test", 443), base.Add(time.Duration(i)*time.Millisecond))
	}
	if len(m.alias) > aliasMax {
		t.Fatalf("alias table grew to %d, cap is %d", len(m.alias), aliasMax)
	}
}

func TestBeaconAliasRespectsExcludeDomains(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, `
- name: p1
  id: bcn-p1
  severity: low
  window: 5m
  min_count: 3
  max_jitter: 0.5
  exclude_domains:
    - c2.evil.test
`), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	// el tráfico con dominio siembra el alias, pero está excluido
	m.Observe(netEv("LAB-WKS-01", "203.0.113.50", "c2.evil.test", 443), base)
	// el tráfico solo-IP con alias fresco hereda el dest excluido: no trackea
	m.Observe(netEv("LAB-WKS-01", "203.0.113.50", "", 443), base.Add(time.Second))
	m.Observe(netEv("LAB-WKS-01", "203.0.113.50", "", 443), base.Add(2*time.Second))
	if got := len(m.state); got != 0 {
		t.Fatalf("aliased destination must respect exclude_domains, got %d keys", got)
	}
}

func TestBeaconAliasWriteRequiresRoutableIP(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	for _, ip := range []string{"127.0.0.1", "169.254.1.1", "::1", ""} {
		m.Observe(netEv("LAB-WKS-01", ip, "d.evil.test", 443), base)
	}
	if len(m.alias) != 0 {
		t.Fatalf("loopback/link-local/unspecified must not seed aliases, got %d", len(m.alias))
	}
}
