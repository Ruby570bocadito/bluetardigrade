package ad

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"strings"

	"github.com/go-asn1-ber/asn1-ber"
	ldap "github.com/go-ldap/ldap/v3"

	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

// The connector's searches are PRODUCT LITERALS: no operator- or
// console-supplied value is ever interpolated into an LDAP filter
// (threat model §3, filter injection). The only variable part of a
// search is its BaseDN, which comes from the validated config file.
// The console's free-text object query runs against the LOCAL SQLite
// snapshot (store.QueryADObjects), so it can never compose LDAP.
const (
	filterUsers     = "(&(objectCategory=person)(objectClass=user))"
	filterComputers = "(objectCategory=computer)"
	filterGroups    = "(objectCategory=group)"
	filterOUs       = "(objectCategory=organizationalUnit)"

	attrName         = "sAMAccountName"
	attrUPN          = "userPrincipalName"
	attrDisplayName  = "displayName"
	attrMail         = "mail"
	attrSID          = "objectSid"
	attrUAC          = "userAccountControl"
	attrAdminCount   = "adminCount"
	attrPwdLastSet   = "pwdLastSet"
	attrLastLogon    = "lastLogonTimestamp"
	attrSPN          = "servicePrincipalName"
	attrEncTypes     = "msDS-SupportedEncryptionTypes"
	attrOS           = "operatingSystem"
	attrOSVersion    = "operatingSystemVersion"
	attrDNSHost      = "dNSHostName"
	attrWhenChanged  = "whenChanged"
	attrMember       = "member"
	attrDescription  = "description"
	attrOUDisplay    = "name"
	attrObjectClass  = "objectClass"
	attrIsCritical   = "isCriticalSystemObject"
	attrPrimaryGroup = "primaryGroupID"
)

// criticalPaging wraps go-ldap's ControlPaging so the control is sent
// with criticality TRUE (RFC 4511): a server or proxy that cannot page
// must FAIL the search instead of silently returning the whole subtree
// unpaginated. go-ldap's own struct cannot express that (its Encode
// hardcodes criticality false), so the BER packet is built here.
type criticalPaging struct {
	inner *ldap.ControlPaging
}

func (c *criticalPaging) GetControlType() string { return ldap.ControlTypePaging }

func (c *criticalPaging) Encode() *ber.Packet {
	pkt := c.inner.Encode()
	// RFC 4511 control ::= SEQUENCE { controlType, criticality,
	// controlValue }: the criticality boolean goes BETWEEN them.
	if len(pkt.Children) == 2 {
		crit := ber.NewBoolean(ber.ClassUniversal, ber.TypePrimitive, ber.TagBoolean, true, "Criticality (true)")
		pkt.Children = []*ber.Packet{pkt.Children[0], crit, pkt.Children[1]}
	}
	return pkt
}

func (c *criticalPaging) String() string {
	return "Control Type: RFC 2696 paged results (critical)"
}

// pageCap is the protocol-level safety valve of a paged search: the
// loop issues one page request at a time and STOPS as soon as the
// object cap is reached (an abandoned-cursor search with paging size
// zero closes the server-side iteration, mirroring what
// go-ldap's own paging helper does on early exit). The cap therefore
// bounds the directory traffic per sync, not just the memory after
// the fact.
func searchPaged(conn *ldap.Conn, req *ldap.SearchRequest, pageSize, objectCap int) (entries []*ldap.Entry, truncated bool, err error) {
	paging := &criticalPaging{inner: ldap.NewControlPaging(uint32(pageSize))}
	req.Controls = append(req.Controls, paging)
	defer func() { req.Controls = nil }()

	for {
		result, err := conn.Search(req)
		if err != nil {
			return entries, truncated, err
		}
		for _, e := range result.Entries {
			entries = append(entries, e)
			if objectCap > 0 && len(entries) >= objectCap {
				truncated = true
				break
			}
		}
		if truncated {
			// Close the server-side cursor (page size 0 = abandon) so a
			// capped sync does not leave the DC holding the iteration.
			paging.inner.PagingSize = 0
			if _, aerr := conn.Search(req); aerr != nil {
				return entries, truncated, aerr
			}
			return entries, truncated, nil
		}
		ctrl := ldap.FindControl(result.Controls, ldap.ControlTypePaging)
		if ctrl == nil {
			break // server does not page (small directory): everything arrived
		}
		cookie := ctrl.(*ldap.ControlPaging).Cookie
		if len(cookie) == 0 {
			break // final page
		}
		paging.inner.SetCookie(cookie)
	}
	return entries, false, nil
}

