package threshold

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

var t0 = time.Unix(1700000000, 0)

// loadForTest parses defs YAML and builds a detector with deterministic
// behavior (Observe takes the clock, so tests pass explicit times).
func loadForTest(t *testing.T, defsYAML string) *Detector {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "thresholds.yaml")
	if err := os.WriteFile(path, []byte(defsYAML), 0o644); err != nil {
		t.Fatal(err)
	}
	d, err := LoadFile(path)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	return d
}

const defSimple = `
- name: Rafaga escrituras
  id: thr-burst
  severity: medium
  event_type: file.write
  threshold:
    count: 5
    window: 5m
  cooldown: 10m
`

func evFile(id string, ts time.Time) *model.Event {
	return &model.Event{
		ID: id, Type: "file.write", Host: "LAB-1",
		Timestamp: ts,
		File:      &model.File{Path: `C:\Users\Public\a.dll`},
	}
}

func TestFiresAtExactCountAndNotBelow(t *testing.T) {
	d := loadForTest(t, defSimple)
	var fired int
	d.SetEmit(func(a alert.Alert) { fired++ })
	for i := 1; i <= 4; i++ {
		d.Observe(evFile(fmt.Sprintf("e%d", i), t0.Add(time.Duration(i)*time.Second)), t0.Add(time.Duration(i)*time.Second))
	}
	if fired != 0 {
		t.Fatalf("disparo con %d eventos, want 0", fired)
	}
	d.Observe(evFile("e5", t0.Add(5*time.Second)), t0.Add(5*time.Second))
	if fired != 1 {
		t.Fatalf("fired=%d, want 1 en el evento 5", fired)
	}
	if d.Fired() != 1 || d.KeysTracked() != 1 {
		t.Fatalf("contador fired=%d keys=%d", d.Fired(), d.KeysTracked())
	}
}

func TestWindowRolloverResetsCount(t *testing.T) {
	d := loadForTest(t, defSimple)
	var fired int
	d.SetEmit(func(alert.Alert) { fired++ })
	// 4 eventos, ventana vence, 4 mas: nunca llega a 5 en una ventana
	for i := 0; i < 4; i++ {
		ts := t0.Add(time.Duration(i) * time.Second)
		d.Observe(evFile(fmt.Sprintf("a%d", i), ts), ts)
	}
	for i := 0; i < 4; i++ {
		ts := t0.Add(6*time.Minute + time.Duration(i)*time.Second)
		d.Observe(evFile(fmt.Sprintf("b%d", i), ts), ts)
	}
	if fired != 0 {
		t.Fatalf("rollover de ventana no resets el conteo: fired=%d", fired)
	}
	// el 5º del segundo tramo si dispara
	ts := t0.Add(6*time.Minute + 4*time.Second)
	d.Observe(evFile("b5", ts), ts)
	if fired != 1 {
		t.Fatalf("fired=%d, want 1", fired)
	}
}

func TestBoundaryTradeOffDocumented(t *testing.T) {
	// dictamen Q1: la ventana fija puede contar hasta 2x(count-1)
	// en 2xT cruzando la frontera — comportamiento ACEPTADO; este
	// test lo fija como contrato para que nadie lo "arregle" en
	// silencio rompiendo el bound de memoria.
	d := loadForTest(t, defSimple)
	var fired int
	d.SetEmit(func(alert.Alert) { fired++ })
	// 4 eventos justo antes de la frontera y 4 justo despues:
	// el conteo debe seguir vivo en la nueva ventana parcial
	for i := 0; i < 4; i++ {
		ts := t0.Add(4*time.Minute + time.Duration(i)*time.Second)
		d.Observe(evFile(fmt.Sprintf("x%d", i), ts), ts)
	}
	// la ventana de 5m abierta en t0+0 vence en t0+5m; evento en t0+5m1s
	// NO resetea si windowStart t0+4m03 (rollover solo cuando >= window)
	ts := t0.Add(5*time.Minute + 1*time.Second)
	d.Observe(evFile("x4", ts), ts)
	if d.KeysTracked() != 1 {
		t.Fatalf("keys=%d, want 1", d.KeysTracked())
	}
}

