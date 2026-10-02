// Package collector normalizes observed provider records without executing
// commands, inventing process events or controlling the provider's firewall.
package collector

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

const MaxLine = 1 << 20
const maxAttribute = 4096

// ErrIgnored marks a well-formed record outside the supported event subset.
var ErrIgnored = errors.New("record type not supported")

// Decoder is scoped to one source and observer. Firewall headers are stateful;
// use a new decoder for each independently read file.
type Decoder struct {
	Source         string
	Observer       string
	firewallFields []string
	firewallFormat string
	firewallZone   *time.Location
}

// NewDecoder requires an explicit provider; it never guesses from JSON keys.
func NewDecoder(source, observer string) (*Decoder, error) {
	switch source {
	case "suricata", "zeek", "osquery", "cowrie", "windows-firewall", "eml":
	default:
		return nil, errors.New("source must be suricata, zeek, osquery, cowrie, windows-firewall or eml")
	}
	if observer == "" || len(observer) > 255 || !utf8.ValidString(observer) || strings.ContainsAny(observer, "\r\n\x00") {
		return nil, errors.New("observer must contain 1..255 UTF-8 bytes without CR, LF or NUL")
	}
	return &Decoder{Source: source, Observer: observer}, nil
}

// Decode accepts one UTF-8 JSON object (or one Windows firewall line).
func (d *Decoder) Decode(line []byte) (*model.Event, error) {
	if len(line) > MaxLine || !utf8.Valid(line) {
		return nil, errors.New("record exceeds 1 MiB or is not UTF-8")
	}
	if d.Source == "windows-firewall" {
		return d.decodeFirewall(string(line))
	}
	if d.Source == "eml" {
		return nil, errors.New("EML requires DecodeMail with the whole message")
	}
	var row map[string]any
	dec := json.NewDecoder(bytes.NewReader(line))
	dec.UseNumber()
	if err := dec.Decode(&row); err != nil || row == nil {
		return nil, errors.New("expected a JSON object")
	}
	var extra any
	if dec.Decode(&extra) != io.EOF {
		return nil, errors.New("expected exactly one JSON object")
	}
	var ev *model.Event
	var err error
	switch d.Source {
	case "suricata":
		ev, err = d.suricata(row)
	case "zeek":
		ev, err = d.zeek(row)
	case "osquery":
		ev, err = d.osquery(row)
	case "cowrie":
		ev, err = d.cowrie(row)
	}
	if err != nil {
		return nil, err
	}
	if ev == nil {
		return nil, errors.New("decoder produced no record")
	}
	ev.ID = d.id(line)
	return ev, nil
}

func (d *Decoder) id(raw []byte) string {
	h := sha256.New()
	_, _ = io.WriteString(h, d.Source+"\n"+d.Observer+"\n")
	_, _ = h.Write(raw)
	return hex.EncodeToString(h.Sum(nil)[:16])
}

func (d *Decoder) event(typ, host string, ts time.Time) *model.Event {
	return &model.Event{Type: typ, Source: d.Source, Host: host, Timestamp: ts.UTC(), Tags: []string{"collector:" + d.Source}, Attributes: map[string]string{"observer_host": d.Observer}}
}

func put(m map[string]string, key, value string) {
	if value == "" {
		return
	}
	if len(value) > maxAttribute {
		value = value[:maxAttribute]
		for !utf8.ValidString(value) {
			value = value[:len(value)-1]
		}
		value += " [truncated]"
	}
	m[key] = value
}

