package rules

import (
        "regexp"
        "testing"
        "time"

        "github.com/Ruby570bocadito/security-framework/pkg/model"
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
        if e.Count() != 21 {
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
        }
        cr := compiledRule{regex: map[int]*regexp.Regexp{}}
        for i, tc := range cases {
                c := Condition{Field: "f", Operator: tc.op, Value: tc.val}
                if tc.op == "regex" {
                        re, err := regexp.Compile(asString(tc.val))
                        if err != nil {
                                t.Fatalf("case %d: %v", i, err)
                        }
                        cr.regex = map[int]*regexp.Regexp{0: re}
                }
                if got := evalCondition(cr, 0, c, tc.given); got != tc.want {
                        t.Errorf("case %d: operator %s(%v, %v) = %v, want %v",
                                i, tc.op, tc.given, tc.val, got, tc.want)
                }
        }
}