// connect opens the TLS-protected connection and performs the
// authenticated bind. It returns a live connection the caller closes.
// Every failure path closes the connection before returning.
func (c *Connector) connect(password string) (*ldap.Conn, error) {
	pool := x509.NewCertPool()
	pem, err := os.ReadFile(c.cfg.CAFile)
	if err != nil {
		return nil, fmt.Errorf("ad: read CA file: %w", err)
	}
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("ad: CA file %s holds no usable PEM certificate", c.cfg.CAFile)
	}
	// ServerName pins BOTH the handshake and the name the CA cert was
	// issued for: an impostor DC must not pass by IP or by a second
	// SAN the config never mentioned.
	tlsCfg := &tls.Config{
		RootCAs:    pool,
		ServerName: c.cfg.Server,
		MinVersion: tls.VersionTLS12,
	}
	scheme := "ldaps"
	if c.cfg.StartTLS {
		scheme = "ldap"
	}
	addr := fmt.Sprintf("%s://%s:%d", scheme, c.cfg.Server, c.cfg.Port)
	var conn *ldap.Conn
	if c.cfg.StartTLS {
		plain, err := ldap.DialURL(addr)
		if err != nil {
			return nil, fmt.Errorf("ad: dial %s: %w", addr, err)
		}
		conn = plain
		if err := conn.StartTLS(tlsCfg); err != nil {
			conn.Close()
			return nil, fmt.Errorf("ad: start TLS on %s: %w", addr, err)
		}
	} else {
		conn, err = ldap.DialURL(addr, ldap.DialWithTLSConfig(tlsCfg))
		if err != nil {
			return nil, fmt.Errorf("ad: dial %s: %w", addr, err)
		}
	}
	// The bind DN comes from the validated config, the password from
	// its file: neither is ever interpolated into an error message
	// (the ldap library's bind errors carry result codes, not
	// credentials, but the connector does not rely on that for its own
	// messages either).
	if err := conn.Bind(c.cfg.BindDN, password); err != nil {
		conn.Close()
		return nil, fmt.Errorf("ad: bind as the configured service account failed: %w", err)
	}
	return conn, nil
}

// syncRequest builds a paged, attributes-limited search over the base
// DN. Scope is always WholeSubtree and the filters are literals.
func syncRequest(base, filter string, attrs []string, pageSize int) *ldap.SearchRequest {
	return ldap.NewSearchRequest(
		base,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		0,  // SizeLimit 0: the connector's own cap governs (see searchPaged)
		30, // TimeLimit seconds: one page must not hang the sync loop
		false,
		filter,
		attrs,
		[]ldap.Control{}, // paging control is appended by searchPaged
	)
}

// searchResults is one synced directory slice.
type searchResults struct {
	objects   []*store.ADObject
	edges     []store.ADGroupEdge
	domainSID string
}

// attribute sets per kind: the connector reads ONLY what it needs —
// the directory is an evidence source, not a dumping ground.
var (
	userAttrs = []string{attrName, attrUPN, attrDisplayName, attrMail, attrSID, attrUAC,
		attrAdminCount, attrPwdLastSet, attrLastLogon, attrSPN, attrEncTypes,
		attrWhenChanged, attrPrimaryGroup, attrIsCritical, attrObjectClass}
	computerAttrs = []string{attrName, attrSID, attrUAC, attrOS, attrOSVersion,
		attrDNSHost, attrLastLogon, attrWhenChanged, attrDescription,
		attrPrimaryGroup, attrIsCritical, attrObjectClass}
	groupAttrs = []string{attrName, attrSID, attrMember, attrDescription,
		attrAdminCount, attrWhenChanged, attrIsCritical, attrObjectClass}
	ouAttrs = []string{attrOUDisplay, attrDescription, attrWhenChanged, attrObjectClass}
)

