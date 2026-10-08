package sigma

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// writeCorpuses writes the given name->content files under a fresh
// temp dir and returns the dir.
func writeCorpus(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, content := range files {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

const sigmaBasic = `
title: PowerShell con comando codificado
id: 9f31c2a4-5d7b-4e18-8a02-3b9c6d1e7f40
status: stable
description: Detecta PowerShell con -enc.
author: laboratorio
date: 2026/09/30
logsource:
    product: windows
    category: process_creation
detection:
    SEL_CMD:
        CommandLine|contains: '-enc'
    SEL_IMG:
        Image|endswith: '\powershell.exe'
    condition: SEL_CMD and SEL_IMG
falsepositives:
    - Scripts de administracion legitimos
level: high
tags:
    - attack.execution
    - attack.t1059.001
`

func TestConvertBasicRule(t *testing.T) {
	dir := writeCorpus(t, map[string]string{"basic.yml": sigmaBasic})
	res, err := ConvertDir(dir)
	if err != nil {
		t.Fatalf("ConvertDir: %v", err)
	}
	if res.Files != 1 {
		t.Fatalf("Files = %d, want 1", res.Files)
	}
	if len(res.Skipped) != 0 {
		t.Fatalf("skips inesperados: %+v", res.Skipped)
	}
	if len(res.Converted) != 1 {
		t.Fatalf("Converted = %d, want 1", len(res.Converted))
	}
	r := res.Converted[0]
	if r.Name != "PowerShell con comando codificado" || r.ID != "9f31c2a4-5d7b-4e18-8a02-3b9c6d1e7f40" {
		t.Errorf("identidad mal: %q / %q", r.Name, r.ID)
	}
	if r.Severity != "high" || r.EventType != "process.create" {
		t.Errorf("severidad/tipo mal: %q / %q", r.Severity, r.EventType)
	}
	if len(r.Conditions) != 2 {
		t.Fatalf("Conditions = %d, want 2", len(r.Conditions))
	}
	if r.Conditions[0].Field != "process.command_line" || r.Conditions[0].Operator != "icontains" || r.Conditions[0].Value != "-enc" {
		t.Errorf("cond 0 mal: %+v", r.Conditions[0])
	}
	if r.Conditions[1].Field != "process.image" || r.Conditions[1].Operator != "iendswith" || r.Conditions[1].Value != `\powershell.exe` {
		t.Errorf("cond 1 mal: %+v", r.Conditions[1])
	}
	if len(r.Tags) != 3 || r.Tags[0] != "sigma" || r.Tags[2] != "attack.t1059.001" {
		t.Errorf("tags mal: %v", r.Tags)
	}
	if !strings.Contains(r.Description, "[Sigma] autor: laboratorio") ||
		!strings.Contains(r.Description, "falsos positivos declarados: Scripts de administracion legitimos") {
		t.Errorf("procedencia mal en description: %q", r.Description)
	}
	if !r.Enabled || len(r.Actions) != 1 || r.Actions[0].Type != "alert" || r.Actions[0].Config["message"] == "" {
		t.Errorf("acciones/enabled mal: %+v", r)
	}
}

func TestConvertWildcardTable(t *testing.T) {
	cases := []struct {
		in      string
		wantOp  string
		wantVal any
	}{
		{"cmd.exe", "ieq", "cmd.exe"},
		{"*-enc*", "icontains", "-enc"},
		{"cmd*", "istartswith", "cmd"},
		{"*cmd.exe", "iendswith", "cmd.exe"},
		{"8443", "eq", "8443"}, // sin letras: conserva el fast path exacto
		{`C:\Windows\*\cmd.exe`, "regex", `(?i)^C:\\Windows\\.*\\cmd\.exe$`},
		{"cmd?.exe", "regex", `(?i)^cmd.\.exe$`}, // ? -> . (comodín), el . literal va escapado
	}
	for _, c := range cases {
		op, val, err := translateString(c.in, "")
		if err != nil {
			t.Fatalf("%q: %v", c.in, err)
		}
		if op != c.wantOp || val != c.wantVal {
			t.Errorf("%q -> %s %v, want %s %v", c.in, op, val, c.wantOp, c.wantVal)
		}
	}
}

func TestConvertListTranslation(t *testing.T) {
	// eq list -> in
	op, val, err := translateString([]any{"a.exe", "b.exe"}, "")
	if err != nil || op != "iin" {
		t.Fatalf("eq list: %s %v %v", op, val, err)
	}
	// contains list -> contains_any
	op, val, err = translateString([]any{"-enc", "-w hidden"}, "contains")
	if err != nil || op != "icontains_any" {
		t.Fatalf("contains list: %s %v %v", op, val, err)
	}
	// mixed wildcard contains -> alternation, each element unanchored
	op, val, err = translateString([]any{"-enc", "*-w hidden*"}, "contains")
	if err != nil || op != "regex" {
		t.Fatalf("contains mixta: %s %v %v", op, val, err)
	}
	if val != "(?i)(?:-enc|(?i).*-w hidden.*)" {
		// elemento literal + elemento con comodines, ambos bajo la alternación (?i)
		t.Errorf("alternation contains mixta = %v", val)
	}
	// startswith list -> alternation with per-element anchors
	op, val, err = translateString([]any{"rundll", "regsvr"}, "startswith")
	if err != nil || op != "regex" {
		t.Fatalf("startswith list: %s %v %v", op, val, err)
	}
	if val != "(?i)(?:^rundll.*|^regsvr.*)" {
		t.Errorf("alternation startswith = %v", val)
	}
	// empty list rejected
	if _, _, err := translateString([]any{}, ""); err == nil {
		t.Error("lista vacia aceptada")
	}
}

func TestParseConditionGrammar(t *testing.T) {
	sels := map[string][]fieldValue{
		"A": nil, "B": nil, "C": nil, "sel_1": nil, "sel_2": nil,
	}
	ok := []struct {
		expr string
		kind condKind
		n    int
	}{
		{"A", condSingle, 1},
		{"A and B and C", condAnd, 3},
		{"A or B", condOr, 2},
		{"1 of them", condOr, 5},
		{"all of them", condAnd, 5},
		{"1 of sel_*", condOr, 2},
		{"all of sel_1,sel_2", condAnd, 2},
		// repeated names are redundant but legal: one plan entry per
		// UNIQUE selection, or the OR-split fires the alert twice
		{"A and A", condAnd, 1},
		{"A or A or B", condOr, 2},
		{"1 of A,A", condOr, 1},
		{"all of A,B,A", condAnd, 2},
	}
	for _, c := range ok {
		plan, err := parseCondition(c.expr, sels)
		if err != nil {
			t.Fatalf("%q: %v", c.expr, err)
		}
		if plan.kind != c.kind || len(plan.selections) != c.n {
			t.Errorf("%q -> kind %d n %d, want kind %d n %d", c.expr, plan.kind, len(plan.selections), c.kind, c.n)
		}
	}
	bad := []string{
		"",
		"A and (B or C)",
		"not A",
		"A and B or C",
		"A or NOPE",
		"1 of nowhen*",
		"all of themx",
		"A xor B",
	}
	for _, expr := range bad {
		if _, err := parseCondition(expr, sels); err == nil {
			t.Errorf("condition %q aceptada, debia rechazarse", expr)
		}
	}
}

func TestConvertSkipsWithReasons(t *testing.T) {
	cases := map[string]string{
		"deprecated.yml": `
title: vieja
id: 11111111-1111-1111-1111-111111111111
status: deprecated
logsource: {product: windows, category: process_creation}
detection: {SEL: {CommandLine: x}, condition: SEL}
level: low
`,
		"nolevel.yml": `
title: sin nivel
id: 22222222-2222-2222-2222-222222222222
logsource: {product: windows, category: process_creation}
detection: {SEL: {CommandLine: x}, condition: SEL}
`,
		"linux.yml": `
title: linux
id: 33333333-3333-3333-3333-333333333333
logsource: {product: linux, category: process_creation}
detection: {SEL: {CommandLine: x}, condition: SEL}
level: low
`,
		"campo.yml": `
title: campo sin mapa
id: 44444444-4444-4444-4444-444444444444
logsource: {product: windows, category: process_creation}
detection: {SEL: {ParentImage: 'x*'}, condition: SEL}
level: low
`,
		"modificador.yml": `
title: base64
id: 55555555-5555-5555-5555-555555555555
logsource: {product: windows, category: process_creation}
detection: {SEL: {CommandLine|base64offset|contains: whoami}, condition: SEL}
level: low
`,
		"keyword.yml": `
title: keyword
id: 66666666-6666-6666-6666-666666666666
logsource: {product: windows, category: process_creation}
detection: {SEL: ['*mimikatz*', 'lsass'], condition: SEL}
level: low
`,
		"servicio.yml": `
title: por servicio
id: 77777777-7777-7777-7777-777777777777
logsource: {product: windows, service: security}
detection: {SEL: {CommandLine: x}, condition: SEL}
level: low
`,
		"duplicado.yml": `
title: duplicado
id: 9f31c2a4-5d7b-4e18-8a02-3b9c6d1e7f40
logsource: {product: windows, category: process_creation}
detection: {SEL: {CommandLine: x}, condition: SEL}
level: low
`,
		"condicion.yml": `
title: condicion loca
id: 88888888-8888-8888-8888-888888888888
logsource: {product: windows, category: process_creation}
detection: {SEL: {CommandLine: x}, condition: 1 of SEL* and not filter}
level: low
`,
	}
	// duplicado.yml convive con basic.yml para probar el id repetido
	dir := writeCorpus(t, mergeMaps(map[string]string{"basic.yml": sigmaBasic}, cases))
	res, err := ConvertDir(dir)
	if err != nil {
		t.Fatalf("ConvertDir: %v", err)
	}
	if len(res.Converted) != 1 {
		t.Fatalf("Converted = %d, want 1 (solo basic)", len(res.Converted))
	}
	if len(res.Skipped) != len(cases) {
		t.Fatalf("Skipped = %d, want %d: %+v", len(res.Skipped), len(cases), res.Skipped)
	}
	for _, s := range res.Skipped {
		if s.Reason == "" {
			t.Errorf("skip sin razon: %+v", s)
		}
	}
}

func TestConvertORMergeSameField(t *testing.T) {
	src := `
title: Or mismo campo
id: aaaaaaaa-1111-1111-1111-111111111111
logsource: {product: windows, category: process_creation}
detection:
    S1: {CommandLine|contains: 'mimikatz'}
    S2: {CommandLine|contains: 'secretsdump'}
    condition: 1 of them
level: high
`
	dir := writeCorpus(t, map[string]string{"or.yml": src})
	res, err := ConvertDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Converted) != 1 || len(res.Skipped) != 0 {
		t.Fatalf("converted=%d skipped=%d", len(res.Converted), len(res.Skipped))
	}
	conds := res.Converted[0].Conditions
	if len(conds) != 1 || conds[0].Operator != "icontains_any" {
		t.Fatalf("merge OR fallo: %+v", conds)
	}
	vals, ok := conds[0].Value.([]any)
	if !ok || len(vals) != 2 || vals[0] != "mimikatz" || vals[1] != "secretsdump" {
		t.Fatalf("valores del merge mal: %+v", conds[0].Value)
	}
}

func TestConvertORSplitDifferentFields(t *testing.T) {
	src := `
title: Or campos distintos
id: aaaaaaaa-2222-2222-2222-222222222222
logsource: {product: windows, category: process_creation}
detection:
    S1: {Image|endswith: 'whoami.exe'}
    S2: {CommandLine|contains: '/grant'}
    condition: S1 or S2
level: medium
`
	dir := writeCorpus(t, map[string]string{"or.yml": src})
	res, err := ConvertDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Converted) != 2 {
		t.Fatalf("converted=%d, want 2: %+v", len(res.Converted), res)
	}
	if res.Converted[0].Name != "Or campos distintos (or 1/2)" ||
		res.Converted[1].Name != "Or campos distintos (or 2/2)" {
		t.Errorf("nombres de la division mal: %q / %q",
			res.Converted[0].Name, res.Converted[1].Name)
	}
	// ids ÚNICOS por rama (sesión 100agentes-2, P0 agentes 18+31):
	// antes ambas ramas llevaban el mismo id Sigma y el loader del
	// motor rechazaba el fichero emitido por "duplicate rule id"
	// (log.Fatalf en el arranque). Ahora cada rama lleva -orN.
	if res.Converted[0].ID == res.Converted[1].ID {
		t.Error("la division OR debe emitir ids UNICOS por rama")
	}
	if res.Converted[0].ID != "aaaaaaaa-2222-2222-2222-222222222222-or1" ||
		res.Converted[1].ID != "aaaaaaaa-2222-2222-2222-222222222222-or2" {
		t.Errorf("sufijos de id mal: %q / %q", res.Converted[0].ID, res.Converted[1].ID)
	}
}

