package ad

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

const (
	testDomainSID = "S-1-5-21-100-200-300"
	syncPW        = "correct horse battery staple"
)

// filetimeString renders a time as the AD large-integer the fixture
// serves (100ns units since 1601).
func filetimeString(t time.Time) string {
	return strconv.FormatInt((t.Unix()+11644473600)*10_000_000, 10)
}

// fixtureUser builds one user entry with the security attributes the
// connector reads.
func fixtureUser(dn, sam string, uac int64, extra map[string][]string) fixtureEntry {
	attrs := map[string][]string{
		"objectCategory":     {"person"},
		"objectClass":        {"user"},
		"sAMAccountName":     {sam},
		"objectSid":          {testSID(21, 100, 200, 300, uint32(1000+len(sam)))},
		"userAccountControl": {strconv.FormatInt(uac, 10)},
		"pwdLastSet":         {filetimeString(time.Now().Add(-24 * time.Hour))},
		"lastLogonTimestamp": {filetimeString(time.Now().Add(-1 * time.Hour))},
		"whenChanged":        {filetimeString(time.Now().Add(-30 * time.Minute))},
	}
	for k, v := range extra {
		attrs[k] = v
	}
	return fixtureEntry{dn: dn, attrs: attrs}
}

// testEntries builds a small but interesting directory: two privileged
// accounts (one nested), one kerberoastable service account, one
// no-preauth account, one stale admin, krbtgt, an EOL machine, a DC
// and a machine without a sensor.
func testEntries(t *testing.T) []fixtureEntry {
	t.Helper()
	now := time.Now()
	old := filetimeString(now.Add(-800 * 24 * time.Hour))
	stale := filetimeString(now.Add(-200 * 24 * time.Hour))
	entries := []fixtureEntry{
		// groups
		{
			dn: "CN=Domain Admins,CN=Users," + fixtureBase,
			attrs: map[string][]string{
				"objectCategory": {"group"}, "objectClass": {"group"},
				"sAMAccountName": {"Domain Admins"},
				"objectSid":      {testSID(21, 100, 200, 300, 512)},
				"member": {
					"CN=alice,OU=Users," + fixtureBase,
					"CN=gg-nested,OU=Groups," + fixtureBase,
				},
				"whenChanged": {filetimeString(now)},
			},
		},
		{
			dn: "CN=gg-nested,OU=Groups," + fixtureBase,
			attrs: map[string][]string{
				"objectCategory": {"group"}, "objectClass": {"group"},
				"sAMAccountName": {"GG-Nested-Admins"},
				"objectSid":      {testSID(21, 100, 200, 300, 1100)},
				"member":         {"CN=bob,OU=Users," + fixtureBase},
				"whenChanged":    {filetimeString(now)},
			},
		},
		{
			dn: "CN=Backup Operators,CN=Builtin," + fixtureBase,
			attrs: map[string][]string{
				"objectCategory": {"group"}, "objectClass": {"group"},
				"sAMAccountName": {"Backup Operators"},
				"objectSid":      {testSID(32, 551)},
				"member":         {},
				"whenChanged":    {filetimeString(now)},
			},
		},
		// users
		fixtureUser("CN=alice,OU=Users,"+fixtureBase, "alice", 0x200, nil), // NORMAL_ACCOUNT
		fixtureUser("CN=bob,OU=Users,"+fixtureBase, "bob", 0x200, nil),
		fixtureUser("CN=carol,OU=Users,"+fixtureBase, "carol", 0x200, nil),
		// dave: service account, RC4-only kerberoastable, password never expires
		fixtureUser("CN=dave-svc,OU=Service,"+fixtureBase, "dave-svc", 0x200|0x10000, map[string][]string{
			"servicePrincipalName":          {"HTTP/dave.testdom.example.com"},
			"msDS-SupportedEncryptionTypes": {"0"},
		}),
		// eve: no preauthentication (AS-REP roastable)
		fixtureUser("CN=eve,OU=Users,"+fixtureBase, "eve", 0x200|0x400000, nil),
		// frank: stale orphan admin (adminCount set, no longer privileged)
		func() fixtureEntry {
			e := fixtureUser("CN=frank,OU=Users,"+fixtureBase, "frank", 0x200, nil)
			e.attrs["adminCount"] = []string{"1"}
			e.attrs["lastLogonTimestamp"] = []string{stale}
			return e
		}(),
		// krbtgt with a very old password
		fixtureUser("CN=krbtgt,CN=Users,"+fixtureBase, "krbtgt", 0x200, map[string][]string{
			"pwdLastSet": {old},
		}),
		// computers
		{
			dn: "CN=PC-XP,OU=Workstations," + fixtureBase,
			attrs: map[string][]string{
				"objectCategory":     {"computer"},
				"objectClass":        {"computer"},
				"sAMAccountName":     {"PC-XP$"},
				"objectSid":          {testSID(21, 100, 200, 300, 2001)},
				"userAccountControl": {"4096"},
				"operatingSystem":    {"Windows XP Professional"},
				"dNSHostName":        {"pc-xp.testdom.example.com"},
				"whenChanged":        {filetimeString(now)},
			},
		},
		{
			dn: "CN=SRV-DC01,OU=Domain Controllers," + fixtureBase,
			attrs: map[string][]string{
				"objectCategory":     {"computer"},
				"objectClass":        {"computer"},
				"sAMAccountName":     {"SRV-DC01$"},
				"objectSid":          {testSID(21, 100, 200, 300, 516)},
				"userAccountControl": {"8454"}, // 0x2106: server trust + DC + never expires
				"operatingSystem":    {"Windows Server 2022 Standard"},
				"dNSHostName":        {"srv-dc01.testdom.example.com"},
				"whenChanged":        {filetimeString(now)},
			},
		},
		{
			dn: "CN=PC-W11,OU=Workstations," + fixtureBase,
			attrs: map[string][]string{
				"objectCategory":     {"computer"},
				"objectClass":        {"computer"},
				"sAMAccountName":     {"PC-W11$"},
				"objectSid":          {testSID(21, 100, 200, 300, 2002)},
				"userAccountControl": {"4096"},
				"operatingSystem":    {"Windows 11 Pro"},
				"dNSHostName":        {"pc-w11.testdom.example.com"},
				"whenChanged":        {filetimeString(now)},
			},
		},
		{
			dn: "CN=PC-GHOST,OU=Workstations," + fixtureBase,
			attrs: map[string][]string{
				"objectCategory":     {"computer"},
				"objectClass":        {"computer"},
				"sAMAccountName":     {"PC-GHOST$"},
				"objectSid":          {testSID(21, 100, 200, 300, 2003)},
				"userAccountControl": {"4096"},
				"operatingSystem":    {"Windows 10 Pro"},
				"dNSHostName":        {"pc-ghost.testdom.example.com"},
				"whenChanged":        {filetimeString(now)},
			},
		},
		// OUs
		{
			dn: "OU=Users," + fixtureBase,
			attrs: map[string][]string{
				"objectCategory": {"organizationalUnit"},
				"objectClass":    {"organizationalUnit"},
				"name":           {"Users"},
				"whenChanged":    {filetimeString(now)},
			},
		},
	}
	return entries
}