func TestGroupBySeparatesKeys(t *testing.T) {
	defs := `
- name: Fuerza bruta
  id: thr-bf
  severity: medium
  event_type: network.connect
  conditions:
    - { field: network.destination_port, operator: eq, value: 22 }
  threshold:
    count: 3
    window: 5m
    group_by: network.source_ip
`
	d := loadForTest(t, defs)
	var fired int
	d.SetEmit(func(alert.Alert) { fired++ })
	mk := func(id, ip string) *model.Event {
		return &model.Event{
			ID: id, Type: "network.connect", Host: "LAB-1", Timestamp: t0,
			Network: &model.Network{DestinationPort: 22, SourceIP: ip},
		}
	}
	d.Observe(mk("1", "10.0.0.1"), t0)
	d.Observe(mk("2", "10.0.0.2"), t0)
	d.Observe(mk("3", "10.0.0.1"), t0)
	if fired != 0 || d.KeysTracked() != 2 {
		t.Fatalf("fired=%d keys=%d, want 0/2", fired, d.KeysTracked())
	}
	d.Observe(mk("4", "10.0.0.1"), t0)
	if fired != 1 {
		t.Fatalf("fired=%d, want 1 (grupo 10.0.0.1 llega a 3)", fired)
	}
}

func TestHostCaseFolding(t *testing.T) {
	d := loadForTest(t, defSimple)
	var fired int
	d.SetEmit(func(alert.Alert) { fired++ })
	for i := 0; i < 3; i++ {
		ev := evFile(fmt.Sprintf("u%d", i), t0)
		ev.Host = "Lab-1"
		d.Observe(ev, t0)
	}
	for i := 0; i < 2; i++ {
		ev := evFile(fmt.Sprintf("l%d", i), t0)
		ev.Host = "LAB-1"
		d.Observe(ev, t0)
	}
	if d.KeysTracked() != 1 {
		t.Fatalf("host case-folding fallo: keys=%d", d.KeysTracked())
	}
	if fired != 1 {
		t.Fatalf("fired=%d, want 1", fired)
	}
}

func TestCooldownBlindsKey(t *testing.T) {
	d := loadForTest(t, defSimple) // cooldown 10m, window 5m
	var fired int
	d.SetEmit(func(alert.Alert) { fired++ })
	for i := 0; i < 5; i++ {
		ts := t0.Add(time.Duration(i) * time.Second)
		d.Observe(evFile(fmt.Sprintf("c%d", i), ts), ts)
	}
	if fired != 1 {
		t.Fatalf("primer disparo: fired=%d", fired)
	}
	// el fire reseteo la ventana (windowStart=t0+4s): 5 eventos en
	// t0+9m llegan a count=5 pero siguen DENTRO del cooldown de 10m
	// y NO disparan
	for i := 0; i < 5; i++ {
		ts := t0.Add(time.Duration(i)*time.Second + 9*time.Minute)
		d.Observe(evFile(fmt.Sprintf("d%d", i), ts), ts)
	}
	if fired != 1 {
		t.Fatalf("cooldown no blinda: fired=%d", fired)
	}
	// pasado el cooldown (ultima marca t0+9m4s + 10m), la siguiente
	// rafaga dispara
	for i := 0; i < 5; i++ {
		ts := t0.Add(time.Duration(i)*time.Second + 20*time.Minute)
		d.Observe(evFile(fmt.Sprintf("e%d", i), ts), ts)
	}
	if fired != 2 {
		t.Fatalf("post-cooldown fired=%d, want 2", fired)
	}
}

func TestConditionsFilterCountedEvents(t *testing.T) {
	defs := `
- name: Solo dll
  id: thr-dll
  severity: low
  event_type: file.write
  conditions:
    - { field: file.path, operator: endswith, value: ".dll" }
  threshold:
    count: 2
    window: 5m
`
	d := loadForTest(t, defs)
	var fired int
	d.SetEmit(func(alert.Alert) { fired++ })
	ev := func(id, p string) *model.Event {
		return &model.Event{ID: id, Type: "file.write", Host: "H", Timestamp: t0, File: &model.File{Path: p}}
	}
	d.Observe(ev("1", `C:\Temp\readme.txt`), t0)
	d.Observe(ev("2", `C:\Temp\evil.dll`), t0)
	d.Observe(ev("3", `C:\Temp\notes.pdf`), t0)
	if fired != 0 {
		t.Fatalf("eventos fuera del predicado contaron: fired=%d", fired)
	}
	d.Observe(ev("4", `C:\Temp\other.dll`), t0)
	if fired != 1 || d.KeysTracked() != 1 {
		t.Fatalf("fired=%d keys=%d, want 1/1", fired, d.KeysTracked())
	}
}

