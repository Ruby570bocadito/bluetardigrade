package suppress

// Tests de regresión Ronda 11 (sesión 100agentes-3, agente 37):
// parseo estricto del YAML (H1) y sombra condicional→incondicional (H2).

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func strictEvent(name, cmdline string) *model.Event {
	return &model.Event{
		Type:    model.TypeProcessCreate,
		Host:    "LAB-WKS-01",
		Process: &model.Process{PID: 100, Name: name, CommandLine: cmdline},
	}
}

// H1: una errata en el YAML ya no se ignora en silencio — la carga
// FALLA, porque "hosts:" plural silenciaba la regla en TODOS los hosts.
func TestSuppressLoadRejectsUnknownFields(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "sup.yaml")
	body := `
- rule_id: vss-delete
  hosts: lab-wks-01
  reason: errata plural que antes se tragaba en silencio
`
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	m := New()
	if err := m.LoadFile(p); err == nil {
		t.Fatal("a typo'd field must fail the load (KnownFields), not widen the silence to every host")
	}
	// el YAML correcto sigue cargando
	if err := os.WriteFile(p, []byte("\n- rule_id: vss-delete\n  host: lab-wks-01\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.LoadFile(p); err != nil {
		t.Fatalf("valid file must still load: %v", err)
	}
}

// H2: una entrada condicional PRIMERA no hace sombra a una
// incondicional POSTERIOR — el gate evalúa todas las coincidencias.
func TestSuppressConditionalDoesNotShadowUnconditional(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "sup.yaml")
	body := `
- rule_id: r-shadow
  host: lab-wks-01
  when:
    - field: process.name
      operator: eq
      value: notepad.exe
  reason: solo el notepad esta permitido
- rule_id: r-shadow
  host: lab-wks-01
  reason: retirada total de la regla en este host
`
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	m := New()
	if err := m.LoadFile(p); err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	now := time.Now()

	// evento que NO cumple la condición de la primera entrada: la
	// segunda (incondicional) debe silenciar igualmente. Antes del fix
	// la primera decidía y la alerta disparaba.
	ev := strictEvent("cmd.exe", "whoami /all")
	ok, _ := m.SuppressedEvent("r-shadow", "lab-wks-01", ev, now)
	if !ok {
		t.Fatal("the later unconditional entry must silence what the conditional one lets through")
	}

	// sin evento (alertas agregadas): la condicional no silencia, la
	// incondicional sí.
	ok, _ = m.SuppressedEvent("r-shadow", "lab-wks-01", nil, now)
	if !ok {
		t.Fatal("with a nil event the unconditional entry must still silence")
	}

	// control: regla sin la entrada incondicional → la condicional
	// sigue inertes para eventos que no cumplen
	body2 := `
- rule_id: r-only
  host: lab-wks-01
  when:
    - field: process.name
      operator: eq
      value: notepad.exe
`
	if err := os.WriteFile(p, []byte(body2), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.LoadFile(p); err != nil {
		t.Fatal(err)
	}
	ok, _ = m.SuppressedEvent("r-only", "lab-wks-01", ev, now)
	if ok {
		t.Fatal("conditional entry must stay inert for a non-matching event")
	}
}