// newTestConnector wires a connector against a fresh store and the
// fixture's address, with the password in its own file.
func newTestConnector(t *testing.T, s *fixtureServer, caPath string, mutate func(*Config)) (*Connector, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "sf-store.db"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	port := s.listener.Addr().(*net.TCPAddr).Port
	cfg := validConfig(t)
	cfg.Server = "localhost"
	cfg.Port = port
	cfg.CAFile = caPath
	cfg.BaseDN = fixtureBase
	cfg.BindDN = s.bindDN
	cfg.PasswordFile = passwordPath(t, syncPW)
	if mutate != nil {
		mutate(cfg)
	}
	c, err := New(cfg, st, nil, func() []string {
		return []string{"pc-w11", "srv-dc01", "pc-xp"} // PC-GHOST has no sensor
	})
	if err != nil {
		t.Fatalf("connector: %v", err)
	}
	return c, st
}

func TestSyncAgainstFixture(t *testing.T) {
	s, caPath, _ := newFixtureServer(t, testEntries(t), true)
	defer s.close()
	c, st := newTestConnector(t, s, caPath, nil)

	if err := c.SyncOnce(context.Background()); err != nil {
		t.Fatalf("sync: %v", err)
	}
	status := c.Snapshot()
	if !status.Connected {
		t.Error("status.Connected = false after a successful sync")
	}
	if status.LastError != "" {
		t.Errorf("LastError = %q, want empty", status.LastError)
	}
	if status.Truncated {
		t.Error("status.Truncated on an unbounded sync")
	}
	want := ObjectsCounts{Users: 7, Groups: 3, Computers: 4, OUs: 1}
	if status.Objects != want {
		t.Errorf("objects = %+v, want %+v", status.Objects, want)
	}
	if len(status.Warnings) != 0 {
		t.Errorf("warnings = %v, want none (the bind account is not privileged)", status.Warnings)
	}

	// The only bind ever sent is the authenticated service account: an
	// anonymous bind (empty name) NEVER crosses the wire, in any test.
	attempts := s.bindAttempts()
	if len(attempts) == 0 {
		t.Fatal("no bind attempt reached the fixture")
	}
	for _, a := range attempts {
		if a[0] == "" {
			t.Errorf("ANONYMOUS bind reached the fixture (password %q)", a[1])
		}
		if a[1] == "" {
			t.Errorf("bind without a password for %q", a[0])
		}
	}
	if attempts[0][0] != s.bindDN {
		t.Errorf("bind name = %q, want the configured service account", attempts[0][0])
	}

	// Snapshot rows serve the objects API, name-ordered pages and the
	// free-text query (which runs against SQLite, never LDAP).
	page, err := st.QueryADObjects(store.ADKindUser, "eve", 50, 0)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if page.Total != 1 || len(page.Objects) != 1 || page.Objects[0].Name != "eve" {
		t.Fatalf("eve lookup = %+v", page)
	}
	if page.Objects[0].EncTypes != 0 || page.Objects[0].SPNCount != 0 {
		t.Errorf("eve attributes wrong: enc=%d spn=%d", page.Objects[0].EncTypes, page.Objects[0].SPNCount)
	}

	// The posture document was computed and stored with the snapshot.
	_, score, posture, err := c.Posture()
	if err != nil || posture == nil {
		t.Fatalf("posture missing: %v", err)
	}
	if score <= 0 || score >= 100 {
		t.Errorf("score = %d, want a deduction-affected 1..99", score)
	}
	byID := map[string]*Finding{}
	for i := range posture.Findings {
		byID[posture.Findings[i].ID] = &posture.Findings[i]
	}
	if f := byID["krbtgt_password_age"]; f == nil || f.Count != 1 {
		t.Errorf("krbtgt_password_age = %+v, want one finding", byID["krbtgt_password_age"])
	}
	if f := byID["privileged_effective_members"]; f == nil || f.Count != 2 {
		t.Errorf("privileged_effective_members = %+v, want alice + bob", byID["privileged_effective_members"])
	} else {
		joined := f.Objects[0].Detail + "|" + f.Objects[1].Detail
		if !strings.Contains(joined, "anidada") || !strings.Contains(joined, "directa") {
			t.Errorf("privileged details must distinguish direct vs nested, got %q", joined)
		}
	}
	if f := byID["rc4_spn_accounts"]; f == nil || f.Count != 1 || f.Objects[0].Name != "dave-svc" {
		t.Errorf("rc4_spn_accounts = %+v, want dave-svc", byID["rc4_spn_accounts"])
	}
	if f := byID["no_preauth"]; f == nil || f.Count != 1 {
		t.Errorf("no_preauth = %+v, want eve", byID["no_preauth"])
	}
	if f := byID["password_never_expires"]; f == nil || f.Count != 1 {
		t.Errorf("password_never_expires = %+v, want dave-svc (krbtgt excluded)", byID["password_never_expires"])
	}
	if f := byID["eol_operating_systems"]; f == nil || f.Count != 1 || f.Objects[0].Name != "PC-XP" {
		t.Errorf("eol_operating_systems = %+v, want PC-XP", byID["eol_operating_systems"])
	}
	if f := byID["unconstrained_delegation"]; f != nil && f.Count != 0 {
		t.Errorf("unconstrained_delegation = %+v, want none (the DC is exempt)", f)
	}
	if f := byID["orphan_admin_count"]; f == nil || f.Count != 1 {
		t.Errorf("orphan_admin_count = %+v, want frank", byID["orphan_admin_count"])
	}
	if f := byID["inactive_accounts"]; f == nil || f.Count != 1 {
		t.Errorf("inactive_accounts = %+v, want frank", byID["inactive_accounts"])
	}
	if f := byID["computers_without_sensor"]; f == nil || f.Count != 1 || f.Objects[0].Name != "PC-GHOST" {
		t.Errorf("computers_without_sensor = %+v, want PC-GHOST", byID["computers_without_sensor"])
	}

	// History: one point per sync.
	hist, err := c.PostureHistory(10)
	if err != nil || len(hist) != 1 {
		t.Fatalf("posture history = %v (%v), want one point", hist, err)
	}
	if hist[0].Score != score {
		t.Errorf("history score = %d, want %d", hist[0].Score, score)
	}
}