func TestEventTypeIsolation(t *testing.T) {
	d := loadForTest(t, defSimple)
	var fired int
	d.SetEmit(func(alert.Alert) { fired++ })
	for i := 0; i < 10; i++ {
		ev := &model.Event{ID: fmt.Sprintf("p%d", i), Type: "process.create", Host: "LAB-1", Timestamp: t0, Process: &model.Process{Name: "x.exe"}}
		d.Observe(ev, t0)
	}
	if d.KeysTracked() != 0 || fired != 0 {
		t.Fatalf("eventos de otro tipo crearon estado: keys=%d fired=%d", d.KeysTracked(), fired)
	}
}

func TestEmptyConditionsCountEverything(t *testing.T) {
	d := loadForTest(t, defSimple)
	var fired int
	d.SetEmit(func(alert.Alert) { fired++ })
	for i := 0; i < 5; i++ {
		d.Observe(evFile(fmt.Sprintf("z%d", i), t0), t0)
	}
	if fired != 1 {
		t.Fatalf("conditions vacias deben contar todo: fired=%d", fired)
	}
}

func TestExpiredKeysPurgedOnAdmission(t *testing.T) {
	d := loadForTest(t, defSimple) // window 5m -> expira a los >10m
	// 3 claves distintas en t0
	for i := 0; i < 3; i++ {
		ev := evFile(fmt.Sprintf("k%d", i), t0)
		ev.File.Path = fmt.Sprintf(`C:\Users\Public\%d.dll`, i)
		d.Observe(ev, t0)
	}
	// claves por IP? no: path no es group_by; sin group_by la clave es
	// (rule, host) -> solo 1 clave. Usamos host distintos:
	d2 := loadForTest(t, defSimple)
	hosts := []string{"H1", "H2", "H3"}
	for _, h := range hosts {
		ev := evFile("x", t0)
		ev.Host = h
		d2.Observe(ev, t0)
	}
	if d2.KeysTracked() != 3 {
		t.Fatalf("keys=%d, want 3", d2.KeysTracked())
	}
	// a t0+11m las ventanas vencieron (2x5m), pero SIN presion de cap
	// la purga es PEREZOSA (nada expira eager: O(N) solo bajo admision)
	ev := evFile("y", t0.Add(11*time.Minute))
	ev.Host = "H4"
	d2.Observe(ev, t0.Add(11*time.Minute))
	if d2.KeysTracked() != 4 {
		t.Fatalf("sin presion de cap las claves expiradas no se tocan: keys=%d, want 4", d2.KeysTracked())
	}
}

func TestQuotaIsAdmissionCeiling(t *testing.T) {
	// F1.1 (adenda 11h02): la cuota es SOLO techo de admision. La
	// clave 2049 no se crea (evento descartado para esa regla) y NO
	// hay expulsion: la evidencia de otras reglas queda intacta y las
	// claves existentes de la propia regla siguen contando y disparando.
	defs := `
- name: Flood
  id: thr-a
  severity: low
  event_type: file.write
  threshold: { count: 4096, window: 24h }
- name: Victima
  id: thr-b
  severity: low
  event_type: process.create
  threshold: { count: 4096, window: 24h }
`
	d := loadForTest(t, defs)
	var fired int
	d.SetEmit(func(alert.Alert) { fired++ })
	// la victima acumula evidencia: 1 clave con 10 conteos (count 4096:
	// nunca dispara con 10 eventos, solo acumula)
	for i := 0; i < 10; i++ {
		d.Observe(&model.Event{ID: fmt.Sprintf("v%d", i), Type: "process.create", Host: "victim", Timestamp: t0}, t0)
	}
	// la atacante inunda hasta la cuota con claves de 1 conteo
	for i := 0; i < MaxKeysPerRule; i++ {
		d.Observe(&model.Event{ID: fmt.Sprintf("f%d", i), Type: "file.write", Host: fmt.Sprintf("FLOOD%d", i), Timestamp: t0}, t0)
	}
	if d.KeysTracked() != MaxKeysPerRule+1 {
		t.Fatalf("keys=%d, want %d", d.KeysTracked(), MaxKeysPerRule+1)
	}
	// intentos de clave 2049: DESCARTADOS (no admitidos, no expulsan)
	for i := 0; i < 50; i++ {
		d.Observe(&model.Event{ID: fmt.Sprintf("x%d", i), Type: "file.write", Host: fmt.Sprintf("EXTRA%d", i), Timestamp: t0}, t0)
	}
	if d.KeysTracked() != MaxKeysPerRule+1 {
		t.Fatalf("la cuota admitio o expulso: keys=%d", d.KeysTracked())
	}
	d.mu.Lock()
	perA := d.perRule["thr-a"]
	victim, vOK := d.keys[key{ruleID: "thr-b", host: "victim"}]
	d.mu.Unlock()
	if perA != MaxKeysPerRule {
		t.Fatalf("cuota=%d, want %d", perA, MaxKeysPerRule)
	}
	if !vOK || victim.count != 10 {
		t.Fatalf("evidencia de la victima tocada: ok=%v count=%d", vOK, victim.count)
	}
	// las claves EXISTENTES de la regla saturada siguen contando y
	// disparando con normalidad (la cuota no la silencia)
	for i := 0; i < 4095; i++ {
		d.Observe(&model.Event{ID: fmt.Sprintf("w%d", i), Type: "file.write", Host: "FLOOD0", Timestamp: t0}, t0)
	}
	if fired != 1 {
		t.Fatalf("una regla en cuota debe seguir disparando con sus claves existentes: fired=%d", fired)
	}
}

