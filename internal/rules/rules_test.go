package rules

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/pkg/model"
	"gopkg.in/yaml.v3"
)

func testEvent(name, cmdline string) *model.Event {
	return &model.Event{
		ID:        "test-id",
		Timestamp: time.Now().UTC(),
		Type:      model.TypeProcessCreate,
		Source:    "simulate",
		Host:      "LAB-WKS-01",
		User:      `CORP\jdoe`,
		Process: &model.Process{
			PID:         1000,
			PPID:        900,
			Name:        name,
			CommandLine: cmdline,
			Image:       `C:\Windows\System32\` + name,
		},
	}
}

func loadTestEngine(t *testing.T) *Engine {
	t.Helper()
	e, err := LoadDir("../../rules")
	if err != nil {
		t.Fatalf("LoadDir: %v", err)
	}
	if e.Count() != 23 {
		t.Fatalf("expected the seeded rule count, got %d", e.Count())
	}
	return e
}

func TestSeededPackDetectsEncodedPowerShell(t *testing.T) {
	e := loadTestEngine(t)
	ev := testEvent("powershell.exe", "powershell.exe -nop -w hidden -enc SQBFAFgA")
	hits := e.Evaluate(ev)
	if len(hits) != 1 {
		t.Fatalf("expected 1 hit, got %d", len(hits))
	}
	if hits[0].Rule.Severity != SevHigh {
		t.Fatalf("expected high severity, got %s", hits[0].Rule.Severity)
	}
}

func TestSeededPackDetectsLsassDump(t *testing.T) {
	e := loadTestEngine(t)
	ev := testEvent("rundll32.exe",
		`rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump 744 C:\Temp\lsass.dmp full`)
	hits := e.Evaluate(ev)
	if len(hits) != 1 {
		t.Fatalf("expected 1 hit, got %d", len(hits))
	}
	if hits[0].Rule.Severity != SevCritical {
		t.Fatalf("expected critical severity, got %s", hits[0].Rule.Severity)
	}
}

func TestSeededPackDetectsSamDump(t *testing.T) {
	e := loadTestEngine(t)
	ev := testEvent("reg.exe", `reg.exe save HKLM\SAM C:\Users\Public\sam.hiv`)
	hits := e.Evaluate(ev)
	if len(hits) != 1 {
		t.Fatalf("expected 1 hit, got %d", len(hits))
	}
	if hits[0].Rule.Name != "Volcado del registro SAM" {
		t.Fatalf("unexpected rule %q", hits[0].Rule.Name)
	}
}

func TestBenignEventsDoNotFire(t *testing.T) {
	e := loadTestEngine(t)
	for _, ev := range []*model.Event{
		testEvent("notepad.exe", `"C:\Windows\system32\NOTEPAD.EXE" todo.txt`),
		testEvent("powershell.exe", "powershell.exe Get-ChildItem C:\\Logs"),
		testEvent("certutil.exe", "certutil.exe -hashfile data.bin SHA256"),
		testEvent("reg.exe", `reg.exe query HKLM\SOFTWARE\Microsoft /v Version`),
	} {
		if hits := e.Evaluate(ev); len(hits) != 0 {
			t.Errorf("benign event %s fired %d rule(s): %v",
				ev.Process.Name, len(hits), hits[0].Rule.Name)
		}
	}
}

func TestRealtimePackDetectsRunKeyPersistence(t *testing.T) {
	e := loadTestEngine(t)
	ev := &model.Event{
		ID: "test-registry", Timestamp: time.Now().UTC(),
		Type: model.TypeRegistrySet, Source: "sysmon", Host: "LAB-WKS-01",
		Registry: &model.Registry{
			Key:       `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
			ValueName: "OneDriveSync",
			Value:     `C:\Users\Public\payload.exe`,
			Operation: "SetValue",
		},
	}
	hits := e.Evaluate(ev)
	if len(hits) != 1 || hits[0].Rule.Name != "Persistencia en clave Run via registro" {
		t.Fatalf("expected the registry Run-key rule, got %+v", hits)
	}
}

func TestRealtimePackDetectsDefenderDisable(t *testing.T) {
	e := loadTestEngine(t)
	ev := &model.Event{
		ID: "test-defender", Timestamp: time.Now().UTC(),
		Type: model.TypeRegistrySet, Source: "sysmon", Host: "LAB-WKS-01",
		Registry: &model.Registry{
			Key:       `HKLM\SOFTWARE\Policies\Microsoft\Windows Defender`,
			ValueName: "DisableAntiSpyware",
			Value:     "DWORD (0x00000001)",
			Operation: "SetValue",
		},
	}
	hits := e.Evaluate(ev)
	if len(hits) != 1 || hits[0].Rule.Name != "Defensa antivirus desactivada via registro" {
		t.Fatalf("expected the Defender-disable rule, got %+v", hits)
	}
}

