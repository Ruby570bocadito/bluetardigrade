package collector

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func decode(t *testing.T, source, raw string) *model.Event {
	t.Helper()
	decoder, err := NewDecoder(source, "OBSERVER")
	if err != nil {
		t.Fatal(err)
	}
	ev, err := decoder.Decode([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	return ev
}

func TestSuricataObservationAndFinalVerdict(t *testing.T) {
	raw := `{"timestamp":"2026-10-02T10:00:00.123456+0000","event_type":"alert","flow_id":9007199254740993,"src_ip":"10.0.0.2","src_port":32000,"dest_ip":"8.8.8.8","dest_port":443,"proto":"TCP","alert":{"signature":"Observed signature","signature_id":42,"severity":1,"action":"allowed"},"verdict":{"action":"drop"}}`
	ev := decode(t, "suricata", raw)
	if ev.Type != model.TypeNetworkAlert || ev.Process != nil || ev.Host != "10.0.0.2" || ev.Attributes["ids_action"] != "allowed" || ev.Attributes["ids_verdict"] != "drop" || ev.Attributes["flow_id"] != "9007199254740993" {
		t.Fatalf("incorrect observed event: %+v", ev)
	}
	if again := decode(t, "suricata", raw); again.ID != ev.ID {
		t.Fatal("exact replay changed identity")
	}
	flow := decode(t, "suricata", `{"timestamp":"2026-10-02T10:02:00Z","event_type":"flow","src_ip":"10.0.0.2","dest_ip":"8.8.8.8","dest_port":445,"proto":"TCP","flow":{"start":"2026-10-02T10:00:00Z","end":"2026-10-02T10:02:00Z"}}`)
	if flow.Type != model.TypeNetworkConnect || flow.Timestamp.Format(time.RFC3339) != "2026-10-02T10:00:00Z" || flow.Attributes["source_timestamp"] != "2026-10-02T10:02:00Z" {
		t.Fatal("flow confused record and start timestamps")
	}
	decoder, _ := NewDecoder("suricata", "OBSERVER")
	if _, err := decoder.Decode([]byte(`{"event_type":"dns"}`)); !errors.Is(err, ErrIgnored) {
		t.Fatalf("unsupported kind: %v", err)
	}
}

func TestZeekJSONConnectionWithoutInventedProcess(t *testing.T) {
	ev := decode(t, "zeek", `{"ts":1790935200.25,"uid":"C-fixture","id.orig_h":"10.0.0.2","id.orig_p":32000,"id.resp_h":"8.8.8.8","id.resp_p":3389,"proto":"tcp","service":"rdp","conn_state":"SF","orig_bytes":12}`)
	if ev.Type != model.TypeNetworkConnect || ev.Process != nil || ev.Network.Protocol != "TCP" || ev.Attributes["zeek_uid"] != "C-fixture" || ev.Timestamp.Nanosecond() != 250000000 {
		t.Fatalf("bad Zeek observation: %+v", ev)
	}
}

func TestOsqueryDifferentialRowsAreNotProcessCreations(t *testing.T) {
	ev := decode(t, "osquery", `{"name":"bt_exposed_admin_ports","action":"added","hostIdentifier":"HOST-A","unixTime":1790935200,"counter":"1","columns":{"pid":"123","name":"sshd","address":"0.0.0.0","port":"22","cmdline":"sshd -D"}}`)
	if ev.Type != model.TypeHostQuery || ev.Host != "HOST-A" || ev.Process == nil || ev.Process.PID != 123 || ev.Network != nil || ev.Attributes["column_port"] != "22" {
		t.Fatalf("bad query observation: %+v", ev)
	}
	decoder, _ := NewDecoder("osquery", "OBSERVER")
	for _, raw := range []string{`{"diffResults":{"added":[]}}`, `{"snapshot":[]}`, `{"name":"p","action":"snapshot"}`} {
		if _, err := decoder.Decode([]byte(raw)); err == nil {
			t.Fatal("accepted batch/snapshot", raw)
		}
	}
}

func TestCowrieDoesNotRetainPasswordsOrInteractiveStdin(t *testing.T) {
	ev := decode(t, "cowrie", `{"eventid":"cowrie.login.success","timestamp":"2026-10-02T10:00:00Z","src_ip":"10.0.0.3","username":"root","password":"fixture-secret","message":"password fixture-secret","session":"s1"}`)
	raw, _ := ev.Encode()
	if strings.Contains(string(raw), "fixture-secret") || ev.Process != nil || ev.Type != model.TypeHoneypotLogin {
		t.Fatal("password retained or process invented")
	}
	stdin := decode(t, "cowrie", `{"eventid":"cowrie.command.input","timestamp":"2026-10-02T10:00:00Z","src_ip":"10.0.0.3","input":"fixture-secret","realm":"passwd"}`)
	if stdin.Attributes["honeypot_input"] != "" || stdin.Attributes["honeypot_input_kind"] != "stdin" {
		t.Fatal("interactive password input retained")
	}
	command := decode(t, "cowrie", `{"eventid":"cowrie.command.input","timestamp":"2026-10-02T10:00:00Z","src_ip":"10.0.0.3","input":"whoami"}`)
	if command.Attributes["honeypot_input"] != "whoami" || command.Process != nil {
		t.Fatal("shell observation lost or executed")
	}
}

func TestDecoderRejectsMalformedAndExcessiveEvidence(t *testing.T) {
	d, _ := NewDecoder("suricata", "OBSERVER")
	for _, raw := range []string{`[]`, `null`, `{} {}`, `{"event_type":"alert"}`, `{"timestamp":"2026-10-02T10:00:00Z","event_type":"flow","src_ip":"invalid","dest_ip":"8.8.8.8","proto":"TCP"}`, `{"timestamp":"2026-10-02T10:00:00Z","event_type":"flow","src_ip":"10.0.0.1","dest_ip":"8.8.8.8","dest_port":65536,"proto":"TCP"}`, strings.Repeat("x", MaxLine+1), string([]byte{0xff})} {
		if _, err := d.Decode([]byte(raw)); err == nil {
			t.Fatal("malformed evidence accepted")
		}
	}
	for _, source := range []string{"", "guess"} {
		if _, err := NewDecoder(source, "OBSERVER"); err == nil {
			t.Fatal("implicit source accepted")
		}
	}
	if _, err := NewDecoder("zeek", "bad\nobserver"); err == nil {
		t.Fatal("invalid observer accepted")
	}
	attributes := map[string]string{}
	put(attributes, "value", strings.Repeat("á", 3000))
	if !strings.HasSuffix(attributes["value"], " [truncated]") {
		t.Fatal("truncation not labelled")
	}
}

func TestFirewallHeadersTimezoneAndDirection(t *testing.T) {
	d, _ := NewDecoder("windows-firewall", "WIN-FW")
	for _, header := range []string{"#Version: 1.5", "#Time Format: UTC", "#Fields: date time action protocol src-ip dst-ip src-port dst-port path pid"} {
		if _, err := d.Decode([]byte(header)); !errors.Is(err, ErrIgnored) {
			t.Fatal(err)
		}
	}
	ev, err := d.Decode([]byte("2026-10-02 10:00:00 DROP TCP 10.0.0.3 10.0.0.4 32000 3389 RECEIVE 42"))
	if err != nil {
		t.Fatal(err)
	}
	if ev.Host != "WIN-FW" || ev.Process != nil || ev.Attributes["firewall_action"] != "drop" || ev.Attributes["firewall_direction"] != "inbound" || ev.Network.DestinationPort != 3389 {
		t.Fatalf("bad firewall event: %+v", ev)
	}
	_, _ = d.Decode([]byte("#Time Format: Local"))
	if _, err := d.Decode([]byte("2026-10-02 10:00:00 ALLOW TCP 10.0.0.3 10.0.0.4 1 22 RECEIVE -")); err == nil {
		t.Fatal("assumed source timezone")
	}
	if err := d.SetFirewallTimezone("Europe/Madrid"); err != nil {
		t.Fatal(err)
	}
	for _, stamp := range []string{"2026-03-29 02:30:00", "2026-10-25 02:30:00"} {
		if _, err := d.Decode([]byte(stamp + " ALLOW TCP 10.0.0.3 10.0.0.4 1 22 RECEIVE -")); err == nil {
			t.Fatal("ambiguous/nonexistent DST time accepted")
		}
	}
	if _, err := d.Decode([]byte("#Fields: date time action protocol src-ip dst-ip src-port src-port")); err == nil {
		t.Fatal("duplicate header accepted")
	}
}

func TestMailOfflineMIMEIndicatorsAndSafeURLs(t *testing.T) {
	d, _ := NewDecoder("eml", "MAIL-LAB")
	now := time.Date(2026, 10, 2, 10, 0, 0, 0, time.UTC)
	raw := "From: sender@example.com\r\nReply-To: other@example.net\r\nSubject: =?UTF-8?Q?Prueba_de_correo?=\r\nDate: Fri, 02 Oct 2026 10:00:00 +0000\r\nAuthentication-Results: fixture; dmarc=fail (reported)\r\nContent-Type: multipart/mixed; boundary=fixture\r\n\r\n--fixture\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhttps://user:fixture-secret@[2001:db8::1]/review?token=fixture-secret#secret\r\n--fixture\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=invoice.exe\r\n\r\nINERT\r\n--fixture--\r\n"
	ev, err := d.DecodeMail([]byte(raw), now)
	if err != nil {
		t.Fatal(err)
	}
	a := ev.Attributes
	for _, key := range []string{"mail_risky_attachment", "mail_dmarc_reported_fail", "mail_reply_domain_mismatch", "mail_url_ip_literal", "mail_url_credentials"} {
		if a[key] != "true" {
			t.Errorf("missing %s", key)
		}
	}
	if a["mail_auth_trust"] != "unverified_header" || a["mail_time_origin"] != "declared_date" || a["mail_urls"] != "https://[2001:db8::1]/review" {
		t.Fatalf("incorrect mail trust/URL: %+v", a)
	}
	encoded, _ := ev.Encode()
	if strings.Contains(string(encoded), "fixture-secret") || strings.Contains(string(encoded), "INERT") {
		t.Fatal("retained credentials or attachment payload")
	}
	missingDate, err := d.DecodeMail([]byte("From: sender@example.com\nSubject: plain\n\nHello"), now)
	if err != nil || missingDate.Attributes["mail_time_origin"] != "import_time" || !missingDate.Timestamp.Equal(now) {
		t.Fatal("invented declared mail time")
	}
	for _, bad := range [][]byte{[]byte("From: invalid\n\nx"), []byte("From: a@b.com\nContent-Type: multipart/mixed\n\nx"), []byte(strings.Repeat("x", MaxMail+1))} {
		if _, err := d.DecodeMail(bad, now); err == nil {
			t.Fatal("invalid mail accepted")
		}
	}
}

func TestMailObserverIdentityAndURLLimitAreExplicit(t *testing.T) {
	d, _ := NewDecoder("eml", "MAIL-A")
	other, _ := NewDecoder("eml", "MAIL-B")
	var links strings.Builder
	for i := range 101 {
		fmt.Fprintf(&links, "https://example.com/review/%d ", i)
	}
	raw := []byte("From: sender@example.com\nContent-Type: text/plain\n\n" + links.String())
	a, err := d.DecodeMail(raw, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	b, err := other.DecodeMail(raw, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if a.ID == b.ID || a.Attributes["mail_sha256"] != b.Attributes["mail_sha256"] {
		t.Fatal("same mail collapsed distinct observers or changed original evidence hash")
	}
	if a.Attributes["mail_parts_not_inspected"] != "true" || len(strings.Split(a.Attributes["mail_urls"], "\n")) != 100 {
		t.Fatal("URL limit was silent")
	}
}
