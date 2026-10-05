package ad

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

// Domain posture analysis (TODO AD-2): classical defensive-audit
// findings computed over the LOCAL snapshot the connector installed —
// the analysis never talks LDAP, so a posture read costs the domain
// controllers nothing.
//
// Severity weights and the 0-100 score: every finding deducts
//
//      critical: 10 × min(count, 3)    high: 6 × min(count, 4)
//      medium:    3 × min(count, 5)    low:   1 × min(count, 5)
//
// capped at 100 total. The caps keep one noisy class (a hundred
// stale accounts) from drowning the score when a targeted class (one
// unconstrained-delegation host) is the real emergency; the weights
// make every finding class visible the moment it appears.

const (
	severityCritical = "critical"
	severityHigh     = "high"
	severityMedium   = "medium"
	severityLow      = "low"
)

// uacFlag bits of userAccountControl the analysis reads.
const (
	uacAccountDisable     = 0x2
	uacDontExpirePassword = 0x10000
	uacTrustedForDeleg    = 0x80000
	uacServerTrustAccount = 0x2000 // domain controllers
	uacDontRequirePreauth = 0x400000
)

// AES bits of msDS-SupportedEncryptionTypes. A zero value means the
// attribute is unset, which on AD defaults to RC4-capable.
const (
	aes128Flag = 0x8
	aes256Flag = 0x10
	rc4Flag    = 0x4
)

// privilegedRIDs are the relative identifiers of the domain groups
// that confer administrative power (TODO list: Domain/Enterprise/
// Schema Admins) and the fixed builtin RIDs of the local-equivalent
// operator groups. GPO Creator Owners (520) is deliberately NOT in
// the list: it grants GPO authoring, not directory control.
var (
	domainPrivilegedRIDs = map[uint32]string{
		512: "Domain Admins",
		518: "Enterprise Admins",
		519: "Schema Admins",
	}
	builtinPrivilegedRIDs = map[uint32]string{
		544: "Administrators",
		548: "Account Operators",
		549: "Server Operators",
		550: "Print Operators",
		551: "Backup Operators",
	}
)

// eolOS substrings mark operating systems past their end of support.
// Matched case-insensitively against the operatingSystem attribute;
// the list is deliberately short and factual (no dates encoded: an
// OS either has a listed substring or it does not, and the check
// never blocks anything — it only reports).
var eolOS = []string{
	"windows 2000", "windows xp", "windows vista", "windows 7",
	"windows 8,", "windows 8 ", "windows 8.1",
	"windows server 2000", "windows server 2003", "windows server 2008",
	"windows server 2012", "windows small business server",
}

// AffectedObject is one directory object a finding touches.
type AffectedObject struct {
	DN     string `json:"dn"`
	Name   string `json:"name,omitempty"`
	Detail string `json:"detail,omitempty"`
}

// Finding is one posture finding class with its affected objects
// (capped: Count carries the true total).
type Finding struct {
	ID            string           `json:"id"`
	Title         string           `json:"title"`
	Severity      string           `json:"severity"`
	Description   string           `json:"description"`
	Remediation   string           `json:"remediation"`
	Count         int              `json:"count"`
	Objects       []AffectedObject `json:"objects"`
	TruncatedList bool             `json:"objects_truncated"`
}

// Posture is the full analysis document (the JSON wire shape).
type Posture struct {
	Score       int            `json:"score"`
	GeneratedAt int64          `json:"generated_at_unix"`
	Summary     map[string]int `json:"summary"` // severity -> finding count
	Findings    []Finding      `json:"findings"`
	Checked     int            `json:"objects_checked"`
}

func decodePosture(doc string) (*Posture, error) {
	var p Posture
	if err := json.Unmarshal([]byte(doc), &p); err != nil {
		return nil, fmt.Errorf("ad: decode posture: %w", err)
	}
	return &p, nil
}

// maxListedObjects caps how many affected objects one finding serves;
// the wire stays bounded even on a directory full of stale accounts.
const maxListedObjects = 50