// fetchAll runs the four kind searches under one connection and one
// shared object cap, then converts entries into store rows.
func (c *Connector) fetchAll(conn *ldap.Conn) (*searchResults, bool, error) {
	res := &searchResults{}
	remaining := c.cfg.MaxObjects
	truncated := false

	type kindFetch struct {
		filter string
		attrs  []string
		kind   string
		build  func(*ldap.Entry) *store.ADObject
	}
	fetches := []kindFetch{
		{filterUsers, userAttrs, store.ADKindUser, userObject},
		{filterComputers, computerAttrs, store.ADKindComputer, computerObject},
		{filterGroups, groupAttrs, store.ADKindGroup, groupObject},
		{filterOUs, ouAttrs, store.ADKindOU, ouObject},
	}

	for _, f := range fetches {
		if remaining <= 0 {
			truncated = true
			break
		}
		entries, trunc, err := searchPaged(conn, syncRequest(c.cfg.BaseDN, f.filter, f.attrs, c.cfg.PageSize), c.cfg.PageSize, remaining)
		if err != nil {
			return nil, false, fmt.Errorf("ad: search %s: %w", f.kind, err)
		}
		if trunc {
			truncated = true
		}
		for _, e := range entries {
			dn := e.DN
			if !underBase(dn, c.cfg.BaseDN) {
				continue // defensive: the server scopes the search, the connector double-checks
			}
			if !c.ouAllowed(dn) {
				continue
			}
			obj := f.build(e)
			if obj == nil {
				continue
			}
			if f.kind == store.ADKindGroup {
				for _, m := range e.GetAttributeValues(attrMember) {
					res.edges = append(res.edges, store.ADGroupEdge{GroupDN: dn, MemberDN: m})
				}
			}
			res.objects = append(res.objects, obj)
			if sid := obj.SID; strings.HasPrefix(sid, "S-1-5-21-") {
				res.domainSID = domainPrefix(sid)
			}
		}
		remaining -= len(entries)
	}
	return res, truncated, nil
}