// TestConvertORSplitEmitLoadsAndFiresBranch2 (sesión 100agentes-2,
// agente 31, P0): el flujo COMPLETO de la división OR — convertir,
// emitir, cargar en el motor y disparar SOLO la rama 2 — no tenía
// ningún test y el camino estaba roto de extremo a extremo (ids
// duplicados → log.Fatalf en la carga).
func TestConvertORSplitEmitLoadsAndFiresBranch2(t *testing.T) {
	dir := writeCorpus(t, map[string]string{"or.yml": `
title: Or campos distintos
id: aaaaaaaa-2222-2222-2222-222222222222
logsource: {product: windows, category: process_creation}
detection:
    S1: {Image|endswith: 'whoami.exe'}
    S2: {CommandLine|contains: '/grant'}
    condition: S1 or S2
level: medium
`})
	res, err := ConvertDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Converted) != 2 || len(res.Skipped) != 0 {
		t.Fatalf("converted=%d skipped=%d, want 2/0", len(res.Converted), len(res.Skipped))
	}
	data, err := res.Emit()
	if err != nil {
		t.Fatal(err)
	}
	out := t.TempDir()
	if err := os.WriteFile(filepath.Join(out, "converted.yaml"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	engine, err := rules.LoadDir(out)
	if err != nil {
		t.Fatalf("el YAML emitido con la division OR no carga en el motor: %v", err)
	}
	if engine.Count() != 2 {
		t.Fatalf("engine.Count() = %d, want 2", engine.Count())
	}
	// Un evento que matchea SOLO la rama 2 (CommandLine) dispara
	// exactamente una alerta, con el id de la rama 2.
	ev := &model.Event{
		ID:   "or-split-branch2",
		Type: "process.create",
		Host: "LAB",
		Process: &model.Process{
			Name:        "icacls.exe",
			Image:       `C:\Windows\System32\icacls.exe`,
			CommandLine: `icacls.exe C:\Users /grant everyone:F`,
		},
	}
	hits := engine.Evaluate(ev)
	if len(hits) != 1 {
		t.Fatalf("la rama 2 del OR no disparo: hits=%d", len(hits))
	}
	if got := hits[0].Rule.ID; got != "aaaaaaaa-2222-2222-2222-222222222222-or2" {
		t.Errorf("id que disparo: %q, want ...-or2", got)
	}
	// Un evento inocente no dispara ninguna rama.
	ev.Process.CommandLine = "icacls.exe C:\\Users /list"
	if hits := engine.Evaluate(ev); len(hits) != 0 {
		t.Fatalf("falso positivo del evento inocente: hits=%d", len(hits))
	}
}

// Un valor solo-wildcard ('*') se rechaza con motivo en vez de emitir
// startswith "" (que matcheaba TODO, incluso campos ausentes) —
// sesión 100agentes-2, agente 18, P1.
func TestSigmaWildcardOnlyRejected(t *testing.T) {
	dir := writeCorpus(t, map[string]string{"w.yml": `
title: Comodin solitario
id: aaaaaaaa-4444-4444-4444-444444444444
logsource: {product: windows, category: process_creation}
detection:
    SEL: {User: '*'}
    condition: SEL
level: low
`})
	res, err := ConvertDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Converted) != 0 || len(res.Skipped) != 1 {
		t.Fatalf("converted=%d skipped=%d, want 0/1", len(res.Converted), len(res.Skipped))
	}
	if !strings.Contains(res.Skipped[0].Reason, "solo-wildcard") {
		t.Errorf("motivo del skip inesperado: %q", res.Skipped[0].Reason)
	}
}