// membership is the effective-privilege view of one snapshot: direct
// edges plus transitive group nesting, computed once per analysis.
type membership struct {
	// memberToGroups: member DN (lower) -> groups it is a DIRECT
	// member of. Nested membership is expanded through groupToGroups.
	memberToGroups map[string][]string
	// groupToGroups: group DN (lower) -> groups the group belongs to.
	groupToGroups map[string][]string
	// groupNames: group DN (lower) -> display name fallback.
	groupNames map[string]string
	// byLower: group DN (lower) -> object, so the walk's lookups are
	// case-insensitive whatever case the directory used in `member`.
	byLower map[string]*store.ADObject
}

func buildMembership(edges []store.ADGroupEdge, groups map[string]*store.ADObject) *membership {
	m := &membership{
		memberToGroups: map[string][]string{},
		groupToGroups:  map[string][]string{},
		groupNames:     map[string]string{},
	}
	for dn, g := range groups {
		m.groupNames[strings.ToLower(dn)] = g.Name
	}
	for _, e := range edges {
		mLower := strings.ToLower(e.MemberDN)
		// The VALUES stay in the directory's own case: they are looked
		// up through the case-insensitive index below. The KEYS are
		// lowercased because AD DNs are case-insensitive and the walk
		// deduplicates on the lowercase form.
		if _, isGroup := groups[e.MemberDN]; isGroup {
			m.groupToGroups[mLower] = append(m.groupToGroups[mLower], e.GroupDN)
		} else {
			m.memberToGroups[mLower] = append(m.memberToGroups[mLower], e.GroupDN)
		}
	}
	m.byLower = make(map[string]*store.ADObject, len(groups))
	for dn, g := range groups {
		m.byLower[strings.ToLower(dn)] = g
	}
	return m
}

// effectivePrivileged walks the nesting graph upward from one member
// and returns the privileged groups it effectively belongs to, with
// a note about whether the path is direct.
type privilegePath struct {
	Group  string // display name (sAMAccountName or canonical fallback)
	Direct bool   // the member is a direct member of THIS group
}

// effectivePrivileges returns the privileged groups one DN effectively
// belongs to. visited bounds the walk: a cycle in the directory data
// (never legal, always possible in a corrupted snapshot) cannot loop.
func (m *membership) effectivePrivileges(dn string, isGroup bool, groups map[string]*store.ADObject) []privilegePath {
	type queueItem struct {
		dn     string
		direct bool
	}
	start := strings.ToLower(dn)
	queue := []queueItem{{dn: start, direct: true}}
	visited := map[string]bool{}
	out := []privilegePath{}
	seenPriv := map[string]bool{}
	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]
		if visited[item.dn] {
			continue
		}
		visited[item.dn] = true
		var next []string
		if item.dn == start {
			next = m.directGroups(item.dn, isGroup)
		} else {
			next = m.groupToGroups[item.dn]
		}
		for _, g := range next {
			gLower := strings.ToLower(g)
			obj := m.byLower[gLower]
			priv, _ := isPrivilegedGroup(obj)
			if priv && !seenPriv[gLower] {
				seenPriv[gLower] = true
				name := obj.Name
				if name == "" {
					name = m.groupNames[gLower]
				}
				out = append(out, privilegePath{Group: name, Direct: item.dn == start})
			}
			if !visited[gLower] {
				queue = append(queue, queueItem{dn: gLower, direct: false})
			}
		}
	}
	return out
}

func (m *membership) directGroups(lower string, isGroup bool) []string {
	if isGroup {
		return m.groupToGroups[lower]
	}
	return m.memberToGroups[lower]
}

// isPrivilegedGroup classifies one group object by its SID's well
// known RIDs (the directory's own truth, not a name to be renamed).
func isPrivilegedGroup(g *store.ADObject) (bool, string) {
	if g == nil || g.SID == "" {
		return false, ""
	}
	rid, ok := ridOf(g.SID)
	if !ok {
		return false, ""
	}
	if strings.HasPrefix(g.SID, "S-1-5-32-") {
		if name, ok := builtinPrivilegedRIDs[rid]; ok {
			return true, name
		}
		return false, ""
	}
	if strings.HasPrefix(g.SID, "S-1-5-21-") {
		if name, ok := domainPrivilegedRIDs[rid]; ok {
			return true, name
		}
	}
	return false, ""
}

