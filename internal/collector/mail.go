package collector

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/textproto"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

const MaxMail = 10 << 20

var mailURLs = regexp.MustCompile(`(?i)https?://[^\s<>"']+`)
var reportedDMARCFail = regexp.MustCompile(`(?i)(?:^|[;\s])dmarc\s*=\s*fail(?:[;\s(]|$)`)

type mailScan struct {
	parts         int
	textBytes     int
	urls          []string
	attachments   []string
	risky         bool
	archives      bool
	notInspected  bool
	ipURL         bool
	credentialURL bool
}

// DecodeMail inspects bounded MIME text offline. It never visits URLs,
// resolves DNS, executes attachments or authenticates a sender.
func (d *Decoder) DecodeMail(raw []byte, imported time.Time) (*model.Event, error) {
	if d.Source != "eml" {
		return nil, errors.New("DecodeMail requires source eml")
	}
	if len(raw) == 0 || len(raw) > MaxMail {
		return nil, errors.New("EML must contain 1 byte..10 MiB")
	}
	end := bytes.Index(raw, []byte("\r\n\r\n"))
	if end < 0 {
		end = bytes.Index(raw, []byte("\n\n"))
	}
	if end < 0 || end > 64<<10 {
		return nil, errors.New("invalid or excessive EML headers")
	}
	message, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("invalid EML message")
	}
	from, err := mail.ParseAddressList(message.Header.Get("From"))
	if err != nil || len(from) != 1 {
		return nil, errors.New("EML requires exactly one valid From address")
	}
	if imported.IsZero() {
		return nil, errors.New("mail import timestamp required")
	}
	ts := imported.UTC()
	timeOrigin := "import_time"
	if declared, err := mail.ParseDate(message.Header.Get("Date")); err == nil && declared.Year() >= 1970 && declared.Year() <= 9999 {
		ts = declared
		timeOrigin = "declared_date"
	}
	ev := d.event(model.TypeEmailMessage, d.Observer, ts)
	a := ev.Attributes
	hash := sha256.Sum256(raw)
	// Keep each observer's evidence row distinct, while mail_sha256 below
	// identifies identical original bytes across observations.
	ev.ID = d.id(raw)
	put(a, "mail_sha256", hex.EncodeToString(hash[:]))
	put(a, "mail_from", from[0].Address)
	put(a, "mail_message_id", message.Header.Get("Message-ID"))
	put(a, "source_timestamp", message.Header.Get("Date"))
	put(a, "mail_time_origin", timeOrigin)
	put(a, "mail_imported_at", imported.UTC().Format(time.RFC3339Nano))
	subject, err := new(mime.WordDecoder).DecodeHeader(message.Header.Get("Subject"))
	if err != nil {
		subject = message.Header.Get("Subject")
	}
	put(a, "mail_subject", subject)
	if value := message.Header.Get("Reply-To"); value != "" {
		reply, err := mail.ParseAddressList(value)
		if err != nil {
			return nil, errors.New("invalid Reply-To address")
		}
		addresses := []string{}
		for _, addr := range reply {
			addresses = append(addresses, addr.Address)
			if !strings.EqualFold(addressDomain(from[0].Address), addressDomain(addr.Address)) {
				a["mail_reply_domain_mismatch"] = "true"
			}
		}
		put(a, "mail_reply_to", strings.Join(addresses, ", "))
	}
	for _, value := range message.Header["Authentication-Results"] {
		if reportedDMARCFail.MatchString(value) {
			a["mail_dmarc_reported_fail"] = "true"
			a["mail_auth_trust"] = "unverified_header"
		}
	}
	scan := &mailScan{}
	if err := scan.part(textproto.MIMEHeader(message.Header), message.Body, 0); err != nil {
		return nil, err
	}
	if len(scan.attachments) > 0 {
		put(a, "mail_attachments", strings.Join(scan.attachments, "; "))
	}
	if len(scan.urls) > 0 {
		put(a, "mail_urls", strings.Join(scan.urls, "\n"))
	}
	if scan.risky {
		a["mail_risky_attachment"] = "true"
	}
	if scan.archives {
		a["mail_archive_not_inspected"] = "true"
	}
	if scan.notInspected {
		a["mail_parts_not_inspected"] = "true"
	}
	if scan.ipURL {
		a["mail_url_ip_literal"] = "true"
	}
	if scan.credentialURL {
		a["mail_url_credentials"] = "true"
	}
	return ev, nil
}

