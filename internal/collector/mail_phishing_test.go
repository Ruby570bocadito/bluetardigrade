package collector

import (
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
	"time"
)

func decodePhishingFixture(t *testing.T, headers, body string) map[string]string {
	t.Helper()
	d, err := NewDecoder("eml", "INERT-MAIL-LAB")
	if err != nil {
		t.Fatal(err)
	}
	ev, err := d.DecodeMail([]byte("From: sender@example.invalid\r\n"+headers+"\r\n\r\n"+body), time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	return ev.Attributes
}

func TestMailHTMLLinkEvidenceAndTransferDecoding(t *testing.T) {
	body := `<a title="quoted > text" HREF="https://login.example.invalid/session?token=target-secret#fragment"><span>https://bank.example.invalid/account?token=display-secret</span></a>`
	for _, encoding := range []string{"8bit", "base64", "quoted-printable"} {
		t.Run(encoding, func(t *testing.T) {
			encoded := body
			switch encoding {
			case "base64":
				encoded = base64.StdEncoding.EncodeToString([]byte(body))
			case "quoted-printable":
				encoded = strings.ReplaceAll(body, "=", "=3D")
			}
			a := decodePhishingFixture(t, "Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: "+encoding, encoded)
			if a["mail_html_link_host_mismatch"] != "true" || a["mail_html_link_mismatches"] != "bank.example.invalid -> login.example.invalid" {
				t.Fatalf("missing explainable link mismatch: %+v", a)
			}
			if strings.Contains(fmt.Sprint(a), "target-secret") || strings.Contains(fmt.Sprint(a), "display-secret") || strings.Contains(fmt.Sprint(a), "fragment") {
				t.Fatal("URL secrets were copied into indicators")
			}
		})
	}
}

func TestMailHTMLLinkMismatchRequiresAnExplicitDifferentURLHost(t *testing.T) {
	cases := []string{
		`<a href="https://BANK.EXAMPLE.INVALID./account">https://bank.example.invalid/help</a>`,
		`<a href="https://other.example.invalid">Sign in</a>`,
		`<a href="/account">https://bank.example.invalid/account</a>`,
		`<a href="javascript:alert('INERT')">https://bank.example.invalid</a>`,
		`<!-- <a href="https://other.example.invalid">https://bank.example.invalid</a> -->`,
		`<script>const fixture = '<a href="https://other.example.invalid">https://bank.example.invalid</a>';</script>`,
		`<a title=" href='https://other.example.invalid'" data-href="https://other.example.invalid" href=https://bank.example.invalid>https://bank.example.invalid</a>`,
		`<a disabled href='https://bank.example.invalid'>https://bank.example.invalid</a>`,
		`<a href="https://bank.example.invalid" href="https://other.example.invalid">https://bank.example.invalid</a>`,
		`<a href="https://other.example.invalid">https://bank.example.invalid Please sign in</a>`,
	}
	for _, body := range cases {
		a := decodePhishingFixture(t, "Content-Type: text/html", body)
		if a["mail_html_link_host_mismatch"] != "" {
			t.Errorf("invented visible URL mismatch for %q: %v", body, a)
		}
	}
	plain := decodePhishingFixture(t, "Content-Type: text/plain", `<a href="https://other.example.invalid">https://bank.example.invalid</a>`)
	if plain["mail_html_link_host_mismatch"] != "" {
		t.Fatal("plain text was treated as rendered anchor markup")
	}
}

func TestMailHTMLEntitiesAndSchemeRelativeURLsAreInspected(t *testing.T) {
	a := decodePhishingFixture(t, "Content-Type: text/html", `<a href="https://bank.example.invalid&#64;192.0.2.5/path?token=fixture-secret">Open account</a><a href="//xn--bcher-kva.example.invalid/login">https://bank.example.invalid</a>`)
	for _, key := range []string{"mail_url_credentials", "mail_url_ip_literal", "mail_url_punycode", "mail_html_link_host_mismatch"} {
		if a[key] != "true" {
			t.Errorf("missing %s in %v", key, a)
		}
	}
	if !strings.Contains(a["mail_urls"], "https://192.0.2.5/path") || strings.Contains(fmt.Sprint(a), "fixture-secret") || strings.Contains(a["mail_urls"], "@") {
		t.Fatal("entity URL destination was incorrect or credentials retained")
	}

	benign := decodePhishingFixture(t, "Content-Type: text/plain", "https://example.invalid/xn--path https://ordinary.example.invalid/login")
	if benign["mail_url_punycode"] != "" || benign["mail_url_credentials"] != "" {
		t.Fatal("URL path or ordinary URL invented hostname/userinfo signal")
	}
}

func TestMailAttachmentNameIndicatorsAreObservedWithoutPayload(t *testing.T) {
	cases := []struct {
		name string
		key  string
	}{
		{"invoice.pdf.exe ", "mail_attachment_double_extension"},
		// Deception edge (SEC-8): a space before the
		// active extension ("invoice.pdf .exe") used to defeat the
		// double-extension signal because the intermediate name was not
		// trimmed before the document-suffix check. Windows hides known
		// extensions, so the file still renders as "invoice.pdf" to the
		// victim — the indicator must fire.
		{"invoice.pdf .exe", "mail_attachment_double_extension"},
		{"report.docx\t.exe", "mail_attachment_double_extension"},
		{"invoice.xlsx .exe", "mail_attachment_double_extension"},
		{"agenda.DOCM", "mail_macro_capable_attachment"},
		{"budget.xlsb", "mail_macro_capable_attachment"},
		{"invoice\u202egnp.exe", "mail_attachment_name_bidi"},
	}
	for _, tc := range cases {
		t.Run(tc.key+"/"+tc.name, func(t *testing.T) {
			body := "--inert\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=\"" + tc.name + "\"\r\n\r\nINERT-PAYLOAD-NOT-READ\r\n--inert--\r\n"
			a := decodePhishingFixture(t, "Content-Type: multipart/mixed; boundary=inert", body)
			if a[tc.key] != "true" || a["mail_parts_not_inspected"] != "true" || !strings.Contains(a["mail_attachments"], tc.name) {
				t.Fatalf("incorrect attachment evidence: %+v", a)
			}
			if strings.Contains(fmt.Sprint(a), "INERT-PAYLOAD-NOT-READ") {
				t.Fatal("retained attachment payload")
			}
		})
	}
	a := decodePhishingFixture(t, "Content-Type: multipart/mixed; boundary=inert", "--inert\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=invoice.pdf\r\n\r\nINERT\r\n--inert--\r\n")
	for _, key := range []string{"mail_macro_capable_attachment", "mail_attachment_double_extension", "mail_attachment_name_bidi", "mail_risky_attachment"} {
		if a[key] != "" {
			t.Errorf("ordinary PDF invented %s", key)
		}
	}
}

func TestMailHTMLLinkEvidenceLimitsAndDuplicateEvidence(t *testing.T) {
	var body strings.Builder
	for i := range 101 {
		fmt.Fprintf(&body, `<a href="https://target%d.example.invalid">https://bank.example.invalid</a>`, i)
	}
	a := decodePhishingFixture(t, "Content-Type: text/html", body.String())
	if a["mail_parts_not_inspected"] != "true" || len(strings.Split(a["mail_html_link_mismatches"], "; ")) != 20 {
		t.Fatal("bounded link scan silently claimed full inspection")
	}
	repeated := strings.Repeat(`<a href="https://other.example.invalid">https://bank.example.invalid</a>`, 4)
	a = decodePhishingFixture(t, "Content-Type: text/html", repeated)
	if a["mail_html_link_mismatches"] != "bank.example.invalid -> other.example.invalid" {
		t.Fatal("duplicate host evidence multiplied the mismatch list")
	}
}