func TestGlobalCapWeakestFirstGlobal(t *testing.T) {
	// F1.2 (adenda 11h02): cap global lleno sin expiradas -> la
	// expulsion es weakest-first GLOBAL (menor conteo, empate por
	// clave menor), sin restricciones por regla y sin tocar nunca a
	// la recien llegada. El flood (claves count=1) se lava a si
	// mismo; la evidencia real (count alto) sobrevive.
	var b strings.Builder
	for r := 0; r < 4; r++ {
		fmt.Fprintf(&b, "- name: Flood %d\n  id: thr-f%d\n  severity: low\n  event_type: file.write\n  conditions:\n    - { field: file.path, operator: startswith, value: 'C:\\dir%d\\' }\n  threshold: { count: 4096, window: 24h }\n", r, r, r)
	}
	b.WriteString("- name: Evidencia\n  id: thr-real\n  severity: low\n  event_type: image.load\n  threshold: { count: 4096, window: 24h }\n")
	d := loadForTest(t, b.String())
	d.SetEmit(func(alert.Alert) {})
	// 4 reglas x cuota con claves count=1 (flood puro)
	for r := 0; r < 4; r++ {
		for i := 0; i < MaxKeysPerRule; i++ {
			ev := &model.Event{ID: "e", Type: "file.write", Host: fmt.Sprintf("F%d-%d", r, i), Timestamp: t0,
				File: &model.File{Path: fmt.Sprintf("C:\\dir%d\\f.dll", r)}}
			d.Observe(ev, t0)
		}
	}
	// evidencia real: 3 claves con 50 conteos (regla aparte, bajo cuota)
	for h := 0; h < 3; h++ {
		for i := 0; i < 50; i++ {
			d.Observe(&model.Event{ID: fmt.Sprintf("r%d", i), Type: "image.load", Host: fmt.Sprintf("REAL%d", h), Timestamp: t0}, t0)
		}
	}
	// el mapa YA esta lleno: cada clave de evidencia entra DESPLAZANDO
	// la clave mas debil del flood (weakest-first global en accion) —
	// el total queda clavado en MaxKeys
	if d.KeysTracked() != MaxKeys {
		t.Fatalf("keys=%d, want %d", d.KeysTracked(), MaxKeys)
	}
	// una admision nueva mas: sigue weakest-first global; la evidencia
	// de 50 conteos es intocable y la recien llegada queda admitida
	d.Observe(&model.Event{ID: "n", Type: "image.load", Host: "NEWCOMER", Timestamp: t0}, t0)
	d.mu.Lock()
	_, newcomerAlive := d.keys[key{ruleID: "thr-real", host: "newcomer"}]
	realAlive := 0
	for _, h := range []string{"real0", "real1", "real2"} {
		if _, ok := d.keys[key{ruleID: "thr-real", host: h}]; ok {
			realAlive++
		}
	}
	d.mu.Unlock()
	if !newcomerAlive {
		t.Fatal("la recien llegada no fue admitida")
	}
	if realAlive != 3 {
		t.Fatalf("evidencia real lavada: %d/3 claves vivas", realAlive)
	}
	if d.KeysTracked() != MaxKeys {
		t.Fatalf("keys=%d, want %d (el cap global no cede)", d.KeysTracked(), MaxKeys)
	}
}

