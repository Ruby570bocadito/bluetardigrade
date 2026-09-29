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
        if e.Count() != 7 {
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

func TestBenignEventsDoNotFire(t *testing.T) {
        e := loadTestEngine(t)
        for _, ev := range []*model.Event{
                testEvent("notepad.exe", `"C:\Windows\system32\NOTEPAD.EXE" todo.txt`),
                testEvent("powershell.exe", "powershell.exe Get-ChildItem C:\\Logs"),
                testEvent("certutil.exe", "certutil.exe -hashfile data.bin SHA256"),
        } {
                if hits := e.Evaluate(ev); len(hits) != 0 {
                        t.Errorf("benign event %s fired %d rule(s): %v",
                                ev.Process.Name, len(hits), hits[0].Rule.Name)
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