func text(row map[string]any, key string) string { v, _ := row[key].(string); return v }
func object(row map[string]any, key string) map[string]any {
	v, _ := row[key].(map[string]any)
	return v
}
func scalar(v any) (string, bool) {
	switch n := v.(type) {
	case string:
		return n, true
	case json.Number:
		return n.String(), true
	case bool:
		return strconv.FormatBool(n), true
	default:
		return "", false
	}
}
func required(row map[string]any, key string) (string, error) {
	v := text(row, key)
	if strings.TrimSpace(v) == "" {
		return "", fmt.Errorf("missing string field %s", key)
	}
	return v, nil
}
func unsigned(v any, max uint64) (uint64, error) {
	s, ok := scalar(v)
	if !ok {
		return 0, errors.New("expected unsigned integer")
	}
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil || n > max {
		return 0, errors.New("unsigned integer outside supported range")
	}
	return n, nil
}
func sourceTime(s string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.999999999-0700"} {
		if ts, err := time.Parse(layout, s); err == nil && ts.Year() >= 1970 {
			return ts, nil
		}
	}
	return time.Time{}, errors.New("missing or invalid source timestamp (offset required)")
}
func unixTime(v any) (time.Time, error) {
	s, ok := scalar(v)
	if !ok {
		return time.Time{}, errors.New("missing Unix timestamp")
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n >= 253402300800 {
		return time.Time{}, errors.New("invalid Unix timestamp")
	}
	sec, frac := math.Modf(n)
	return time.Unix(int64(sec), int64(frac*1e9)).UTC(), nil
}
func network(row map[string]any, src, dst, sport, dport, proto string, requireDestination bool) (*model.Network, error) {
	source := text(row, src)
	destination := text(row, dst)
	if net.ParseIP(source) == nil || (requireDestination && destination == "") || (destination != "" && net.ParseIP(destination) == nil) {
		return nil, errors.New("invalid or missing IP address")
	}
	n := &model.Network{SourceIP: source, DestinationIP: destination, Protocol: strings.ToUpper(text(row, proto))}
	if n.Protocol == "" {
		return nil, errors.New("missing protocol")
	}
	for key, target := range map[string]*int{sport: &n.SourcePort, dport: &n.DestinationPort} {
		if value, ok := row[key]; ok && value != nil {
			port, err := unsigned(value, 65535)
			if err != nil {
				return nil, fmt.Errorf("invalid port %s", key)
			}
			*target = int(port)
		}
	}
	return n, nil
}
func destinationScope(ip string) string {
	n := net.ParseIP(ip)
	if n == nil {
		return "other"
	}
	if n.IsPrivate() {
		return "private"
	}
	if n.IsGlobalUnicast() {
		return "public"
	}
	return "other"
}

func (d *Decoder) suricata(row map[string]any) (*model.Event, error) {
	kind, err := required(row, "event_type")
	if err != nil {
		return nil, err
	}
	if kind != "alert" && kind != "drop" && kind != "flow" {
		return nil, ErrIgnored
	}
	ts, err := sourceTime(text(row, "timestamp"))
	if err != nil {
		return nil, err
	}
	netw, err := network(row, "src_ip", "dest_ip", "src_port", "dest_port", "proto", true)
	if err != nil {
		return nil, err
	}
	typ := model.TypeNetworkAlert
	if kind == "flow" {
		typ = model.TypeNetworkConnect
	}
	ev := d.event(typ, netw.SourceIP, ts)
	ev.Network = netw
	a := ev.Attributes
	put(a, "source_timestamp", text(row, "timestamp"))
	put(a, "destination_scope", destinationScope(netw.DestinationIP))
	if value, ok := scalar(row["flow_id"]); ok {
		put(a, "flow_id", value)
	}
	put(a, "app_protocol", text(row, "app_proto"))
	if verdict := object(row, "verdict"); verdict != nil {
		put(a, "ids_verdict", text(verdict, "action"))
	}
	if kind == "drop" && a["ids_verdict"] == "" {
		a["ids_verdict"] = "reported_drop"
	}
	if kind == "alert" {
		alert := object(row, "alert")
		signature, err := required(alert, "signature")
		if err != nil {
			return nil, err
		}
		id, err := unsigned(alert["signature_id"], math.MaxUint32)
		if err != nil {
			return nil, errors.New("invalid signature_id")
		}
		priority, err := unsigned(alert["severity"], 255)
		if err != nil || priority == 0 {
			return nil, errors.New("invalid IDS severity")
		}
		put(a, "ids_signature", signature)
		put(a, "ids_signature_id", strconv.FormatUint(id, 10))
		put(a, "ids_priority", strconv.FormatUint(priority, 10))
		put(a, "ids_category", text(alert, "category"))
		put(a, "ids_action", text(alert, "action"))
	}
	if flow := object(row, "flow"); flow != nil {
		for _, key := range []string{"start", "end", "state", "bytes_toserver", "bytes_toclient", "pkts_toserver", "pkts_toclient"} {
			if value, ok := scalar(flow[key]); ok {
				put(a, "flow_"+key, value)
			}
		}
		if kind == "flow" && text(flow, "start") != "" {
			start, err := sourceTime(text(flow, "start"))
			if err != nil {
				return nil, err
			}
			ev.Timestamp = start.UTC()
		}
	}
	return ev, nil
}

func (d *Decoder) zeek(row map[string]any) (*model.Event, error) {
	uid, err := required(row, "uid")
	if err != nil {
		return nil, err
	}
	ts, err := unixTime(row["ts"])
	if err != nil {
		return nil, err
	}
	netw, err := network(row, "id.orig_h", "id.resp_h", "id.orig_p", "id.resp_p", "proto", true)
	if err != nil {
		return nil, err
	}
	if _, ok := row["id.orig_p"]; !ok {
		return nil, errors.New("missing id.orig_p")
	}
	if _, ok := row["id.resp_p"]; !ok {
		return nil, errors.New("missing id.resp_p")
	}
	ev := d.event(model.TypeNetworkConnect, netw.SourceIP, ts)
	ev.Network = netw
	put(ev.Attributes, "zeek_uid", uid)
	put(ev.Attributes, "destination_scope", destinationScope(netw.DestinationIP))
	if value, ok := scalar(row["ts"]); ok {
		put(ev.Attributes, "source_timestamp", value)
	}
	for _, key := range []string{"service", "duration", "orig_bytes", "resp_bytes", "conn_state", "missed_bytes"} {
		if value, ok := scalar(row[key]); ok {
			put(ev.Attributes, "zeek_"+key, value)
		}
	}
	return ev, nil
}

func (d *Decoder) osquery(row map[string]any) (*model.Event, error) {
	if row["diffResults"] != nil || row["snapshot"] != nil {
		return nil, errors.New("osquery batch/snapshot unsupported; configure --logger_event_type=true")
	}
	name, err := required(row, "name")
	if err != nil {
		return nil, err
	}
	action := text(row, "action")
	if action != "added" && action != "removed" {
		return nil, errors.New("osquery requires individual added/removed differential rows")
	}
	host := text(row, "hostIdentifier")
	if host == "" {
		host = text(row, "hostname")
	}
	if host == "" {
		return nil, errors.New("missing osquery hostIdentifier")
	}
	ts, err := unixTime(row["unixTime"])
	if err != nil {
		return nil, err
	}
	columns := object(row, "columns")
	if len(columns) == 0 || len(columns) > 64 {
		return nil, errors.New("osquery columns must contain 1..64 scalar values")
	}
	ev := d.event(model.TypeHostQuery, host, ts)
	a := ev.Attributes
	put(a, "query_name", name)
	put(a, "query_action", action)
	for _, key := range []string{"counter", "epoch", "unixTime"} {
		if value, ok := scalar(row[key]); ok {
			put(a, "query_"+key, value)
		}
	}
	if row["counter"] != nil {
		if _, err := unsigned(row["counter"], math.MaxUint64); err != nil {
			return nil, errors.New("invalid osquery counter")
		}
	}
	for key, value := range columns {
		if key == "" || len(key) > 128 || strings.ContainsAny(key, ".\r\n\x00") {
			return nil, errors.New("invalid osquery column name")
		}
		s, ok := scalar(value)
		if !ok {
			return nil, errors.New("osquery columns must be scalar")
		}
		put(a, "column_"+key, s)
	}
	if pid, ok := columns["pid"]; ok {
		n, err := unsigned(pid, math.MaxInt32)
		if err != nil {
			return nil, errors.New("invalid osquery PID")
		}
		if a["column_name"] != "" {
			ev.Process = &model.Process{PID: int(n), Name: a["column_name"], Image: a["column_path"], CommandLine: a["column_cmdline"]}
		}
	}
	return ev, nil
}

func (d *Decoder) cowrie(row map[string]any) (*model.Event, error) {
	kind, err := required(row, "eventid")
	if err != nil {
		return nil, err
	}
	typ := model.TypeHoneypotLogin
	switch kind {
	case "cowrie.session.connect":
		typ = model.TypeHoneypotConnect
	case "cowrie.login.failed", "cowrie.login.success":
	case "cowrie.command.input":
		typ = model.TypeHoneypotCommand
	default:
		return nil, ErrIgnored
	}
	ts, err := sourceTime(text(row, "timestamp"))
	if err != nil {
		return nil, err
	}
	// Cowrie emits dst_ip/dst_port on connection records, often not on logins.
	copyRow := map[string]any{}
	for key, value := range row {
		copyRow[key] = value
	}
	copyRow["proto"] = "TCP"
	netw, err := network(copyRow, "src_ip", "dst_ip", "src_port", "dst_port", "proto", false)
	if err != nil {
		return nil, err
	}
	ev := d.event(typ, d.Observer, ts)
	ev.Network = netw
	ev.User = text(row, "username")
	put(ev.Attributes, "honeypot_event", kind)
	put(ev.Attributes, "honeypot_session", text(row, "session"))
	put(ev.Attributes, "honeypot_sensor", text(row, "sensor"))
	put(ev.Attributes, "source_timestamp", text(row, "timestamp"))
	if kind == "cowrie.command.input" {
		input, err := required(row, "input")
		if err != nil {
			return nil, err
		}
		if realm := text(row, "realm"); realm != "" {
			put(ev.Attributes, "honeypot_input_kind", "stdin")
			put(ev.Attributes, "honeypot_realm", realm)
		} else {
			put(ev.Attributes, "honeypot_input_kind", "command")
			put(ev.Attributes, "honeypot_input", input)
		}
	}
	// Never retain passwords, arbitrary message strings, payloads or stdin.
	return ev, nil
}