// ouAllowed applies the include/exclude OU filters to a DN. Include
// (when set) requires the object to live under at least one listed
// OU; Exclude prunes the listed subtrees afterwards.
func (c *Connector) ouAllowed(dn string) bool {
	if len(c.cfg.IncludeOUs) > 0 {
		ok := false
		for _, inc := range c.cfg.IncludeOUs {
			if underBase(dn, inc) {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	for _, exc := range c.cfg.ExcludeOUs {
		if underBase(dn, exc) {
			return false
		}
	}
	return true
}

// fileTime converts an AD large-integer timestamp (100ns units since
// 1601-01-01) to unix seconds. 0 and the "never" sentinel
// (0x7FFFFFFFFFFFFFFF) both map to 0 (unknown/never).
func fileTime(v int64) int64 {
	// v == math.MaxInt64 is the "never" sentinel some AD writers use;
	// anything non-positive is no information at all.
	if v <= 0 || v == math.MaxInt64 {
		return 0
	}
	const unixOffset = 11644473600 // seconds between 1601 and 1970
	return v/10_000_000 - unixOffset
}

// sidString renders the binary objectSid form into its canonical
// S-1-AUTHORITY-SUBAUTHORITY text (RFC-ish; the algorithm is the
// documented Windows SID layout).
func sidString(b []byte) string {
	if len(b) < 8 {
		return ""
	}
	rev := b[0]
	if rev != 1 && rev != 2 {
		return ""
	}
	subCount := int(b[1])
	if len(b) < 8+4*subCount {
		return ""
	}
	// Identifier authority: 6 bytes, big-endian (byte 2..7).
	auth := uint64(0)
	for i := 2; i < 8; i++ {
		auth = auth<<8 | uint64(b[i])
	}
	parts := make([]string, 0, subCount+2)
	parts = append(parts, fmt.Sprintf("S-%d-%d", rev, auth))
	for i := 0; i < subCount; i++ {
		sub := binary.LittleEndian.Uint32(b[8+4*i : 12+4*i])
		parts = append(parts, fmt.Sprintf("%d", sub))
	}
	return strings.Join(parts, "-")
}

// domainPrefix strips the RID: "S-1-5-21-A-B-C-RID" -> "S-1-5-21-A-B-C".
func domainPrefix(sid string) string {
	i := strings.LastIndex(sid, "-")
	if i <= 0 {
		return sid
	}
	return sid[:i]
}

// ridOf returns the last subauthority (the relative identifier).
func ridOf(sid string) (uint32, bool) {
	i := strings.LastIndex(sid, "-")
	if i < 0 || i == len(sid)-1 {
		return 0, false
	}
	var rid uint32
	for _, c := range sid[i+1:] {
		if c < '0' || c > '9' {
			return 0, false
		}
		rid = rid*10 + uint32(c-'0')
		if rid > math.MaxUint32/10 {
			return 0, false
		}
	}
	return rid, true
}

// attrInt parses one large-integer AD attribute.
func attrInt(e *ldap.Entry, name string) int64 {
	v := e.GetAttributeValue(name)
	if v == "" {
		return 0
	}
	var n int64
	if _, err := fmt.Sscanf(v, "%d", &n); err != nil {
		return 0
	}
	return n
}

// longAttr decodes an attribute the schema declares as INTEGER8 that
// servers may return either as a string or raw.
func longAttr(e *ldap.Entry, name string) int64 {
	return fileTime(attrInt(e, name))
}

func userObject(e *ldap.Entry) *store.ADObject {
	o := &store.ADObject{
		DN:          e.DN,
		Kind:        store.ADKindUser,
		Name:        e.GetAttributeValue(attrName),
		SID:         sidString(e.GetRawAttributeValue(attrSID)),
		UAC:         attrInt(e, attrUAC),
		AdminCount:  attrInt(e, attrAdminCount),
		PwdLastSet:  longAttr(e, attrPwdLastSet),
		LastLogon:   longAttr(e, attrLastLogon),
		SPNCount:    len(e.GetAttributeValues(attrSPN)),
		EncTypes:    attrInt(e, attrEncTypes),
		WhenChanged: longAttr(e, attrWhenChanged),
		Attributes:  map[string]string{},
	}
	for k, v := range map[string]string{
		"userPrincipalName": e.GetAttributeValue(attrUPN),
		"displayName":       e.GetAttributeValue(attrDisplayName),
		"mail":              e.GetAttributeValue(attrMail),
	} {
		if v != "" {
			o.Attributes[k] = v
		}
	}
	o.Attributes["servicePrincipalName"] = strings.Join(e.GetAttributeValues(attrSPN), "; ")
	return o
}

func computerObject(e *ldap.Entry) *store.ADObject {
	o := &store.ADObject{
		DN:   e.DN,
		Kind: store.ADKindComputer,
		// sAMAccountName of a machine account ends in '$'; the
		// console and the posture findings speak hostnames.
		Name:        strings.TrimSuffix(e.GetAttributeValue(attrName), "$"),
		SID:         sidString(e.GetRawAttributeValue(attrSID)),
		UAC:         attrInt(e, attrUAC),
		LastLogon:   longAttr(e, attrLastLogon),
		OS:          strings.TrimSpace(e.GetAttributeValue(attrOS) + " " + e.GetAttributeValue(attrOSVersion)),
		WhenChanged: longAttr(e, attrWhenChanged),
		Attributes:  map[string]string{},
	}
	if host := e.GetAttributeValue(attrDNSHost); host != "" {
		o.Attributes["dNSHostName"] = host
	}
	if desc := e.GetAttributeValue(attrDescription); desc != "" {
		o.Attributes["description"] = desc
	}
	return o
}

func groupObject(e *ldap.Entry) *store.ADObject {
	o := &store.ADObject{
		DN:          e.DN,
		Kind:        store.ADKindGroup,
		Name:        e.GetAttributeValue(attrName),
		SID:         sidString(e.GetRawAttributeValue(attrSID)),
		AdminCount:  attrInt(e, attrAdminCount),
		WhenChanged: longAttr(e, attrWhenChanged),
		Attributes:  map[string]string{},
	}
	if desc := e.GetAttributeValue(attrDescription); desc != "" {
		o.Attributes["description"] = desc
	}
	o.Attributes["member_count"] = fmt.Sprintf("%d", len(e.GetAttributeValues(attrMember)))
	return o
}

func ouObject(e *ldap.Entry) *store.ADObject {
	o := &store.ADObject{
		DN:          e.DN,
		Kind:        store.ADKindOU,
		Name:        e.GetAttributeValue(attrOUDisplay),
		WhenChanged: longAttr(e, attrWhenChanged),
		Attributes:  map[string]string{},
	}
	if desc := e.GetAttributeValue(attrDescription); desc != "" {
		o.Attributes["description"] = desc
	}
	return o
}