func TestGlobalCapPurgesExpiredFirst(t *testing.T) {
	// 4 reglas x cuota 2048 = 8192 = MaxKeys: el cap global SOLO se
	// alcanza a traves de las cuotas por regla (coherencia de bounds).
	// Las condiciones PARTICIONAN los eventos por prefijo de ruta para
	// que cada admission toque UNA regla (el test mide el policy del
	// cap, no el coste O(N) de saturacion cruzada, aceptado por el
	// precedente O1 de A1).
	var b strings.Builder
	for r := 0; r < 4; r++ {
		fmt.Fprintf(&b, "- name: Expirable %d\n  id: thr-x%d\n  severity: low\n  event_type: file.write\n  conditions:\n    - { field: file.path, operator: startswith, value: 'C:\\dir%d\\' }\n  threshold: { count: 2, window: 1m }\n", r, r, r)
	}
	b.WriteString("- name: Reciente\n  id: thr-y\n  severity: low\n  event_type: process.create\n  threshold: { count: 2, window: 24h }\n")
	d := loadForTest(t, b.String())
	d.SetEmit(func(alert.Alert) {})
	// llenar el cap con claves antiguas (window 1m -> expiran a 2m)
	for r := 0; r < 4; r++ {
		for i := 0; i < MaxKeysPerRule; i++ {
			ev := &model.Event{ID: "e", Type: "file.write", Host: fmt.Sprintf("X%d-OLD%d", r, i), Timestamp: t0,
				File: &model.File{Path: fmt.Sprintf("C:\\dir%d\\f.dll", r)}}
			d.Observe(ev, t0)
		}
	}
	if d.KeysTracked() != MaxKeys {
		t.Fatalf("keys=%d, want %d (4x cuota)", d.KeysTracked(), MaxKeys)
	}
	// admision fresca: TODAS las claves expiradas (2x1m < 3m) se
	// purgan ANTES de expulsar a nadie vivo
	d.Observe(&model.Event{ID: "n1", Type: "process.create", Host: "NEW", Timestamp: t0}, t0.Add(3*time.Minute))
	d.mu.Lock()
	_, oldAlive := d.keys[key{ruleID: "thr-x0", host: "x0-old0"}] // host foldado
	_, newAlive := d.keys[key{ruleID: "thr-y", host: "new"}]      // host foldado
	d.mu.Unlock()
	if !newAlive {
		t.Fatal("la clave nueva no fue admitida")
	}
	if oldAlive {
		t.Fatal("una clave expirada sobrevivio a la purga")
	}
}

func TestGlobalCapViolatorEvictedNotVictim(t *testing.T) {
	// sin expiradas: la regla que VIOLA la cuota (o el mayor consumidor)
	// cede su clave mas debil, no la evidencia ajena
	defs := `
- name: Consumidor
  id: thr-big
  severity: low
  event_type: file.write
  threshold: { count: 4096, window: 24h }
- name: Otra
  id: thr-other
  severity: low
  event_type: process.create
  threshold: { count: 4096, window: 24h }
`
	d := loadForTest(t, defs)
	d.SetEmit(func(alert.Alert) {})
	// consumidor: MaxKeysPerRule claves (cuota llena) con 1 conteo c/u
	for i := 0; i < MaxKeysPerRule; i++ {
		d.Observe(&model.Event{ID: "b", Type: "file.write", Host: fmt.Sprintf("B%d", i), Timestamp: t0}, t0)
	}
	// otra: 5 claves con 5 conteos cada una (evidencia real)
	for h := 0; h < 5; h++ {
		for i := 0; i < 5; i++ {
			d.Observe(&model.Event{ID: fmt.Sprintf("o%d", i), Type: "process.create", Host: fmt.Sprintf("O%d", h), Timestamp: t0}, t0)
		}
	}
	d.mu.Lock()
	before := len(d.keys)
	d.mu.Unlock()
	if before != MaxKeysPerRule+5 {
		t.Fatalf("keys=%d, want %d", before, MaxKeysPerRule+5)
	}
	// admission de UNA clave mas del consumidor: su propia clave debil sale
	d.Observe(&model.Event{ID: "b", Type: "file.write", Host: "B-NEW", Timestamp: t0}, t0)
	d.mu.Lock()
	_, victimAlive := d.keys[key{ruleID: "thr-other", host: "o0"}] // host foldado
	d.mu.Unlock()
	if !victimAlive {
		t.Fatal("la eviction global toco la evidencia de una regla dentro de cuota")
	}
	if d.perRule["thr-big"] != MaxKeysPerRule {
		t.Fatalf("cuota del consumidor = %d, want %d", d.perRule["thr-big"], MaxKeysPerRule)
	}
}