func addressDomain(address string) string {
	i := strings.LastIndex(address, "@")
	if i < 0 {
		return ""
	}
	return strings.ToLower(address[i+1:])
}

func (s *mailScan) part(header textproto.MIMEHeader, body io.Reader, depth int) error {
	s.parts++
	if s.parts > 100 || depth > 10 {
		return errors.New("EML MIME nesting or part limit exceeded")
	}
	kind := header.Get("Content-Type")
	if kind == "" {
		kind = "text/plain"
	}
	media, params, err := mime.ParseMediaType(kind)
	if err != nil {
		return errors.New("invalid MIME Content-Type")
	}
	filename := params["name"]
	if disposition := header.Get("Content-Disposition"); disposition != "" {
		_, attrs, err := mime.ParseMediaType(disposition)
		if err != nil {
			return errors.New("invalid MIME disposition")
		}
		if attrs["filename"] != "" {
			filename = attrs["filename"]
		}
	}
	if filename != "" {
		s.attachments = append(s.attachments, filename)
		s.notInspected = true
		switch strings.ToLower(filepath.Ext(filename)) {
		case ".exe", ".scr", ".com", ".bat", ".cmd", ".ps1", ".js", ".jse", ".vbs", ".vbe", ".wsf", ".hta", ".lnk", ".msi", ".dll":
			s.risky = true
		case ".zip", ".rar", ".7z", ".gz", ".iso":
			s.archives = true
		}
		return nil
	}
	if strings.HasPrefix(media, "multipart/") {
		if params["boundary"] == "" {
			return errors.New("missing MIME boundary")
		}
		reader := multipart.NewReader(body, params["boundary"])
		for {
			part, err := reader.NextRawPart()
			if err == io.EOF {
				return nil
			}
			if err != nil {
				return errors.New("invalid MIME multipart body")
			}
			err = s.part(part.Header, part, depth+1)
			closeErr := part.Close()
			if err != nil {
				return err
			}
			if closeErr != nil {
				return errors.New("invalid MIME part")
			}
		}
	}
	if media != "text/plain" && media != "text/html" {
		s.notInspected = true
		return nil
	}
	charset := strings.ToLower(params["charset"])
	if charset != "" && charset != "utf-8" && charset != "us-ascii" {
		s.notInspected = true
		return nil
	}
	switch strings.ToLower(header.Get("Content-Transfer-Encoding")) {
	case "base64":
		body = base64.NewDecoder(base64.StdEncoding, body)
	case "quoted-printable":
		body = quotedprintable.NewReader(body)
	case "", "7bit", "8bit", "binary":
	default:
		s.notInspected = true
		return nil
	}
	text, err := io.ReadAll(io.LimitReader(body, (256<<10)+1))
	if err != nil {
		return errors.New("invalid MIME text encoding")
	}
	s.textBytes += len(text)
	if len(text) > 256<<10 || s.textBytes > 1<<20 {
		return errors.New("EML decoded text limit exceeded")
	}
	candidates := mailURLs.FindAllString(string(text), 101)
	if len(candidates) > 100 {
		s.notInspected = true
		candidates = candidates[:100]
	}
	for _, candidate := range candidates {
		u, err := url.Parse(strings.TrimRight(candidate, ".,);"))
		if err != nil || u.Hostname() == "" {
			continue
		}
		if net.ParseIP(u.Hostname()) != nil {
			s.ipURL = true
		}
		if u.User != nil {
			s.credentialURL = true
		}
		// Indicators omit URL credentials, query tokens and fragments.
		u.User = nil
		u.RawQuery = ""
		u.ForceQuery = false
		u.Fragment = ""
		if len(s.urls) >= 100 {
			s.notInspected = true
			break
		}
		s.urls = append(s.urls, u.String())
	}
	return nil
}
