package model

import (
	"encoding/json"
	"math/rand"
	"reflect"
	"testing"
	"time"
)

// fieldMapJSON is the historical implementation: the reference the
// direct builder must match exactly.
func fieldMapJSON(e *Event) map[string]any {
	b, err := json.Marshal(e)
	if err != nil {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil
	}
	return m
}

var parityStrings = []string{
	"", "a", "powershell.exe", `C:\Windows\System32\cmd.exe /c "x"`, "ünïcødé ✓", "<script>&",
	"\xff", "ok\xffok", "\xe2\x28\xa1", "\xed\xa0\x80", "tab\tnew\nline", "\x00nul", "quote\"back\\slash",
}

func randString(r *rand.Rand) string { return parityStrings[r.Intn(len(parityStrings))] }

func randStringMap(r *rand.Rand) map[string]string {
	switch r.Intn(4) {
	case 0:
		return nil
	case 1:
		return map[string]string{}
	}
	m := map[string]string{}
	for i := r.Intn(5); i >= 0; i-- {
		m[randString(r)] = randString(r)
	}
	return m
}

func randProcess(r *rand.Rand) *Process {
	if r.Intn(3) == 0 {
		return nil
	}
	return &Process{PID: r.Intn(3) * 4242, PPID: r.Intn(2) * -7, Name: randString(r), CommandLine: randString(r),
		Image: randString(r), Hashes: randStringMap(r)}
}

func randEvent(r *rand.Rand) *Event {
	ev := &Event{ID: randString(r), Type: randString(r), Source: randString(r), Host: randString(r), User: randString(r),
		Process: randProcess(r), Target: randProcess(r), Attributes: randStringMap(r), Enrichment: randStringMap(r)}
	switch r.Intn(4) {
	case 0: // zero time
	case 1:
		ev.Timestamp = time.Date(2026, 10, 2, 12, 0, 0, r.Intn(1e9), time.UTC)
	case 2:
		ev.Timestamp = time.Date(2026, 10, 2, 12, 0, 0, 0, time.FixedZone("x", -5*3600))
	case 3:
		ev.Timestamp = time.Date(1999, 1, 1, 0, 0, 0, 1, time.FixedZone("lmt", 1050)) // offset with seconds
	}
	if r.Intn(2) == 0 {
		ev.Access = &ProcessAccess{GrantedAccess: randString(r), CallTrace: randString(r)}
	}
	if r.Intn(2) == 0 {
		ev.File = &File{Path: randString(r), Extension: randString(r), SizeBytes: int64(r.Intn(2)) * 1 << 40, Hashes: randStringMap(r)}
	}
	if r.Intn(2) == 0 {
		ev.Network = &Network{Protocol: randString(r), SourceIP: randString(r), SourcePort: r.Intn(2) * 51515,
			DestinationIP: randString(r), DestinationPort: r.Intn(2) * 443, Domain: randString(r)}
	}
	if r.Intn(2) == 0 {
		ev.Registry = &Registry{Key: randString(r), ValueName: randString(r), Value: randString(r), Operation: randString(r)}
	}
	switch r.Intn(3) {
	case 1:
		ev.Tags = []string{}
	case 2:
		ev.Tags = []string{randString(r), randString(r)}
	}
	return ev
}

func TestFieldMapParity(t *testing.T) {
	r := rand.New(rand.NewSource(20261002))
	for i := 0; i < 20000; i++ {
		ev := randEvent(r)
		want, got := fieldMapJSON(ev), ev.FieldMap()
		if !reflect.DeepEqual(want, got) {
			t.Fatalf("parity drift on %#v\nwant %#v\ngot  %#v", ev, want, got)
		}
	}
	// out-of-range timestamps: the round trip returned nil
	for _, ts := range []time.Time{time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(-1, 1, 1, 0, 0, 0, 0, time.UTC)} {
		ev := &Event{ID: "x", Type: "t", Timestamp: ts}
		if fieldMapJSON(ev) != nil || ev.FieldMap() != nil {
			t.Fatalf("year %d: want nil from both implementations", ts.Year())
		}
	}
	var nilEv *Event
	if nilEv.FieldMap() != nil {
		t.Fatal("nil event must map to nil")
	}
}

func FuzzFieldMapParity(f *testing.F) {
	for _, s := range parityStrings {
		f.Add(s, s, 1, int64(0))
	}
	f.Fuzz(func(t *testing.T, a, b string, n int, size int64) {
		ev := &Event{ID: a, Type: b, Host: a + b, Timestamp: time.Unix(size%1e10, 0).UTC(),
			Process:    &Process{PID: n, Name: a, CommandLine: b, Hashes: Hashes{a: b, b: a}},
			File:       &File{Path: b, SizeBytes: size},
			Network:    &Network{SourcePort: n, Domain: a},
			Tags:       []string{a, b},
			Attributes: map[string]string{a: b, b + "x": a},
		}
		if want, got := fieldMapJSON(ev), ev.FieldMap(); !reflect.DeepEqual(want, got) {
			t.Fatalf("parity drift\nwant %#v\ngot  %#v", want, got)
		}
	})
}

func benchEvent() *Event {
	return &Event{ID: "0f3c2a1e-1111-4222-8333-944455556666", Timestamp: time.Now().UTC(), Type: TypeProcessCreate,
		Source: "sysmon", Host: "LAB-WKS-01", User: `CORP\ana`,
		Process: &Process{PID: 4242, PPID: 812, Name: "powershell.exe",
			CommandLine: `powershell.exe -NoP -W Hidden -Enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkA`,
			Image:       `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, Hashes: Hashes{"sha256": "ab12cd34"}},
		Tags: []string{"sensor:sysmon"}, Enrichment: map[string]string{"parent_name": "winword.exe"}}
}

func BenchmarkFieldMap(b *testing.B) {
	ev := benchEvent()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = ev.FieldMap()
	}
}

func BenchmarkFieldMapJSONRoundTrip(b *testing.B) {
	ev := benchEvent()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = fieldMapJSON(ev)
	}
}