func TestLoadValidationErrors(t *testing.T) {
	cases := map[string]string{
		"yaml roto":      "- name: [",
		"sin name":       "- id: x\n  severity: low\n  event_type: file.write\n  threshold: { count: 5, window: 5m }",
		"sin id":         "- name: x\n  severity: low\n  event_type: file.write\n  threshold: { count: 5, window: 5m }",
		"severidad":      "- name: x\n  id: x1\n  severity: alta\n  event_type: file.write\n  threshold: { count: 5, window: 5m }",
		"sin event_type": "- name: x\n  id: x2\n  severity: low\n  threshold: { count: 5, window: 5m }",
		"count 1":        "- name: x\n  id: x3\n  severity: low\n  event_type: file.write\n  threshold: { count: 1, window: 5m }",
		"count enorme":   "- name: x\n  id: x4\n  severity: low\n  event_type: file.write\n  threshold: { count: 99999, window: 5m }",
		"window mala":    "- name: x\n  id: x5\n  severity: low\n  event_type: file.write\n  threshold: { count: 5, window: 5metros }",
		"window enorme":  "- name: x\n  id: x6\n  severity: low\n  event_type: file.write\n  threshold: { count: 5, window: 48h }",
		"cooldown malo":  "- name: x\n  id: x7\n  severity: low\n  event_type: file.write\n  threshold: { count: 5, window: 5m }\n  cooldown: nunca",
		"regex mala":     "- name: x\n  id: x8\n  severity: low\n  event_type: file.write\n  conditions:\n    - { field: file.path, operator: regex, value: \"([\" }\n  threshold: { count: 5, window: 5m }",
		"id duplicado":   "- name: a\n  id: dup\n  severity: low\n  event_type: file.write\n  threshold: { count: 5, window: 5m }\n- name: b\n  id: dup\n  severity: low\n  event_type: process.create\n  threshold: { count: 5, window: 5m }",
		"cond sin campo": "- name: x\n  id: x9\n  severity: low\n  event_type: file.write\n  conditions:\n    - { operator: eq, value: 1 }\n  threshold: { count: 5, window: 5m }",
	}
	dir := t.TempDir()
	for name, content := range cases {
		p := filepath.Join(dir, fmt.Sprintf("%d.yaml", len(name)))
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := LoadFile(p); err == nil {
			t.Errorf("%s: aceptado y debia rechazarse", name)
		} else if !strings.Contains(err.Error(), "threshold:") {
			t.Errorf("%s: error sin contexto de paquete: %v", name, err)
		}
	}
}

func TestLoadMaxRulesExceeded(t *testing.T) {
	var b strings.Builder
	for i := 0; i <= MaxRules; i++ {
		fmt.Fprintf(&b, "- name: d%d\n  id: id-%d\n  severity: low\n  event_type: file.write\n  threshold: { count: 5, window: 5m }\n", i, i)
	}
	dir := t.TempDir()
	p := filepath.Join(dir, "many.yaml")
	os.WriteFile(p, []byte(b.String()), 0o644)
	_, err := LoadFile(p)
	if err == nil || !strings.Contains(err.Error(), "max 64") {
		t.Fatalf("MaxRules no aplicado: %v", err)
	}
}

func TestReloadPrunesDeadKeys(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "t.yaml")
	os.WriteFile(p, []byte(defSimple), 0o644)
	d, err := LoadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	d.SetEmit(func(alert.Alert) {})
	d.Observe(evFile("r1", t0), t0)
	if d.KeysTracked() != 1 {
		t.Fatalf("keys=%d", d.KeysTracked())
	}
	// reload SIN la definicion: la clave huerfana se poda
	os.WriteFile(p, []byte(`
- name: Otra cosa
  id: thr-other
  severity: low
  event_type: process.create
  threshold: { count: 5, window: 5m }
`), 0o644)
	if err := d.Reload(p); err != nil {
		t.Fatal(err)
	}
	if d.KeysTracked() != 0 {
		t.Fatalf("reload no podo claves muertas: keys=%d", d.KeysTracked())
	}
	if d.Count() != 1 {
		t.Fatalf("count=%d tras reload", d.Count())
	}
}