// La forma lista de condition ([S1, S2]) antes abortaba TODA la
// conversion; ahora convierte cada elemento como un OR — sesión
// 100agentes-2, agente 18, P2.
func TestSigmaConditionListForm(t *testing.T) {
	dir := writeCorpus(t, map[string]string{"list.yml": `
title: Lista de condiciones
id: aaaaaaaa-5555-5555-5555-555555555555
logsource: {product: windows, category: process_creation}
detection:
    S1: {Image|endswith: 'whoami.exe'}
    S2: {Image|endswith: 'net.exe'}
    condition: [S1, S2]
level: low
`})
	res, err := ConvertDir(dir)
	if err != nil {
		t.Fatalf("la forma lista de condition debe convertir sin abortar: %v", err)
	}
	if len(res.Converted) != 2 || len(res.Skipped) != 0 {
		t.Fatalf("converted=%d skipped=%d, want 2/0", len(res.Converted), len(res.Skipped))
	}
	// ids únicos con sufijo -cN (cada elemento es una regla).
	if res.Converted[0].ID == res.Converted[1].ID {
		t.Error("las condiciones de la lista deben emitir ids unicos")
	}
	if !strings.Contains(res.Converted[0].Name, "(cond 1/2)") ||
		!strings.Contains(res.Converted[1].Name, "(cond 2/2)") {
		t.Errorf("nombres con sufijo cond ausentes: %q / %q",
			res.Converted[0].Name, res.Converted[1].Name)
	}
}

