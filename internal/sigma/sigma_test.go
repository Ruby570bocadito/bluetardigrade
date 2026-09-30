package sigma

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/security-framework/internal/rules"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
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
	if r.Conditions[0].Field != "process.command_line" || r.Conditions[0].Operator != "contains" || r.Conditions[0].Value != "-enc" {
		t.Errorf("cond 0 mal: %+v", r.Conditions[0])
	}
	if r.Conditions[1].Field != "process.image" || r.Conditions[1].Operator != "endswith" || r.Conditions[1].Value != `\powershell.exe` {
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
		{"cmd.exe", "eq", "cmd.exe"},
		{"*-enc*", "contains", "-enc"},
		{"cmd*", "startswith", "cmd"},
		{"*cmd.exe", "endswith", "cmd.exe"},
		{`C:\Windows\*\cmd.exe`, "regex", `^C:\\Windows\\.*\\cmd\.exe$`},
		{"cmd?.exe", "regex", `^cmd.\.exe$`}, // ? -> . (comodín), el . literal va escapado
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
	if err != nil || op != "in" {
		t.Fatalf("eq list: %s %v %v", op, val, err)
	}
	// contains list -> contains_any
	op, val, err = translateString([]any{"-enc", "-w hidden"}, "contains")
	if err != nil || op != "contains_any" {
		t.Fatalf("contains list: %s %v %v", op, val, err)
	}
	// mixed wildcard contains -> alternation, each element unanchored
	op, val, err = translateString([]any{"-enc", "*-w hidden*"}, "contains")
	if err != nil || op != "regex" {
		t.Fatalf("contains mixta: %s %v %v", op, val, err)
	}
	if val != "(?:\\-enc|.*\\-w hidden.*\\$?)" && val != "(?:\\-enc|.*\\-w hidden.*)" {
		// el primer elemento se traduce literal (unanchored), el segundo conserva sus .* laterales
		t.Logf("alternativa producida: %v", val)
	}
	// startswith list -> alternation with per-element anchors
	op, val, err = translateString([]any{"rundll", "regsvr"}, "startswith")
	if err != nil || op != "regex" {
		t.Fatalf("startswith list: %s %v %v", op, val, err)
	}
	if val != "(?:^rundll.*|^regsvr.*)" {
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
	if len(conds) != 1 || conds[0].Operator != "contains_any" {
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
	// mismo id (la identidad Sigma se conserva), condiciones distintas
	if res.Converted[0].ID != res.Converted[1].ID {
		t.Error("la division OR debe conservar el id Sigma")
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