func TestReloadMalformedKeepsPrevious(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "t.yaml")
	os.WriteFile(p, []byte(defSimple), 0o644)
	d, _ := LoadFile(p)
	if err := d.Reload(filepath.Join(dir, "no-existe.yaml")); err == nil {
		t.Fatal("reload de fichero inexistente aceptado")
	}
	if d.Count() != 1 {
		t.Fatalf("la definicion previa se perdio: %d", d.Count())
	}
}

func TestNilEventSafe(t *testing.T) {
	d := loadForTest(t, defSimple)
	d.SetEmit(func(alert.Alert) {})
	d.Observe(nil, t0) // no debe paniquear
	if d.KeysTracked() != 0 {
		t.Fatalf("nil creo estado: %d", d.KeysTracked())
	}
}

func TestOversizedFileRejected(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "big.yaml")
	big := make([]byte, maxFileBytes+1)
	for i := range big {
		big[i] = ' '
	}
	os.WriteFile(p, big, 0o644)
	_, err := LoadFile(p)
	if err == nil || !strings.Contains(err.Error(), "mayor de") {
		t.Fatalf("fichero sobredimensionado aceptado: %v", err)
	}
}

func TestAlertCarriesDefinitionIdentity(t *testing.T) {
	d := loadForTest(t, defSimple)
	var got alert.Alert
	d.SetEmit(func(a alert.Alert) { got = a })
	for i := 0; i < 5; i++ {
		d.Observe(evFile(fmt.Sprintf("i%d", i), t0), t0)
	}
	if got.RuleID != "thr-burst" || got.RuleName != "Rafaga escrituras" || got.Severity != "medium" {
		t.Fatalf("identidad de la alerta mal: %+v", got)
	}
	if got.EventType != "file.write" || got.Host != "LAB-1" {
		t.Fatalf("campos del evento mal: %+v", got)
	}
	if !strings.Contains(got.Summary, "umbral alcanzado") {
		t.Fatalf("summary sin contenido: %q", got.Summary)
	}
}
func TestHostQuotaIsAdmissionCeiling(t *testing.T) {
	// v1.1 cuotas por equipo: un equipo ruidoso no puede llenar la
	// tabla compartida. La cuota del host se llena repartida entre DOS
	// reglas (1024 claves cada una) para ejercitar el camino por host
	// y no el techo por regla (que va primero y es un techo puro por
	// diseno auditado). La clave nueva 2049 de SU host se rechaza
	// (techo de admision, sin expulsion), sus claves existentes siguen
	// contando y los demas equipos admiten con normalidad.
	defs := `
- name: Flood una
  id: thr-a
  severity: low
  event_type: file.write
  threshold:
    count: 4096
    window: 24h
    group_by: file.path
- name: Flood dos
  id: thr-b
  severity: low
  event_type: file.write
  threshold:
    count: 4096
    window: 24h
    group_by: file.path
`
	d := loadForTest(t, defs)
	var fired int
	d.SetEmit(func(a alert.Alert) { fired++ })
	for i := 0; i < MaxKeysPerHost/2; i++ {
		ev := &model.Event{ID: fmt.Sprintf("f%d", i), Type: "file.write", Host: "NOISY", Timestamp: t0,
			File: &model.File{Path: fmt.Sprintf(`C:\temp\f%d.dll`, i)}}
		d.Observe(ev, t0)
	}
	if d.KeysTracked() != MaxKeysPerHost {
		t.Fatalf("keys=%d, want %d", d.KeysTracked(), MaxKeysPerHost)
	}
	// claves nuevas del host ruidoso: 20 eventos x 2 reglas = 40
	// rechazos de admision (el contador cuenta pares regla-clave)
	for i := 0; i < 20; i++ {
		ev := &model.Event{ID: fmt.Sprintf("x%d", i), Type: "file.write", Host: "NOISY", Timestamp: t0,
			File: &model.File{Path: fmt.Sprintf(`C:\temp\extra%d.dll`, i)}}
		d.Observe(ev, t0)
	}
	if d.KeysTracked() != MaxKeysPerHost {
		t.Fatalf("la cuota por host admitio o expulso: keys=%d", d.KeysTracked())
	}
	if got := d.QuotaRejected(); got != 40 {
		t.Fatalf("QuotaRejected=%d, want 40 (20 eventos x 2 reglas)", got)
	}
	// otro equipo sigue admitiendo con normalidad (1 evento, 2 reglas)
	d.Observe(&model.Event{ID: "v0", Type: "file.write", Host: "victim", Timestamp: t0,
		File: &model.File{Path: `C:\Users\Public\a.dll`}}, t0)
	if d.KeysTracked() != MaxKeysPerHost+2 {
		t.Fatalf("la victima no admite: keys=%d", d.KeysTracked())
	}
	// las claves existentes del host ruidoso siguen contando
	for i := 0; i < 5; i++ {
		ts := t0.Add(time.Duration(i) * time.Second)
		d.Observe(&model.Event{ID: fmt.Sprintf("r%d", i), Type: "file.write", Host: "NOISY", Timestamp: ts,
			File: &model.File{Path: `C:\temp\f0.dll`}}, ts)
	}
	d.mu.Lock()
	st := d.keys[key{ruleID: "thr-a", host: "noisy", group: `C:\temp\f0.dll`}]
	perHost := d.perHost["noisy"]
	d.mu.Unlock()
	if st == nil {
		t.Fatal("la clave existente del host ruidoso desaparecio")
	}
	if st.count != 6 {
		t.Fatalf("la clave existente dejo de contar: count=%d, want 6", st.count)
	}
	if perHost != MaxKeysPerHost {
		t.Fatalf("perHost=%d, want %d", perHost, MaxKeysPerHost)
	}
	top := d.QuotaTopHosts()
	if len(top) != 1 || top[0].Host != "noisy" || top[0].Rejected != 40 {
		t.Fatalf("QuotaTopHosts=%+v", top)
	}
	if fired != 0 {
		t.Fatalf("no habia disparos esperados: fired=%d", fired)
	}
}

