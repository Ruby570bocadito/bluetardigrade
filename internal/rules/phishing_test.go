package rules

import (
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/collector"
)

// Exercise the shipped rules against actual MIME normalization, not manually
// asserted flags. The attachment bytes and destinations are inert fixtures.
func TestPhishingRulesDetectDecodedMailAndLeaveOrdinaryMailQuiet(t *testing.T) {
	engine := loadTestEngine(t)
	decoder, err := collector.NewDecoder("eml", "MAIL-RULE-FIXTURE")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		id, headers, body string
	}{
		{"soc-mail-html-link-mismatch", "Content-Type: text/html", `<a href="https://other.example.invalid">https://bank.example.invalid</a>`},
		{"soc-mail-url-credentials", "Content-Type: text/plain", "https://bank.example.invalid@other.example.invalid/login"},
		{"soc-mail-url-punycode", "Content-Type: text/plain", "https://xn--bcher-kva.example.invalid/review"},
		{"soc-mail-macro-attachment", "Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=agenda.docm", "INERT"},
		{"soc-mail-double-extension", "Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=invoice.pdf.exe", "INERT"},
		{"soc-mail-bidi-filename", "Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=\"invoice\u202egnp.exe\"", "INERT"},
	}
	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			ev, err := decoder.DecodeMail([]byte("From: sender@example.invalid\r\n"+tc.headers+"\r\n\r\n"+tc.body), time.Now())
			if err != nil {
				t.Fatal(err)
			}
			matches := false
			for _, hit := range engine.Evaluate(ev) {
				matches = matches || hit.Rule.ID == tc.id
			}
			if !matches {
				t.Fatal("observed mail indicator did not trigger its shipped rule")
			}
			ev.Source = "sysmon"
			for _, hit := range engine.Evaluate(ev) {
				if hit.Rule.ID == tc.id {
					t.Fatal("phishing rule trusted an unrelated declared source")
				}
			}
		})
	}
	benign, err := decoder.DecodeMail([]byte("From: sender@example.invalid\r\nReply-To: support@example.invalid\r\nContent-Type: text/html\r\n\r\n<a href=\"https://example.invalid/help\">https://EXAMPLE.INVALID/help</a>"), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, hit := range engine.Evaluate(benign) {
		if strings.HasPrefix(hit.Rule.ID, "soc-mail-") {
			t.Fatalf("ordinary same-host mail triggered %s", hit.Rule.ID)
		}
	}
}
