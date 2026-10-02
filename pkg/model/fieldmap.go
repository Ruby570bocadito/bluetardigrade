package model

import (
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// FieldMap flattens the event into a generic map so rule conditions can
// address any field with a dotted path (e.g. "process.command_line").
// Numeric values arrive as float64, as produced by encoding/json.
//
// The map is built directly from the struct instead of a json.Marshal +
// json.Unmarshal round trip (the rule engine and the threshold detector
// call this for every event, and the round trip dominated their CPU and
// allocation profile). The output is exactly what the round trip
// produced — same keys, same omitempty rules, float64 numbers,
// RFC 3339 timestamps and invalid UTF-8 coerced byte-by-byte to U+FFFD
// — and TestFieldMapParity / FuzzFieldMapParity hold it to that.
func (e *Event) FieldMap() map[string]any {
	if e == nil {
		return nil
	}
	ts, ok := jsonTime(e.Timestamp)
	if !ok {
		return nil // json.Marshal refuses years outside [0,9999]
	}
	m := make(map[string]any, 8)
	m["id"] = jsonString(e.ID)
	m["timestamp"] = ts
	m["type"] = jsonString(e.Type)
	m["source"] = jsonString(e.Source)
	m["host"] = jsonString(e.Host)
	putString(m, "user", e.User)
	if e.Process != nil {
		m["process"] = processMap(e.Process)
	}
	if e.Target != nil {
		m["target"] = processMap(e.Target)
	}
	if a := e.Access; a != nil {
		sub := make(map[string]any, 2)
		putString(sub, "granted_access", a.GrantedAccess)
		putString(sub, "call_trace", a.CallTrace)
		m["access"] = sub
	}
	if f := e.File; f != nil {
		sub := make(map[string]any, 4)
		putString(sub, "path", f.Path)
		putString(sub, "extension", f.Extension)
		putNumber(sub, "size_bytes", float64(f.SizeBytes), f.SizeBytes != 0)
		putStringMap(sub, "hashes", f.Hashes)
		m["file"] = sub
	}
	if n := e.Network; n != nil {
		sub := make(map[string]any, 6)
		putString(sub, "protocol", n.Protocol)
		putString(sub, "source_ip", n.SourceIP)
		putNumber(sub, "source_port", float64(n.SourcePort), n.SourcePort != 0)
		putString(sub, "destination_ip", n.DestinationIP)
		putNumber(sub, "destination_port", float64(n.DestinationPort), n.DestinationPort != 0)
		putString(sub, "domain", n.Domain)
		m["network"] = sub
	}
	if r := e.Registry; r != nil {
		sub := make(map[string]any, 4)
		putString(sub, "key", r.Key)
		putString(sub, "value_name", r.ValueName)
		putString(sub, "value", r.Value)
		putString(sub, "operation", r.Operation)
		m["registry"] = sub
	}
	if len(e.Tags) > 0 {
		tags := make([]any, len(e.Tags))
		for i, t := range e.Tags {
			tags[i] = jsonString(t)
		}
		m["tags"] = tags
	}
	putStringMap(m, "attributes", e.Attributes)
	putStringMap(m, "enrichment", e.Enrichment)
	return m
}

func processMap(p *Process) map[string]any {
	sub := make(map[string]any, 6)
	sub["pid"] = float64(p.PID)
	putNumber(sub, "ppid", float64(p.PPID), p.PPID != 0)
	sub["name"] = jsonString(p.Name)
	putString(sub, "command_line", p.CommandLine)
	putString(sub, "image", p.Image)
	putStringMap(sub, "hashes", p.Hashes)
	return sub
}

// putString mirrors `json:",omitempty"` for a string field.
func putString(m map[string]any, key, v string) {
	if v != "" {
		m[key] = jsonString(v)
	}
}

func putNumber(m map[string]any, key string, v float64, present bool) {
	if present {
		m[key] = v
	}
}

// putStringMap mirrors `json:",omitempty"` for a map[string]string:
// keys and values are coerced like json does, and when two raw keys
// coerce to the same string the one json would emit last (byte order
// of the raw keys) wins, as it does on Unmarshal.
func putStringMap(m map[string]any, key string, src map[string]string) {
	if len(src) == 0 {
		return
	}
	out := make(map[string]any, len(src))
	clean := true
	for k := range src {
		if !utf8.ValidString(k) {
			clean = false
			break
		}
	}
	if clean {
		for k, v := range src {
			out[k] = jsonString(v)
		}
	} else {
		keys := make([]string, 0, len(src))
		for k := range src {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			out[jsonString(k)] = jsonString(src[k])
		}
	}
	m[key] = out
}

// jsonString returns s as encoding/json would round-trip it: invalid
// UTF-8 bytes each become U+FFFD.
func jsonString(s string) string {
	if utf8.ValidString(s) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s) + 8)
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			b.WriteRune(utf8.RuneError)
		} else {
			b.WriteString(s[i : i+size])
		}
		i += size
	}
	return b.String()
}

// jsonTime formats t through time.Time.MarshalJSON itself, so the edge
// cases json refuses (years outside [0,9999], zone offsets it cannot
// express) fail here exactly as they did in the round trip.
func jsonTime(t time.Time) (string, bool) {
	b, err := t.MarshalJSON()
	if err != nil || len(b) < 2 {
		return "", false
	}
	return string(b[1 : len(b)-1]), true
}