func TestRealtimePackDetectsStartupDrop(t *testing.T) {
	e := loadTestEngine(t)
	ev := &model.Event{
		ID: "test-startup", Timestamp: time.Now().UTC(),
		Type: model.TypeFileWrite, Source: "sysmon", Host: "LAB-WKS-01",
		Process: &model.Process{PID: 1000, Name: "dropper.exe"},
		File: &model.File{
			Path:      `C:\Users\jdoe\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\update.exe`,
			Extension: "exe",
		},
	}
	hits := e.Evaluate(ev)
	if len(hits) != 1 || hits[0].Rule.Name != "Ejecutable soltado en carpeta de inicio" {
		t.Fatalf("expected the startup-folder rule, got %+v", hits)
	}
}

func TestRealtimePackDetectsDoubleExtension(t *testing.T) {
	e := loadTestEngine(t)
	ev := &model.Event{
		ID: "test-doubleext", Timestamp: time.Now().UTC(),
		Type: model.TypeFileWrite, Source: "sysmon", Host: "LAB-WKS-01",
		Process: &model.Process{PID: 1000, Name: "browser.exe"},
		File: &model.File{
			Path:      `C:\Users\jdoe\Downloads\factura.pdf.exe`,
			Extension: "exe",
		},
	}
	hits := e.Evaluate(ev)
	if len(hits) != 1 || hits[0].Rule.Name != "Ejecutable disfrazado de documento" {
		t.Fatalf("expected the double-extension rule, got %+v", hits)
	}
}

func TestRealtimePackDetectsUserPathDLL(t *testing.T) {
	e := loadTestEngine(t)
	ev := &model.Event{
		ID: "test-dll", Timestamp: time.Now().UTC(),
		Type: model.TypeImageLoad, Source: "sysmon", Host: "LAB-WKS-01",
		Process: &model.Process{PID: 1234, Name: "app.exe"},
		File:    &model.File{Path: `C:\Users\jdoe\AppData\Local\Temp\hook.dll`},
	}
	hits := e.Evaluate(ev)
	if len(hits) != 1 || hits[0].Rule.Name != "DLL cargada desde ruta de usuario" {
		t.Fatalf("expected the user-path DLL rule, got %+v", hits)
	}
}

func TestRealtimePackDetectsLsassAccess(t *testing.T) {
	for _, access := range []string{"0x1010", "0x1FFFFF", "0x147a"} {
		e := loadTestEngine(t)
		ev := &model.Event{
			ID: "test-lsass", Timestamp: time.Now().UTC(),
			Type: model.TypeProcessAccess, Source: "sysmon", Host: "LAB-WKS-01",
			Process: &model.Process{PID: 700, Name: "dump.exe", Image: `C:\Users\Public\dump.exe`},
			Target:  &model.Process{PID: 744, Name: "lsass.exe", Image: `C:\Windows\system32\lsass.exe`},
			Access:  &model.ProcessAccess{GrantedAccess: access, CallTrace: "ntdll.dll+9d1a4"},
		}
		hits := e.Evaluate(ev)
		if len(hits) != 1 || hits[0].Rule.Name != "Acceso a memoria de LSASS" {
			t.Fatalf("access %s: expected the LSASS rule, got %+v", access, hits)
		}
	}
}

func TestRealtimePackDetectsDgaDomain(t *testing.T) {
	e := loadTestEngine(t)
	ev := &model.Event{
		ID: "test-dga", Timestamp: time.Now().UTC(),
		Type: model.TypeNetworkConnect, Source: "sysmon", Host: "LAB-WKS-01",
		Process: &model.Process{PID: 900, Name: "browser.exe"},
		Network: &model.Network{Protocol: "dns", Domain: "q7xv2k9p3m1w8zr4t5n6b0v2c8x4k9pa.example.com"},
	}
	hits := e.Evaluate(ev)
	if len(hits) != 1 || hits[0].Rule.Name != "Consulta DNS a dominio generado (posible DGA)" {
		t.Fatalf("expected the DGA rule, got %+v", hits)
	}
}

