package collector

// SEC-7 (fuzzing of the input surfaces): fuzz targets for the EML mail
// path, the largest offline text parser in the engine. `go test` runs
// the seed corpus, so anything a fuzz session finds is pinned here as
// a seed for the normal suite.
//
// Properties under fuzz:
//   - DecodeMail never panics and either fails with a nil event or
//     returns a well-formed email event whose timestamp agrees with
//     the declared time origin.
//   - htmlAttribute never panics, only returns an attribute value when
//     the attribute name really appears as a name, and never returns
//     a value that swallows a following attribute name (quotes closed).
//   - inspectAttachmentName never panics and keeps its verdicts stable
//     for names that only differ in case (detection is case-insensitive
//     on purpose: Windows extensions are).

import (
	"net/mail"
	"strings"
	"testing"
	"time"
	"unicode"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func FuzzDecodeMail(f *testing.F) {
	f.Add([]byte("From: analyst@example.org\r\nSubject: report\r\nDate: Mon, 5 Oct 2026 10:00:00 +0000\r\nMessage-ID: <r@example.org>\r\n\r\nsee https://docs.example.org/guide\r\n"))
	f.Add([]byte("From: a@example.org\r\nSubject: =?utf-8?q?caf=C3=A9?=\r\n\r\nplain body\r\n"))
	f.Add([]byte("From: a@example.org\r\nReply-To: b@other.example\r\nAuthentication-Results: mx.example.org; dmarc=fail (p=quarantine)\r\n\r\nbody\r\n"))
	f.Add([]byte("From: a@example.org\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Disposition: attachment; filename=\"invoice.pdf .exe\"\r\n\r\nM\r\n--b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<a href=\"http://phish.example/x\">https://bank.example</a>\r\n--b--\r\n"))
	f.Add([]byte("From: a@example.org\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8gd29ybGQ=\r\n"))
	f.Add([]byte("From: a@example.org\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\ncaf=C3=A9=\r\n continuation\r\n"))
	f.Add([]byte("From: a@example.org\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: multipart/alternative; boundary=c\r\n\r\n--c\r\nContent-Type: text/html\r\n\r\n<a href='//deep.example'>x</a>\r\n--c--\r\n--b--\r\n"))
	f.Add([]byte("From: a@example.org\r\n\r\nhttps://user:pw@cred.example/p?a=1#f http://192.0.2.1/x http://xn--80ak6aa92e.example\r\n"))
	f.Add([]byte("From: a@example.org\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<a href=\"http://ok.example\" title=\"http://decoy.example\" data-href=\"http://decoy2.example\">text</a>\r\n"))
	f.Add([]byte("From: a@example.org\r\nContent-Disposition: attachment; filename=\"r\u202e fdp.exe\"\r\n\r\nx"))
	f.Add([]byte("From: a@example.org\r\nContent-Type: application/zip; name=\"a.exe\"\r\n\r\nPK\r\n"))
	f.Add([]byte("From: not-an-address\r\n\r\nbody"))
	f.Add([]byte("From: a@example.org\r\nReply-To: broken@@\r\n\r\nbody"))
	f.Add([]byte(""))
	f.Add([]byte("no blank line anywhere"))
	f.Add([]byte{0xFF, 0xFE, 'F', 'r', 'o', 'm', ':', ' ', 'a'})
	f.Add([]byte("From: a@example.org\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: x-strange\r\n\r\nbody"))
	f.Add([]byte("From: a@example.org\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nno closing boundary"))

	f.Fuzz(func(t *testing.T, raw []byte) {
		if len(raw) == 0 || len(raw) > 1<<20 {
			t.Skip()
		}
		d, err := NewDecoder("eml", "lab-host")
		if err != nil {
			t.Fatalf("NewDecoder(eml) failed: %v", err)
		}
		imported := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
		ev, err := d.DecodeMail(raw, imported)
		if err != nil {
			if ev != nil {
				t.Fatalf("DecodeMail returned error %v together with a non-nil event", err)
			}
			return
		}
		if ev == nil {
			t.Fatal("DecodeMail returned a nil event without an error")
		}
		if ev.Type != model.TypeEmailMessage {
			t.Fatalf("event type %q, want %q", ev.Type, model.TypeEmailMessage)
		}
		if ev.Attributes["mail_sha256"] == "" {
			t.Fatal("accepted mail without mail_sha256")
		}
		if _, err := mail.ParseAddressList(ev.Attributes["mail_from"]); err != nil {
			t.Fatalf("accepted mail_from %q that does not parse back", ev.Attributes["mail_from"])
		}
		switch ev.Attributes["mail_time_origin"] {
		case "import_time":
			if !ev.Timestamp.Equal(imported) {
				t.Fatalf("time origin import_time but timestamp %v != import %v", ev.Timestamp, imported)
			}
		case "declared_date":
			year := ev.Timestamp.Year()
			if year < 1970 || year > 9999 {
				t.Fatalf("declared_date accepted an out-of-range year %d", year)
			}
		default:
			t.Fatalf("unknown mail_time_origin %q", ev.Attributes["mail_time_origin"])
		}
	})
}

func FuzzHTMLAttribute(f *testing.F) {
	f.Add(`href="http://a.example"`, "href")
	f.Add(`class="x" href='http://b.example'`, "href")
	f.Add(`HREF=http://c.example`, "href")
	f.Add(`data-href="http://d.example"`, "href")
	f.Add(`title="href" href=e`, "href")
	f.Add(`href="unclosed`, "href")
	f.Add(`href = "spaced"`, "href")
	f.Add(`/href="after-slash"`, "href")
	f.Add(`href`, "href")
	f.Add(``, "href")
	f.Add(`x`, "href")
	f.Add(`a='b' c="d"`, "c")
	f.Add(`href="a\"b"`, "href")
	f.Add("0\v=0", "0") // separator runes the oracle must treat as spaces

	f.Fuzz(func(t *testing.T, attrs, wanted string) {
		got, ok := htmlAttribute(attrs, wanted)
		if !ok {
			return
		}
		// A returned value must belong to an attribute whose name was
		// actually present. Re-scan for the name: without an "=" the
		// bare name alone must not satisfy the lookup, so the value
		// can only be produced when some "=" follows the name.
		// htmlAttribute matches names with EqualFold, so the scan is
		// case-insensitive too.
		needle := strings.ToLower(wanted)
		found := false
		rest := strings.ToLower(attrs)
		for len(rest) > 0 {
			i := strings.Index(rest, needle)
			if i < 0 {
				break
			}
			after := rest[i+len(needle):]
			if !caseFollows(after) {
				trimmed := strings.TrimLeftFunc(after, unicode.IsSpace)
				if strings.HasPrefix(trimmed, "=") {
					found = true
					break
				}
			}
			rest = rest[i+len(needle):]
		}
		if !found {
			t.Fatalf("htmlAttribute(%q, %q) returned %q without a name= occurrence", attrs, wanted, got)
		}
	})
}

// caseFollows reports whether the byte after a wanted-name match
// extends the name (letters/digits/-), which would mean the hit is a
// longer name such as data-href for wanted "href".
func caseFollows(after string) bool {
	if after == "" {
		return false
	}
	c := after[0]
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-'
}

func FuzzInspectAttachmentName(f *testing.F) {
	f.Add("invoice.pdf .exe")
	f.Add("invoice.PDF .EXE")
	f.Add("resume.docm")
	f.Add("photo.jpg")
	f.Add("r\u202e fdp.exe")
	f.Add("archive.tar.gz")
	f.Add("setup.msi ")
	f.Add(".exe")
	f.Add("exe")
	f.Add("")
	f.Add("...exe")
	f.Add("a.exe.exe")
	f.Add("trojan.scr  \t.")

	f.Fuzz(func(t *testing.T, filename string) {
		s := &mailScan{}
		s.inspectAttachmentName(filename)
		l := &mailScan{}
		l.inspectAttachmentName(strings.ToLower(filename))
		// Detection is deliberately case-insensitive: the verdict for a
		// name must match the verdict for its lowercase form. Only the
		// fields inspectAttachmentName owns participate; risky/archives
		// are part()'s verdicts on the extension switch.
		if s.macroCapable != l.macroCapable || s.doubleExt != l.doubleExt || s.bidiName != l.bidiName {
			t.Fatalf("case-sensitive verdicts for %q: raw (macro=%v double=%v bidi=%v) vs lower (macro=%v double=%v bidi=%v)",
				filename, s.macroCapable, s.doubleExt, s.bidiName, l.macroCapable, l.doubleExt, l.bidiName)
		}
	})
}
