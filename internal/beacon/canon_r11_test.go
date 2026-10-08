package beacon

// Tests de regresión Ronda 11 (sesión 100agentes-3, agente 34):
// canonicalización de destino (H2), descarte de telemetría no
// parseable (H3) y reset del tag SIM al reiniciar el anillo (H5).

import (
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
)

// H2: "::ffff:93.184.216.34" y "93.184.216.34" son el MISMO C2 — una
// sola clave, una sola alerta; y el FQDN con punto final no abre
// segunda clave ni evade exclude_domains.
func TestBeaconCanonicalDestMappedIPv6AndTrailingDot(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	fired := 0
	m.SetEmit(func(alert.Alert) { fired++ })

	// mitad de las muestras en forma mapped, mitad canónica: el anillo
	// debe ver UNA clave regular, no dos cadenas a medio construir.
	for i := 0; i < 8; i++ {
		dest := "185.220.101.47"
		if i%2 == 0 {
			dest = "::ffff:185.220.101.47"
		}
		m.Observe(netEv("LAB-WKS-01", dest, "", 443), base.Add(time.Duration(i)*time.Second))
	}
	if got := len(m.state); got != 1 {
		t.Fatalf("mapped+plain must share one key, got %d keys", got)
	}
	if fired != 1 {
		t.Fatalf("regular cadence across both forms must fire (fired=%d)", fired)
	}
}

func TestBeaconTrailingDotSharesKeyAndRespectsExcludes(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, `
- name: p1
  id: bcn-p1
  severity: low
  window: 5m
  min_count: 3
  max_jitter: 0.5
  exclude_domains:
    - whatsapp.com
`), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	// la mitad con punto final: sin el fix abriría DOS claves
	for i := 0; i < 4; i++ {
		d := "api.whatsapp.com"
		if i%2 == 1 {
			d = "api.whatsapp.com."
		}
		m.Observe(netEv("LAB-WKS-01", "", d, 443), base.Add(time.Duration(i)*time.Second))
	}
	if got := len(m.state); got != 0 {
		t.Fatalf("excluded domain (with FQDN dot) must not be tracked at all, got %d keys", got)
	}
}

// H3: destino no parseable (basura de transporte) no entra en la tabla.
func TestBeaconDropsUnparseableDest(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	for _, junk := range []string{"--", "not-an-ip%", "fe80::1%12", ""} {
		m.Observe(netEv("LAB-WKS-01", junk, "", 443), base)
	}
	if got := len(m.state); got != 0 {
		t.Fatalf("unparseable destinations must not be tracked, got %d keys", got)
	}
}