func TestRealtimeBenignRegistryAndFilesDoNotFire(t *testing.T) {
	e := loadTestEngine(t)
	cases := []*model.Event{
		{ // plain settings write, not autostart/defense
			ID: "b1", Timestamp: time.Now().UTC(),
			Type: model.TypeRegistrySet, Source: "sysmon", Host: "H",
			Registry: &model.Registry{
				Key:       `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced`,
				ValueName: "HideFileExt", Operation: "SetValue",
			},
		},
		{ // system32 DLL load is fine
			ID: "b2", Timestamp: time.Now().UTC(),
			Type: model.TypeImageLoad, Source: "sysmon", Host: "H",
			File: &model.File{Path: `C:\Windows\System32\version.dll`},
		},
		{ // txt drop in Documents is fine
			ID: "b3", Timestamp: time.Now().UTC(),
			Type: model.TypeFileWrite, Source: "sysmon", Host: "H",
			File: &model.File{Path: `C:\Users\jdoe\Documents\notes.txt`, Extension: "txt"},
		},
		{ // defender policy tree, but a different value name
			ID: "b4", Timestamp: time.Now().UTC(),
			Type: model.TypeRegistrySet, Source: "sysmon", Host: "H",
			Registry: &model.Registry{
				Key:       `HKLM\SOFTWARE\Policies\Microsoft\Windows Defender`,
				ValueName: "SpynetReporting", Operation: "SetValue",
			},
		},
		{ // low-privilege handle on LSASS (query info only) is fine
			ID: "b5", Timestamp: time.Now().UTC(),
			Type: model.TypeProcessAccess, Source: "sysmon", Host: "H",
			Process: &model.Process{PID: 700, Name: "svchost.exe"},
			Target:  &model.Process{PID: 744, Name: "lsass.exe"},
			Access:  &model.ProcessAccess{GrantedAccess: "0x1000"},
		},
		{ // ordinary domains never trip the DGA heuristic
			ID: "b6", Timestamp: time.Now().UTC(),
			Type: model.TypeNetworkConnect, Source: "sysmon", Host: "H",
			Network: &model.Network{Protocol: "dns", Domain: "www.google.com"},
		},
	}
	for _, ev := range cases {
		if hits := e.Evaluate(ev); len(hits) != 0 {
			t.Errorf("benign %s event fired %d rule(s): %v", ev.Type, len(hits), hits[0].Rule.Name)
		}
	}
}

func TestOperators(t *testing.T) {
	cases := []struct {
		op    string
		val   any
		given any
		want  bool
	}{
		{"eq", "powershell.exe", "powershell.exe", true},
		{"eq", "a", "b", false},
		{"neq", "a", "b", true},
		{"contains", "hidden", "-w hidden -enc", true},
		{"contains_any", []any{"-enc", "-w hidden"}, "powershell -enc x", true},
		{"contains_any", []any{"foo", "bar"}, "powershell -enc x", false},
		{"startswith", "rundll32", "rundll32.exe", true},
		{"endswith", ".exe", "rundll32.exe", true},
		{"in", []any{"certutil.exe", "bitsadmin.exe"}, "bitsadmin.exe", true},
		{"not_in", []any{"a", "b"}, "c", true},
		{"gt", 443, float64(8080), true},
		{"lt", 443, float64(80), true},
		{"regex", `(?i)minid?ump`, "run MiniDump 744", true},
		{"ieq", "mimikatz", "MIMIKATZ", true},
		{"ieq", "Invoke-Mimikatz", "invoke-mimikatz", true}, // igualdad fold, no subcadena
		{"ieq", "mimikatz", "Invoke-Mimikatz", false},       // ieq es igualdad, no subcadena
		{"icontains", "mimikatz", "Invoke-Mimikatz -DumpCreds", true},
		{"icontains_any", []any{"-enc", "mimikatz"}, "powershell Invoke-MIMIKATZ", true},
		{"istartswith", "rundll32", "RUNDLL32.exe", true},
		{"iendswith", ".exe", "RUNDLL32.EXE", true},
		{"iin", []any{"certutil.exe", "bitsadmin.exe"}, "BITSADMIN.EXE", true},
	}
	// F2 (adenda 11h02): la tabla pasa por el Matcher — el unico
	// camino de evaluacion que existe desde el refactor.
	for i, tc := range cases {
		c := Condition{Field: "f", Operator: tc.op, Value: tc.val}
		m, err := NewMatcher([]Condition{c})
		if err != nil {
			t.Fatalf("case %d: %v", i, err)
		}
		if got := m.MatchFields(map[string]any{"f": tc.given}); got != tc.want {
			t.Errorf("case %d: operator %s(%v, %v) = %v, want %v",
				i, tc.op, tc.given, tc.val, got, tc.want)
		}
	}
}

// --- Matcher export (A2 condition Q4: immutable, thread-safe, same
// operator semantics as the engine) ---

