package collector

import (
	"html"
	"net"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

// These expressions recognize explicit anchor markup, not rendered HTML or
// browser navigation. RE2 and the MIME text limits bound all scanning work.
var mailHTMLComments = regexp.MustCompile(`(?s)<!--.*?-->`)
var mailHTMLScripts = regexp.MustCompile(`(?is)<(?:script|style)\b[^>]*>.*?</(?:script|style)\s*>`)
var mailHTMLAnchors = regexp.MustCompile(`(?is)<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>(.*?)</a\s*>`)
var mailHTMLTags = regexp.MustCompile(`(?s)<[^>]*>`)

func (s *mailScan) inspectAttachmentName(filename string) {
	name := strings.ToLower(strings.TrimRight(filename, " .\t"))
	s.bidiName = s.bidiName || strings.ContainsRune(filename, '\u202e')
	suffix := filepath.Ext(name)
	switch suffix {
	case ".docm", ".dotm", ".xlsm", ".xltm", ".xlam", ".xlsb", ".pptm", ".potm", ".ppam", ".sldm":
		s.macroCapable = true
	}
	switch suffix {
	case ".exe", ".scr", ".com", ".bat", ".cmd", ".ps1", ".js", ".jse", ".vbs", ".vbe", ".wsf", ".hta", ".lnk", ".msi", ".dll":
		// A familiar document/image suffix immediately before an active
		// extension is explainable filename deception; no content is executed.
		// The intermediate name is trimmed of trailing blanks too: without
		// it, "invoice.pdf .exe" (a space before the active extension)
		// produced an Ext of ".pdf " and the deception indicator never
		// fired, while Windows still renders the file as "invoice.pdf"
		// (known extensions hidden). Found in the SEC-8 review.
		switch filepath.Ext(strings.TrimRight(strings.TrimSuffix(name, suffix), " .\t")) {
		case ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".rtf", ".csv", ".jpg", ".jpeg", ".png", ".gif", ".bmp":
			s.doubleExt = true
		}
	}
}

func hasPunycodeLabel(host string) bool {
	for _, label := range strings.Split(strings.ToLower(host), ".") {
		if strings.HasPrefix(label, "xn--") {
			return true
		}
	}
	return false
}

func httpURL(raw string) *url.URL {
	raw = strings.TrimSpace(html.UnescapeString(raw))
	if strings.IndexFunc(raw, unicode.IsSpace) >= 0 {
		return nil
	}
	if strings.HasPrefix(raw, "//") {
		raw = "https:" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || (strings.ToLower(u.Scheme) != "http" && strings.ToLower(u.Scheme) != "https") {
		return nil
	}
	return u
}

func mailURLHost(u *url.URL) string {
	return strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
}

func (s *mailScan) observeURL(u *url.URL) {
	if net.ParseIP(u.Hostname()) != nil {
		s.ipURL = true
	}
	s.credentialURL = s.credentialURL || u.User != nil
	s.punycodeURL = s.punycodeURL || hasPunycodeLabel(u.Hostname())
	// Indicators omit URL credentials, query tokens and fragments.
	u.User = nil
	u.RawQuery = ""
	u.ForceQuery = false
	u.Fragment = ""
	indicator := u.String()
	for _, existing := range s.urls {
		if existing == indicator {
			return
		}
	}
	if len(s.urls) >= 100 {
		s.notInspected = true
		return
	}
	s.urls = append(s.urls, indicator)
}

func (s *mailScan) inspectHTMLLinks(text string) {
	text = mailHTMLComments.ReplaceAllString(text, "")
	text = mailHTMLScripts.ReplaceAllString(text, "")
	anchors := mailHTMLAnchors.FindAllStringSubmatch(text, 101)
	if len(anchors) > 100 {
		s.notInspected = true
		anchors = anchors[:100]
	}
	for _, anchor := range anchors {
		href, ok := htmlAttribute(anchor[1], "href")
		if !ok {
			continue
		}
		target := httpURL(href)
		if target == nil {
			continue
		}
		s.observeURL(target)
		// Decode entities after stripping tags: an encoded '<' is literal
		// label text, not markup. Only an entire HTTP(S) URL label qualifies.
		label := mailHTMLTags.ReplaceAllString(anchor[2], "")
		visible := httpURL(label)
		if visible == nil || !strings.Contains(strings.ToLower(strings.TrimSpace(html.UnescapeString(label))), "://") {
			continue
		}
		shownHost, actualHost := mailURLHost(visible), mailURLHost(target)
		if shownHost == actualHost {
			continue
		}
		// Evidence contains only hostnames; credentials, paths and query
		// secrets are never copied from either URL into the mismatch list.
		entry := shownHost + " -> " + actualHost
		duplicate := false
		for _, existing := range s.linkMismatch {
			duplicate = duplicate || existing == entry
		}
		if !duplicate {
			if len(s.linkMismatch) >= 20 {
				s.notInspected = true
				continue
			}
			s.linkMismatch = append(s.linkMismatch, entry)
		}
	}
}

// htmlAttribute reads attribute boundaries and quoted values so a href-like
// string inside title/data-href cannot become navigation evidence. It is a
// conservative start-tag scanner, not a browser parser. Invalid markup is
// ignored rather than guessed; the first duplicate href follows HTML behavior.
func htmlAttribute(attrs, wanted string) (string, bool) {
	for len(attrs) > 0 {
		attrs = strings.TrimLeftFunc(attrs, unicode.IsSpace)
		if attrs == "" || attrs[0] == '/' {
			return "", false
		}
		end := strings.IndexFunc(attrs, func(r rune) bool { return unicode.IsSpace(r) || r == '=' || r == '/' })
		if end < 0 {
			return "", false
		}
		name := attrs[:end]
		attrs = strings.TrimLeftFunc(attrs[end:], unicode.IsSpace)
		if !strings.HasPrefix(attrs, "=") {
			if strings.EqualFold(name, wanted) {
				return "", false
			}
			continue
		}
		attrs = strings.TrimLeftFunc(attrs[1:], unicode.IsSpace)
		if attrs == "" {
			return "", false
		}
		value := ""
		if attrs[0] == '\'' || attrs[0] == '"' {
			quote := attrs[0]
			end = strings.IndexByte(attrs[1:], quote)
			if end < 0 {
				return "", false
			}
			value, attrs = attrs[1:end+1], attrs[end+2:]
		} else {
			end = strings.IndexFunc(attrs, unicode.IsSpace)
			if end < 0 {
				value, attrs = attrs, ""
			} else {
				value, attrs = attrs[:end], attrs[end:]
			}
		}
		if strings.EqualFold(name, wanted) {
			return value, true
		}
	}
	return "", false
}