// Un fichero Sigma multi-documento convertia solo el documento 1 y
// descartaba el resto en silencio — sesión 100agentes-2, agente 18, P3.
func TestSigmaMultiDoc(t *testing.T) {
	dir := writeCorpus(t, map[string]string{"multi.yml": `
title: Doc uno
id: aaaaaaaa-6666-6666-6666-666666666666
logsource: {product: windows, category: process_creation}
detection:
    SEL: {Image|endswith: 'whoami.exe'}
    condition: SEL
level: low
---
title: Doc dos
id: aaaaaaaa-7777-7777-7777-777777777777
logsource: {product: windows, category: process_creation}
detection:
    SEL: {Image|endswith: 'net.exe'}
    condition: SEL
level: low
`})
	res, err := ConvertDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Converted) != 2 {
		t.Fatalf("converted=%d, want 2 (los dos documentos)", len(res.Converted))
	}
}

func TestEmitRoundTripLoadsAndFires(t *testing.T) {
	dir := writeCorpus(t, map[string]string{"basic.yml": sigmaBasic})
	res, err := ConvertDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	data, err := res.Emit()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(data), "# Generado por 'engine sigma'") {
		t.Errorf("cabecera del emit ausente")
	}
	out := t.TempDir()
	if err := os.WriteFile(filepath.Join(out, "converted.yaml"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	engine, err := rules.LoadDir(out)
	if err != nil {
		t.Fatalf("el YAML emitido no carga en el motor: %v", err)
	}
	if engine.Count() != 1 {
		t.Fatalf("engine.Count() = %d, want 1", engine.Count())
	}
	// El evento de laboratorio debe disparar la regla convertida.
	ev := &model.Event{
		ID:   "e2e-sigma-1",
		Type: "process.create",
		Host: "LAB",
		Process: &model.Process{
			Name:        "powershell.exe",
			Image:       `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
			CommandLine: "powershell.exe -nop -w hidden -enc SQBFAFgA",
		},
	}
	hits := engine.Evaluate(ev)
	if len(hits) != 1 {
		t.Fatalf("la regla convertida no disparo: hits=%d", len(hits))
	}
	if got := hits[0].Rule.ID; got != "9f31c2a4-5d7b-4e18-8a02-3b9c6d1e7f40" {
		t.Errorf("id de la regla que disparo: %q", got)
	}
	// Y un evento inocente no debe dispararla.
	ev.Process.CommandLine = "powershell.exe -Command Get-Date"
	if hits := engine.Evaluate(ev); len(hits) != 0 {
		t.Fatalf("falso positivo del evento inocente: hits=%d", len(hits))
	}
}

func TestConvertDeterministicOutput(t *testing.T) {
	files := map[string]string{
		"b.yml": sigmaBasic,
		"c.yml": `
title: Registry run key
id: bbbbbbbb-2222-2222-2222-222222222222
logsource: {product: windows, category: registry_add}
detection:
    SEL: {TargetObject|startswith: 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run'}
    condition: SEL
level: medium
`,
		"a.yml": `
title: Red sospechosa
id: cccccccc-3333-3333-3333-333333333333
logsource: {product: windows, category: network_connection}
detection:
    SEL: {DestinationIp: '203.0.113.66'}
    condition: SEL
level: high
`,
	}
	dir := writeCorpus(t, files)
	r1, err := ConvertDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	r2, err := ConvertDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	d1, err := r1.Emit()
	if err != nil {
		t.Fatal(err)
	}
	d2, err := r2.Emit()
	if err != nil {
		t.Fatal(err)
	}
	if string(d1) != string(d2) {
		t.Error("la salida no es determinista")
	}
	if len(r1.Converted) != 3 {
		t.Fatalf("converted=%d, want 3", len(r1.Converted))
	}
	// las 3 categorias mapean a los 3 tipos de evento correctos
	want := map[string]string{
		"cccccccc-3333-3333-3333-333333333333": "network.connect",
		"9f31c2a4-5d7b-4e18-8a02-3b9c6d1e7f40": "process.create",
		"bbbbbbbb-2222-2222-2222-222222222222": "registry.set",
	}
	for _, r := range r1.Converted {
		if want[r.ID] != r.EventType {
			t.Errorf("regla %s: event_type=%s, want %s", r.ID, r.EventType, want[r.ID])
		}
	}
}

func TestConvertBrokenFileIsHardError(t *testing.T) {
	dir := writeCorpus(t, map[string]string{
		"roto.yml": "title: [esto no es yaml valido\n  - {",
	})
	if _, err := ConvertDir(dir); err == nil {
		t.Fatal("YAML invalido aceptado como camino feliz")
	}
}

func TestConvertOversizedFileIsHardError(t *testing.T) {
	big := make([]byte, MaxFileSize+1)
	for i := range big {
		big[i] = 'x'
	}
	dir := writeCorpus(t, map[string]string{"grande.yml": string(big)})
	_, err := ConvertDir(dir)
	if err == nil || !strings.Contains(err.Error(), "mayor de") {
		t.Fatalf("fichero sobredimensionado no rechazado: %v", err)
	}
}

func TestConvertMaxRulesOut(t *testing.T) {
	files := map[string]string{}
	for i := 0; i < MaxRulesOut+5; i++ {
		files[fmt.Sprintf("r%03d.yml", i)] = fmt.Sprintf(`
title: regla %d
id: 00000000-0000-0000-0000-%012d
logsource: {product: windows, category: process_creation}
detection: {SEL: {CommandLine: 'unica-%d'}, condition: SEL}
level: low
`, i, i, i)
	}
	dir := writeCorpus(t, files)
	res, err := ConvertDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Converted) != MaxRulesOut {
		t.Fatalf("converted=%d, want tope %d", len(res.Converted), MaxRulesOut)
	}
	if len(res.Skipped) != 5 {
		t.Fatalf("skipped=%d, want 5", len(res.Skipped))
	}
}

func TestConvertModifiersGtLtAndRe(t *testing.T) {
	src := `
title: Puertos y regex
id: dddddddd-4444-4444-4444-444444444444
logsource: {product: windows, category: network_connection}
detection:
    SEL: {DestinationPort|gt: 8000}
    condition: SEL
level: low
`
	dir := writeCorpus(t, map[string]string{"gt.yml": src})
	res, err := ConvertDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Converted) != 1 {
		t.Fatalf("converted=%d: %+v", len(res.Converted), res.Skipped)
	}
	c := res.Converted[0].Conditions[0]
	if c.Operator != "gt" || c.Value != "8000" {
		t.Errorf("gt mal traducido: %+v", c)
	}

	srcRe := strings.Replace(src, "DestinationPort|gt: 8000", "CommandLine|re: '.*mimikatz.*'", 1)
	srcRe = strings.Replace(srcRe, "network_connection", "process_creation", 1)
	dir = writeCorpus(t, map[string]string{"re.yml": srcRe})
	res, err = ConvertDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Converted) != 1 || res.Converted[0].Conditions[0].Operator != "regex" {
		t.Fatalf("re mal traducido: %+v", res)
	}

	// regex que Go no compila -> skip con razon
	srcBad := strings.Replace(srcRe, ".*mimikatz.*", "mimi(?katz", 1)
	dir = writeCorpus(t, map[string]string{"rebad.yml": srcBad})
	res, err = ConvertDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Converted) != 0 || len(res.Skipped) != 1 {
		t.Fatalf("regex invalida aceptada: %+v", res)
	}
	if !strings.Contains(res.Skipped[0].Reason, "regex invalida") {
		t.Errorf("razon de regex invalida poco clara: %q", res.Skipped[0].Reason)
	}
}

func TestEmitEmptyResult(t *testing.T) {
	res := &Result{}
	data, err := res.Emit()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(string(data), "[]\n") || !strings.Contains(string(data), "0 reglas convertidas") {
		t.Errorf("emit vacio inesperado: %q", data)
	}
}

// mergeMaps fusiona dos mapas de ficheros para el corpus de skips.
func mergeMaps(a, b map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

// F1 (over da6382c): el corpus Sigma asume matching
// case-insensitive (escribe mimikatz y espera que Invoke-Mimikatz
// dispare). Los valores con letras se emiten con la familia i*; los
// puramente numéricos conservan el fast path exacto; los patrones
// wildcard bajan como regex (?i) que compila y plega case.
func TestConvertCaseInsensitiveSemantics(t *testing.T) {
	op, val, err := translateString("mimikatz", "")
	if err != nil || op != "ieq" || val != "mimikatz" {
		t.Fatalf("eq con letras: %s %v %v", op, val, err)
	}
	op, val, err = translateString("*mimikatz*", "")
	if err != nil || op != "icontains" || val != "mimikatz" {
		t.Fatalf("wildcard con letras: %s %v %v", op, val, err)
	}
	op, val, err = translateString("8443", "")
	if err != nil || op != "eq" {
		t.Fatalf("sin letras debe conservar el fast path: %s %v %v", op, val, err)
	}
	op, val, err = translateString("Mimi*Katz", "")
	if err != nil || op != "regex" {
		t.Fatalf("patrón mixto: %s %v %v", op, val, err)
	}
	re, err := regexp.Compile(val.(string))
	if err != nil {
		t.Fatalf("patrón emitido no compila: %v", err)
	}
	if !re.MatchString("mImIzKatz") {
		t.Errorf("el patrón case-insensitive no plega case: %q", val)
	}
	if re.MatchString("mimikatzX") {
		t.Errorf("el patrón ancla mal: %q", val)
	}
}