// analysisSnapshot is the in-memory slice the checks run on.
type analysisSnapshot struct {
	users     map[string]*store.ADObject
	computers map[string]*store.ADObject
	groups    map[string]*store.ADObject
	edges     []store.ADGroupEdge
	members   *membership
}

func (c *Connector) loadSnapshot(cap int) (*analysisSnapshot, error) {
	s := &analysisSnapshot{
		users:     map[string]*store.ADObject{},
		computers: map[string]*store.ADObject{},
		groups:    map[string]*store.ADObject{},
	}
	load := func(kind string, into map[string]*store.ADObject) error {
		page, err := c.store.QueryADObjects(kind, "", cap, 0)
		if err != nil {
			return err
		}
		for _, o := range page.Objects {
			into[o.DN] = o
		}
		return nil
	}
	if err := load(store.ADKindUser, s.users); err != nil {
		return nil, err
	}
	if err := load(store.ADKindComputer, s.computers); err != nil {
		return nil, err
	}
	if err := load(store.ADKindGroup, s.groups); err != nil {
		return nil, err
	}
	edges, err := c.store.ADGroupEdges()
	if err != nil {
		return nil, err
	}
	s.edges = edges
	s.members = buildMembership(edges, s.groups)
	return s, nil
}

func enabled(o *store.ADObject) bool {
	return o != nil && o.UAC&uacAccountDisable == 0
}

func isKrbtgt(o *store.ADObject) bool {
	return o != nil && strings.EqualFold(o.Name, "krbtgt")
}

// analyze computes every finding class. Finding order is fixed
// (severity first): the console renders a stable table.
func (c *Connector) analyze(now time.Time) (*Posture, error) {
	snap, err := c.loadSnapshot(c.cfg.MaxObjects)
	if err != nil {
		return nil, err
	}
	p := &Posture{
		GeneratedAt: now.Unix(),
		Summary:     map[string]int{},
		Findings:    []Finding{},
	}
	p.Checked = len(snap.users) + len(snap.computers) + len(snap.groups)

	p.Findings = append(p.Findings, c.findingPrivileged(snap))
	p.Findings = append(p.Findings, c.findingKrbtgtAge(snap, now))
	p.Findings = append(p.Findings, c.findingDelegation(snap))
	p.Findings = append(p.Findings, c.findingNoPreauth(snap))
	p.Findings = append(p.Findings, c.findingRC4Users(snap))
	p.Findings = append(p.Findings, c.findingEOL(snap))
	p.Findings = append(p.Findings, c.findingInactive(snap, now))
	p.Findings = append(p.Findings, c.findingNeverExpires(snap))
	p.Findings = append(p.Findings, c.findingCoverage(snap))
	p.Findings = append(p.Findings, c.findingOrphanAdmin(snap))

	sortFindings(p.Findings)
	for _, f := range p.Findings {
		if f.Count > 0 {
			p.Summary[f.Severity]++
		}
	}
	p.Score = 100
	for _, f := range p.Findings {
		p.Score -= deduction(f)
	}
	if p.Score < 0 {
		p.Score = 0
	}
	return p, nil
}