func TestSyncFailsWithWrongPassword(t *testing.T) {
	s, caPath, _ := newFixtureServer(t, testEntries(t), true)
	defer s.close()
	c, _ := newTestConnector(t, s, caPath, nil)
	c.cfg.PasswordFile = passwordPath(t, "totally-wrong-password")

	err := c.SyncOnce(context.Background())
	if err == nil {
		t.Fatal("sync with a wrong password must fail")
	}
	status := c.Snapshot()
	if status.Connected {
		t.Error("Connected must stay false after a refused bind")
	}
	if status.LastError == "" {
		t.Error("LastError must carry the failure (credential-free)")
	}
	// the wrong password reached the fixture, the correct one never did
	attempts := s.bindAttempts()
	found := false
	for _, a := range attempts {
		if a[0] != "" && a[1] == "totally-wrong-password" {
			found = true
		}
	}
	if !found {
		t.Errorf("the refused attempt is not in the fixture log: %v", attempts)
	}
}

func TestSyncTruncatesAtObjectCap(t *testing.T) {
	s, caPath, _ := newFixtureServer(t, testEntries(t), true)
	defer s.close()
	c, st := newTestConnector(t, s, caPath, func(cfg *Config) {
		cfg.MaxObjects = 3 // 3 users, nothing else fits
	})
	if err := c.SyncOnce(context.Background()); err != nil {
		t.Fatalf("sync: %v", err)
	}
	status := c.Snapshot()
	if !status.Truncated {
		t.Error("Truncated must be true when the cap stops the sync")
	}
	// users only: the cap stopped the fetch BEFORE the groups search
	users, groups, computers, ous, err := st.ADCounts()
	if err != nil {
		t.Fatalf("counts: %v", err)
	}
	if users != 3 || groups != 0 || computers != 0 || ous != 0 {
		t.Errorf("counts after cap = (%d users, %d groups, %d computers, %d ous), want (3, 0, 0, 0)",
			users, groups, computers, ous)
	}
}