func TestHostQuotaFreesWhenKeysExpire(t *testing.T) {
	// la cuota por host se auto-repara: al rechazar, la evidencia
	// muerta (2x ventana sin senal) se purga antes de negar la
	// admision, sin esperar a que el cap global se llene.
	defs := `
- name: Flood una
  id: thr-a
  severity: low
  event_type: file.write
  threshold:
    count: 4096
    window: 5m
    group_by: file.path
- name: Flood dos
  id: thr-b
  severity: low
  event_type: file.write
  threshold:
    count: 4096
    window: 5m
    group_by: file.path
`
	d := loadForTest(t, defs)
	d.SetEmit(func(a alert.Alert) {})
	for i := 0; i < MaxKeysPerHost/2; i++ {
		p := fmt.Sprintf(`C:\temp\f%d.dll`, i)
		d.Observe(&model.Event{ID: fmt.Sprintf("e%d", i), Type: "file.write", Host: "NOISY", Timestamp: t0,
			File: &model.File{Path: p}}, t0)
	}
	d.mu.Lock()
	perA, perB := d.perRule["thr-a"], d.perRule["thr-b"]
	d.mu.Unlock()
	if perA != MaxKeysPerHost/2 || perB != MaxKeysPerHost/2 {
		t.Fatalf("montaje: perRule a=%d b=%d, want %d cada una", perA, perB, MaxKeysPerHost/2)
	}
	// 11 minutos despues todo expira (2x ventana de 5m = 10m); una
	// admision nueva purga la evidencia muerta y entra sin rechazo.
	// Un evento alimenta las dos reglas: quedan 2 claves vivas.
	later := t0.Add(11 * time.Minute)
	d.Observe(&model.Event{ID: "new", Type: "file.write", Host: "NOISY", Timestamp: later,
		File: &model.File{Path: `C:\temp\new.dll`}}, later)
	d.mu.Lock()
	n := d.perHost["noisy"]
	keys := len(d.keys)
	d.mu.Unlock()
	if n != 2 || keys != 2 {
		t.Fatalf("la cuota no libero la evidencia expirada: perHost=%d keys=%d, want 2", n, keys)
	}
	if got := d.QuotaRejected(); got != 0 {
		t.Fatalf("QuotaRejected=%d, want 0 (hubo sitio tras la purga)", got)
	}
}