func deduction(f Finding) int {
	switch f.Severity {
	case severityCritical:
		return 10 * minInt(f.Count, 3)
	case severityHigh:
		return 6 * minInt(f.Count, 4)
	case severityMedium:
		return 3 * minInt(f.Count, 5)
	case severityLow:
		return 1 * minInt(f.Count, 5)
	}
	return 0
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// findingPrivileged lists the EFFECTIVE members of the privileged
// groups: nested membership included, which is exactly what an
// attacker escalates through and what name-based reviews miss.
func (c *Connector) findingPrivileged(snap *analysisSnapshot) Finding {
	f := Finding{
		ID:          "privileged_effective_members",
		Title:       "Miembros efectivos de grupos privilegiados",
		Severity:    severityHigh,
		Description: "Cuentas que pertenecen —directa o indirectamente— a Domain/Enterprise/Schema Admins o a los operadores integrados (Administrators, Account/Server/Print/Backup Operators). La membresía anidada es el camino habitual de escalada.",
		Remediation: "Revisa cada cuenta: los administradores del dominio deben ser pocas, con contrato justificado y sin usarse para tareas diarias. Vacía los grupos anidados que solo estaban ahí «porque siempre». Considera el modelo de tiers y cuentas de acceso temporal (just-in-time).",
		Objects:     []AffectedObject{},
	}
	// Walk every user and computer; each account appears ONCE with the
	// union of its privileged paths (Count counts accounts, not
	// memberships — the number the console shows must mean one thing).
	report := func(dn string, o *store.ADObject) {
		if !enabled(o) {
			return
		}
		paths := snap.members.effectivePrivileges(dn, false, snap.groups)
		if len(paths) == 0 {
			return
		}
		parts := make([]string, 0, len(paths))
		for _, path := range paths {
			kind := "anidada"
			if path.Direct {
				kind = "directa"
			}
			parts = append(parts, path.Group+" ("+kind+")")
		}
		f.add(AffectedObject{DN: dn, Name: o.Name, Detail: strings.Join(parts, ", ")})
	}
	for dn, u := range snap.users {
		report(dn, u)
	}
	for dn, comp := range snap.computers {
		report(dn, comp)
	}
	return f
}

// findingKrbtgtAge checks the KRBTGT account password age: the master
// key of the domain. Twice-rotation after a compromise is the classic
// remediation; an old password widens the golden-ticket window.
func (c *Connector) findingKrbtgtAge(snap *analysisSnapshot, now time.Time) Finding {
	f := Finding{
		ID:          "krbtgt_password_age",
		Title:       "Contraseña de krbtgt antigua",
		Severity:    severityCritical,
		Description: "La cuenta krbtgt cifra todos los tickets Kerberos del dominio. Cuanto más vieja es su contraseña, más tiempo sirve un ticket dorado robado.",
		Remediation: "Rota la contraseña de krbtgt DOS veces (con una sincronización de replicación completa entre ambas) para invalidar cualquier ticket dorado que pudiera existir. Hazlo en una ventana de mantenimiento: la rotación doble invalida también tickets legítimos si se hace de golpe.",
		Objects:     []AffectedObject{},
	}
	for dn, u := range snap.users {
		if !isKrbtgt(u) {
			continue
		}
		if u.PwdLastSet == 0 {
			f.add(AffectedObject{DN: dn, Name: u.Name, Detail: "sin fecha de contraseña registrada"})
			continue
		}
		age := now.Sub(time.Unix(u.PwdLastSet, 0))
		if age > time.Duration(c.cfg.KrbtgtMaxAgeDays)*24*time.Hour {
			f.add(AffectedObject{DN: dn, Name: u.Name, Detail: fmt.Sprintf("último cambio hace %d días", int(age.Hours()/24))})
		}
	}
	return f
}

// findingDelegation reports unconstrained delegation (TRUSTED_FOR_
// DELEGATION) on non-DC objects: an object with it exposes its TGT to
// anyone who makes it authenticate, and that ticket opens the domain.
func (c *Connector) findingDelegation(snap *analysisSnapshot) Finding {
	f := Finding{
		ID:          "unconstrained_delegation",
		Title:       "Delegación sin restricciones",
		Severity:    severityCritical,
		Description: "Objetos con delegación Kerberos sin restricciones (fuera de los controladores de dominio, donde es inherente). Si alguien hace que ese equipo autentique contra él, recibe su ticket completo.",
		Remediation: "Quita la delegación sin restricciones; si un servicio necesita suplantar clientes, usa delegación restringida (S4U o Kerberos concret) limitada a los SPN necesarios. Los servidores con esta marca suelen ser legacy de impresión o web.",
		Objects:     []AffectedObject{},
	}
	check := func(dn string, o *store.ADObject) {
		if !enabled(o) {
			return
		}
		if o.UAC&uacServerTrustAccount != 0 {
			return // domain controller: inherent, not a finding
		}
		if o.UAC&uacTrustedForDeleg != 0 {
			f.add(AffectedObject{DN: dn, Name: o.Name})
		}
	}
	for dn, u := range snap.users {
		check(dn, u)
	}
	for dn, comp := range snap.computers {
		check(dn, comp)
	}
	return f
}

// findingNoPreauth reports accounts that do not require Kerberos
// pre-authentication: their AS-REP can be cracked offline.
func (c *Connector) findingNoPreauth(snap *analysisSnapshot) Finding {
	f := Finding{
		ID:          "no_preauth",
		Title:       "Cuentas sin preautenticación Kerberos",
		Severity:    severityHigh,
		Description: "Cuentas con «No requerir preautenticación Kerberos» activo. Cualquiera puede pedir su AS-REP y romper la contraseña sin pasar por el controlador de dominio.",
		Remediation: "Desmarca «No requerir preautenticación Kerberos» en cada cuenta. Si algún servicio legacy la necesita, aisla esa cuenta (grupo aparte, contraseña larga aleatoria) y planifica su retirada.",
		Objects:     []AffectedObject{},
	}
	for dn, u := range snap.users {
		if enabled(u) && u.UAC&uacDontRequirePreauth != 0 {
			f.add(AffectedObject{DN: dn, Name: u.Name})
		}
	}
	return f
}

// findingRC4Users reports user accounts WITH servicePrincipalName
// whose encryption types allow RC4 (unset attribute = legacy RC4
// default): those SPNs are kerberoastable and the returned ticket
// breaks offline.
func (c *Connector) findingRC4Users(snap *analysisSnapshot) Finding {
	f := Finding{
		ID:          "rc4_spn_accounts",
		Title:       "Cuentas de usuario con SPN y RC4 permitido",
		Severity:    severityHigh,
		Description: "Cuentas de usuario con SPN cuyo tipo de cifrado admite RC4 (o no declara AES). Un ticket de servicio RC4 se pide sin autenticar el resto y se rompe sin conexión (kerberoasting).",
		Remediation: "Añade AES a las cuentas de servicio (msDS-SupportedEncryptionTypes con 0x08/0x10) y rota su contraseña; quita los SPN que no se usan. Las contraseñas de servicio deben ser largas y aleatorias (25+ caracteres) para que el ataque no sea viable mientras tanto.",
		Objects:     []AffectedObject{},
	}
	for dn, u := range snap.users {
		if !enabled(u) || u.SPNCount == 0 {
			continue
		}
		if u.EncTypes&(aes128Flag|aes256Flag) == 0 {
			detail := "sin AES declarado"
			if u.EncTypes&rc4Flag != 0 {
				detail = "RC4 habilitado y sin AES"
			}
			f.add(AffectedObject{DN: dn, Name: u.Name, Detail: detail})
		}
	}
	return f
}

// findingEOL reports domain computers running past-end-of-support
// operating systems (they stop receiving security patches).
func (c *Connector) findingEOL(snap *analysisSnapshot) Finding {
	f := Finding{
		ID:          "eol_operating_systems",
		Title:       "Equipos con sistema operativo sin soporte",
		Severity:    severityHigh,
		Description: "Equipos del dominio cuyo sistema operativo dejó de recibir parches de seguridad.",
		Remediation: "Aísla o retira los equipos con SO sin soporte; si un equipo no puede actualizarse, compensa con segmentación de red e invisibilidad desde el resto del dominio hasta su sustitución.",
		Objects:     []AffectedObject{},
	}
	for dn, comp := range snap.computers {
		if !enabled(comp) || comp.OS == "" {
			continue
		}
		lower := strings.ToLower(comp.OS)
		for _, bad := range eolOS {
			if strings.Contains(lower, bad) {
				f.add(AffectedObject{DN: dn, Name: comp.Name, Detail: comp.OS})
				break
			}
		}
	}
	return f
}

// findingInactive reports enabled accounts without a recent
// lastLogonTimestamp (the replicated approximation AD provides).
func (c *Connector) findingInactive(snap *analysisSnapshot, now time.Time) Finding {
	f := Finding{
		ID:          "inactive_accounts",
		Title:       "Cuentas inactivas",
		Severity:    severityMedium,
		Description: "Cuentas habilitadas sin inicios de sesión registrados en el umbral configurado (o sin ninguno registrado nunca). Son el objetivo favorito de un atacante: nadie nota su uso.",
		Remediation: "Deshabilita (no borres todavía) las cuentas sin uso tras comprobar con su responsable que no hacen falta; aplica la política de bloqueo de cuentas inactivas y revisa las excepciones cada trimestre.",
		Objects:     []AffectedObject{},
	}
	threshold := now.Add(-time.Duration(c.cfg.InactiveDays) * 24 * time.Hour)
	for dn, u := range snap.users {
		if !enabled(u) || isKrbtgt(u) {
			continue
		}
		switch {
		case u.LastLogon == 0:
			f.add(AffectedObject{DN: dn, Name: u.Name, Detail: "sin registro de inicio de sesión"})
		case time.Unix(u.LastLogon, 0).Before(threshold):
			days := int(now.Sub(time.Unix(u.LastLogon, 0)).Hours() / 24)
			f.add(AffectedObject{DN: dn, Name: u.Name, Detail: fmt.Sprintf("sin iniciar sesión hace %d días", days)})
		}
	}
	return f
}

// findingNeverExpires reports enabled accounts whose password never
// expires (krbtgt excluded: it is covered by its own finding and the
// rotation guidance is different).
func (c *Connector) findingNeverExpires(snap *analysisSnapshot) Finding {
	f := Finding{
		ID:          "password_never_expires",
		Title:       "Contraseñas que no caducan",
		Severity:    severityMedium,
		Description: "Cuentas de usuario habilitadas con «La contraseña nunca expira». Con el tiempo se convierten en contraseñas que nadie ha cambiado nunca.",
		Remediation: "Revisa cada cuenta: las de servicio deben tener contraseña gestionada (o larga y rotada por documentación), las de persona deberían caducar como el resto. Marca las que están justificadas y deja el resto con caducidad.",
		Objects:     []AffectedObject{},
	}
	for dn, u := range snap.users {
		if enabled(u) && !isKrbtgt(u) && u.UAC&uacDontExpirePassword != 0 {
			f.add(AffectedObject{DN: dn, Name: u.Name})
		}
	}
	return f
}

// findingCoverage compares the directory's computers with the hosts
// the engine actually receives telemetry from.
func (c *Connector) findingCoverage(snap *analysisSnapshot) Finding {
	f := Finding{
		ID:          "computers_without_sensor",
		Title:       "Equipos del dominio sin sensor",
		Severity:    severityMedium,
		Description: "Equipos del dominio de los que el motor no recibe telemetría: puntos ciegos de la vigilancia.",
		Remediation: "Instala el sensor en esos equipos (alta por token desde la consola) o documenta por qué quedan fuera (apagados permanentes, servicios con otro agente corporativo...). La cobertura del 100% del dominio es el objetivo.",
		Objects:     []AffectedObject{},
	}
	if c.sensorHosts == nil {
		return f
	}
	known := map[string]bool{}
	for _, h := range c.sensorHosts() {
		known[strings.ToLower(h)] = true
	}
	if len(known) == 0 {
		return f // no fleet data yet: nothing to compare against
	}
	for dn, comp := range snap.computers {
		if !enabled(comp) {
			continue
		}
		name := strings.TrimSuffix(comp.Name, "$")
		host := name
		if h, ok := comp.Attributes["dNSHostName"]; ok && h != "" {
			host = strings.SplitN(h, ".", 2)[0]
		}
		if !known[strings.ToLower(name)] && !known[strings.ToLower(host)] {
			detail := "sin telemetría del sensor"
			if host != name {
				detail += " (DNS: " + host + ")"
			}
			f.add(AffectedObject{DN: dn, Name: name, Detail: detail})
		}
	}
	return f
}

// findingOrphanAdmin reports enabled accounts with adminCount=1 that
// are no longer effective members of any privileged group: the flag
// outlived the privilege (and its protections often do not).
func (c *Connector) findingOrphanAdmin(snap *analysisSnapshot) Finding {
	f := Finding{
		ID:          "orphan_admin_count",
		Title:       "adminCount huérfano",
		Severity:    severityLow,
		Description: "Cuentas con el atributo adminCount=1 que ya no pertenecen a ningún grupo privilegiado: fueron privilegiadas y la limpieza no fue completa.",
		Remediation: "Si la cuenta no necesita privilegios, limpia adminCount y revisa su ACL heredada y su contraseña (que el cambio de grupo no limpió). Si la necesita, devuélvela a su grupo.",
		Objects:     []AffectedObject{},
	}
	for dn, u := range snap.users {
		if !enabled(u) || u.AdminCount == 0 {
			continue
		}
		if len(snap.members.effectivePrivileges(dn, false, snap.groups)) == 0 {
			f.add(AffectedObject{DN: dn, Name: u.Name})
		}
	}
	return f
}

// add appends one affected object, capping the served list.
func (f *Finding) add(o AffectedObject) {
	f.Count++
	if len(f.Objects) < maxListedObjects {
		f.Objects = append(f.Objects, o)
	} else {
		f.TruncatedList = true
	}
}

// computePosture runs the analysis and stores the document + the
// history point. Called after every completed sync.
func (c *Connector) computePosture() error {
	p, err := c.analyze(time.Now())
	if err != nil {
		return err
	}
	doc, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("ad: encode posture: %w", err)
	}
	return c.store.SaveADPostureJSON(p.GeneratedAt, p.Score, string(doc))
}