func TestMatcherMatchesLikeEngine(t *testing.T) {
	conds := []Condition{
		{Field: "process.name", Operator: "eq", Value: "powershell.exe"},
		{Field: "process.command_line", Operator: "contains_any", Value: []any{"-enc", "-w hidden"}},
	}
	m, err := NewMatcher(conds)
	if err != nil {
		t.Fatal(err)
	}
	rule := Rule{Name: "x", ID: "x", Severity: SevHigh, EventType: "process.create", Conditions: conds}
	engine, err := LoadDir(writeRuleDir(t, []Rule{rule}))
	if err != nil {
		t.Fatal(err)
	}
	evs := []*model.Event{
		{ID: "1", Type: "process.create", Process: &model.Process{Name: "powershell.exe", CommandLine: "powershell -enc AAA"}},
		{ID: "2", Type: "process.create", Process: &model.Process{Name: "powershell.exe", CommandLine: "powershell -w hidden"}},
		{ID: "3", Type: "process.create", Process: &model.Process{Name: "powershell.exe", CommandLine: "Get-Date"}},
		{ID: "4", Type: "process.create", Process: &model.Process{Name: "cmd.exe", CommandLine: "cmd -enc"}},
	}
	for _, ev := range evs {
		want := len(engine.Evaluate(ev)) > 0
		if got := m.Match(ev); got != want {
			t.Errorf("evento %s: matcher=%v engine=%v", ev.ID, got, want)
		}
	}
}

func TestMatcherEmptyMatchesAllAndNilSafe(t *testing.T) {
	m, err := NewMatcher(nil)
	if err != nil {
		t.Fatal(err)
	}
	if !m.Match(&model.Event{ID: "1", Type: "registry.set"}) {
		t.Error("matcher vacio debe igualar todo")
	}
	var nilM *Matcher
	if nilM.Match(&model.Event{ID: "1"}) {
		t.Error("matcher nil debe ser false")
	}
	if m.Match(nil) {
		t.Error("evento nil debe ser false")
	}
}

func TestMatcherRejectsBadRegexAndMissingFields(t *testing.T) {
	if _, err := NewMatcher([]Condition{{Field: "a.b", Operator: "regex", Value: "(["}}); err == nil {
		t.Error("regex invalida aceptada")
	}
	if _, err := NewMatcher([]Condition{{Field: "", Operator: "eq"}}); err == nil {
		t.Error("campo vacio aceptado")
	}
	if _, err := NewMatcher([]Condition{{Field: "a", Operator: "no_existe", Value: 1}}); err == nil {
		t.Error("operador desconocido aceptado: el matcher y el engine deben rechazarlo en construccion (F2, misma regla que compile)")
	}
}

// writeRuleDir serializes rules into a temp dir for engine parity checks.
func writeRuleDir(t *testing.T, rs []Rule) string {
	t.Helper()
	dir := t.TempDir()
	data, err := yaml.Marshal(rs)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "r.yaml"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// F2 (adenda 11h02): copia defensiva de values slice — mutar el slice
// del caller tras construir el Matcher no cambia lo que evalua.
func TestMatcherDefensiveCopyOfSliceValues(t *testing.T) {
	vals := []any{"-enc", "-w hidden"}
	m, err := NewMatcher([]Condition{{Field: "process.command_line", Operator: "contains_any", Value: vals}})
	if err != nil {
		t.Fatal(err)
	}
	vals[0] = "-INOCUO" // mutacion hostil post-construccion
	// MatchFields consume el mapa ANIDADO que produce FieldMap()
	nested := func(cmdline string) map[string]any {
		return map[string]any{"process": map[string]any{"command_line": cmdline}}
	}
	// el matcher conserva el valor ORIGINAL "-enc" (la copia es del
	// momento de construccion), por lo que sigue disparando con el
	// comando que lo contiene
	if !m.MatchFields(nested("powershell -enc AAA")) {
		t.Error("el matcher perdio el valor original -enc")
	}
	// la mutacion del slice del caller NO altera al matcher: el valor
	// "-INOCUO" jamas existio dentro del matcher
	if m.MatchFields(nested("powershell -INOCUO AAA")) {
		t.Error("la mutacion externa del slice cambio la semantica del matcher")
	}
}

// Un operador que el engine no evalúa debe RECHAZARSE en carga:
// evalCondition responde false por defecto, así que aceptarlo sería
// cargar una regla muda (ronda 04 sobre da6382c).
func TestCompileRejectsUnknownOperator(t *testing.T) {
	r := &Rule{
		Name:       "regla con operador desconocido",
		EventType:  "process.create",
		Severity:   SevHigh,
		Conditions: []Condition{{Field: "f", Operator: "regexi", Value: "x"}},
	}
	if _, err := compile(r); err == nil {
		t.Fatal("compile aceptó un operador desconocido: la regla cargaría muda")
	}
	// los operadores i* son parte del set cerrado
	r.Conditions[0].Operator = "icontains"
	if _, err := compile(r); err != nil {
		t.Fatalf("compile rechazó icontains: %v", err)
	}
}