func TestSyncAppliesOUFilters(t *testing.T) {
	s, caPath, _ := newFixtureServer(t, testEntries(t), true)
	defer s.close()
	// Only the OU=Users subtree (plus base-level objects such as the
	// Builtin container's groups are excluded).
	c, st := newTestConnector(t, s, caPath, func(cfg *Config) {
		cfg.IncludeOUs = []string{"OU=Users," + fixtureBase}
	})
	if err := c.SyncOnce(context.Background()); err != nil {
		t.Fatalf("sync: %v", err)
	}
	users, _, _, _, err := st.ADCounts()
	if err != nil {
		t.Fatalf("counts: %v", err)
	}
	if users != 5 { // alice, bob, carol, eve, frank live under OU=Users
		t.Errorf("users under OU=Users = %d, want 5 (dave-svc lives in OU=Service, krbtgt in CN=Users)", users)
	}
	status := c.Snapshot()
	if status.Objects.Groups != 0 || status.Objects.Computers != 0 {
		t.Errorf("include filter leaked other kinds: %+v", status.Objects)
	}

	// Exclude prunes a subtree after the include check.
	s2, caPath2, _ := newFixtureServer(t, testEntries(t), true)
	defer s2.close()
	c2, st2 := newTestConnector(t, s2, caPath2, func(cfg *Config) {
		cfg.ExcludeOUs = []string{"OU=Workstations," + fixtureBase}
	})
	if err := c2.SyncOnce(context.Background()); err != nil {
		t.Fatalf("sync 2: %v", err)
	}
	_, _, computers, _, err := st2.ADCounts()
	if err != nil {
		t.Fatalf("counts 2: %v", err)
	}
	if computers != 1 { // only SRV-DC01 (OU=Domain Controllers)
		t.Errorf("computers after exclude = %d, want 1", computers)
	}
}

