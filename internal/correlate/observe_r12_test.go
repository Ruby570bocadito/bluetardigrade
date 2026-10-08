package correlate

// Tests de regresión Ronda 12 (sesión 100agentes-3, agentes 35/48):
// cadenas host-scope con feeds de Host vacío (P2) y el re-anclaje de
// span que evita el estado inmortal (P3).

import (
	"testing"
	"time"
)

// (a) P2: un feed que reporta Host=="" nunca registraba st.hosts y la
// completion exigía len(st.hosts) >= minHosts (1 por defecto): la
// cadena host-scoped quedaba clavada hasta expirar SIN alertar.
func TestObserveEmptyHostCompletesHostScope(t *testing.T) {
	var c collector
	m, err := LoadDir(writeSeq(t, seqYAML), c.emit)
	if err != nil {
		t.Fatal(err)
	}
	m.Observe(ev("", 0), "Regla A")
	m.Observe(ev("", time.Second), "Regla B")
	m.Observe(ev("", 2*time.Second), "Regla C")
	if c.count() != 1 {
		t.Fatalf("empty-host feed must complete a host-scoped chain, alerts = %d", c.count())
	}
	if a := c.alerts[0]; a.RuleName != "Campana de prueba" {
		t.Fatalf("unexpected alert: %+v", a)
	}
	if m.States() != 0 {
		t.Fatalf("chain must re-arm after firing, live states = %d", m.States())
	}
}

// (b) P3: expires se refrescaba ANTES del check de span — con todos los
// pasos vistos pero span > window el estado era inmortal (se refrescaba
// en cada hit sin poder completar). Ahora el re-anclaje suelta los
// pasos con t < ts-window.
func TestObserveSpanExpiryReanchors(t *testing.T) {
	var c collector
	m, err := LoadDir(writeSeq(t, seqYAML), c.emit)
	if err != nil {
		t.Fatal(err)
	}
	// A@0 y B@6m: span 6m > window 5m → re-anclaje (A@0 se suelta)
	m.Observe(ev("H1", 0), "Regla A")
	m.Observe(ev("H1", 6*time.Minute), "Regla B")
	if got := m.States(); got != 1 {
		t.Fatalf("state must survive the re-anchor, states = %d", got)
	}
	// B@6m+1s (refresco), C@6m+2s y A@6m+3s: span ~3s <= 5m → completa
	m.Observe(ev("H1", 6*time.Minute+time.Second), "Regla B")
	m.Observe(ev("H1", 6*time.Minute+2*time.Second), "Regla C")
	m.Observe(ev("H1", 6*time.Minute+3*time.Second), "Regla A")
	if c.count() != 1 {
		t.Fatalf("fresh anchor must complete, alerts = %d", c.count())
	}
	if m.States() != 0 {
		t.Fatalf("completed chain must re-arm, states = %d", m.States())
	}
	// y el estado pre-fix era INMORTAL: barridos repetidos con hits
	// parlanchines nunca lo reclamaban — el re-anclaje devuelve la
	// caducidad (tras re-arm no queda nada que barrer)
	if n := m.Sweep(time.Now().Add(time.Hour)); n != 0 {
		t.Fatalf("nothing left to sweep after re-arm, swept = %d", n)
	}
}
