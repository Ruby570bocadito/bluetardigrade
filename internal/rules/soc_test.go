package rules

import (
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestSOCSignalsRequireSourceAndInvestigatedCondition(t *testing.T) {
	engine := loadTestEngine(t)
	cases := []struct {
		id, source, kind, key, value, benign string
		network                              *model.Network
		extra                                map[string]string
	}{
		{"soc-ids-priority-high", "suricata", model.TypeNetworkAlert, "ids_priority", "1", "4", nil, nil},
		{"soc-ids-priority-medium", "suricata", model.TypeNetworkAlert, "ids_priority", "2", "4", nil, nil},
		{"soc-ips-reported-drop", "suricata", model.TypeNetworkAlert, "ids_verdict", "drop", "pass", nil, nil},
		{"soc-ndr-public-smb", "zeek", model.TypeNetworkConnect, "destination_scope", "public", "private", &model.Network{Protocol: "TCP", DestinationPort: 445}, nil},
		{"soc-ndr-public-rdp", "suricata", model.TypeNetworkConnect, "destination_scope", "public", "private", &model.Network{Protocol: "TCP", DestinationPort: 3389}, nil},
		{"soc-honeypot-login", "cowrie", model.TypeHoneypotLogin, "honeypot_event", "cowrie.login.success", "cowrie.login.failed", nil, nil},
		{"soc-honeypot-command", "cowrie", model.TypeHoneypotCommand, "honeypot_input_kind", "command", "stdin", nil, nil},
		{"soc-osquery-admin-listener", "osquery", model.TypeHostQuery, "query_counter", "1", "0", nil, map[string]string{"query_name": "bt_exposed_admin_ports", "query_action": "added", "column_address": "0.0.0.0", "column_port": "22"}},
		{"soc-firewall-admin-allow", "windows-firewall", model.TypeNetworkFirewall, "firewall_action", "allow", "drop", &model.Network{DestinationPort: 3389}, map[string]string{"firewall_direction": "inbound"}},
		{"soc-firewall-admin-drop", "windows-firewall", model.TypeNetworkFirewall, "firewall_action", "drop", "allow", &model.Network{DestinationPort: 22}, map[string]string{"firewall_direction": "inbound"}},
		{"soc-mail-risky-attachment", "eml", model.TypeEmailMessage, "mail_risky_attachment", "true", "false", nil, nil},
		{"soc-mail-dmarc-fail", "eml", model.TypeEmailMessage, "mail_dmarc_reported_fail", "true", "false", nil, nil},
		{"soc-mail-ip-url", "eml", model.TypeEmailMessage, "mail_url_ip_literal", "true", "false", nil, nil},
		{"soc-mail-reply-mismatch", "eml", model.TypeEmailMessage, "mail_reply_domain_mismatch", "true", "false", nil, nil},
	}
	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			a := map[string]string{tc.key: tc.value}
			for key, value := range tc.extra {
				a[key] = value
			}
			ev := &model.Event{ID: "soc-fixture", Type: tc.kind, Source: tc.source, Host: "LAB", Timestamp: time.Now(), Attributes: a, Network: tc.network}
			matches := func() bool {
				for _, hit := range engine.Evaluate(ev) {
					if hit.Rule.ID == tc.id {
						return true
					}
				}
				return false
			}
			if !matches() {
				t.Fatal("positive observed signal missed")
			}
			ev.Attributes[tc.key] = tc.benign
			if matches() {
				t.Fatal("benign condition still matched")
			}
			ev.Attributes[tc.key] = tc.value
			ev.Source = "other"
			if matches() {
				t.Fatal("wrong declared source matched")
			}
		})
	}
}