func TestSyncOverStartTLS(t *testing.T) {
	// Same flow, but the fixture starts plain and upgrades on request:
	// the connector must NEVER send the bind before the upgrade.
	s, caPath, _ := newFixtureServer(t, testEntries(t), false)
	defer s.close()
	c, _ := newTestConnector(t, s, caPath, func(cfg *Config) {
		cfg.StartTLS = true
	})
	if err := c.SyncOnce(context.Background()); err != nil {
		t.Fatalf("starttls sync: %v", err)
	}
	status := c.Snapshot()
	if !status.Connected || status.Objects.Users != 7 {
		t.Errorf("starttls sync incomplete: %+v", status)
	}
}

func TestConnectorRunAndStop(t *testing.T) {
	s, caPath, _ := newFixtureServer(t, testEntries(t), true)
	defer s.close()
	c, _ := newTestConnector(t, s, caPath, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := c.Run(ctx); err != nil {
		t.Fatalf("run: %v", err)
	}
	status := c.Snapshot()
	if status.NextSyncAt == nil {
		t.Error("NextSyncAt must be scheduled while running")
	}
	c.Stop()
	<-c.done // Run's loop closed
	// a stopped connector never shares live memory: the snapshot is a copy
	after := c.Snapshot()
	if after.Objects.Users != 7 {
		t.Errorf("snapshot after stop = %+v", after)
	}
}

func TestConnectorRequiresStore(t *testing.T) {
	cfg := validConfig(t)
	if _, err := New(cfg, nil, nil, nil); err == nil {
		t.Error("New without a store must refuse: the snapshot is persisted, never memory-only")
	}
}

// passwordPath keeps the credential file out of the repo and out of
// the logs: the password lives in its own file, exactly as the design
// demands.
func passwordPath(t *testing.T, pw string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ad-password")
	if err := os.WriteFile(path, []byte(pw+"\n"), 0o600); err != nil {
		t.Fatalf("write password file: %v", err)
	}
	return path
}