// privilegedAccountWarnings observes the connector's own bind
// account: a reader account that is ALSO effectively privileged is a
// misuse waiting to be abused (threat model §3: "de solo lectura a
// escritura"). The mitigation reported here is a WARNING; refusing to
// operate awaits the owner's decision on how write rights are to be
// checked (documented in the round report).
func (c *Connector) privilegedAccountWarnings(res *searchResults) []string {
	bind, err := c.store.ADObjectByDN(c.cfg.BindDN)
	if err != nil || bind == nil {
		return []string{} // the account is not part of the synced scope: nothing to say
	}
	groups := map[string]*store.ADObject{}
	for _, o := range res.objects {
		if o.Kind == store.ADKindGroup {
			groups[o.DN] = o
		}
	}
	snap := &analysisSnapshot{
		users:   map[string]*store.ADObject{bind.DN: bind},
		groups:  groups,
		members: buildMembership(res.edges, groups),
	}
	warnings := []string{}
	for _, path := range snap.members.effectivePrivileges(bind.DN, false, groups) {
		warnings = append(warnings, fmt.Sprintf(
			"la cuenta de servicio del conector pertenece al grupo privilegiado %q: debe ser un usuario del dominio sin privilegios (solo lectura)",
			path.Group))
	}
	return warnings
}

// sortFindings is applied before the document is stored so the wire
// order never depends on map iteration: severity weight, then count
// descending, then id.
func sortFindings(fs []Finding) {
	sort.SliceStable(fs, func(i, j int) bool {
		a, b := severityWeight(fs[i].Severity), severityWeight(fs[j].Severity)
		if a != b {
			return a > b
		}
		if fs[i].Count != fs[j].Count {
			return fs[i].Count > fs[j].Count
		}
		return fs[i].ID < fs[j].ID
	})
}

func severityWeight(s string) int {
	switch s {
	case severityCritical:
		return 3
	case severityHigh:
		return 2
	case severityMedium:
		return 1
	}
	return 0
}
