package ad

import (
	"context"
	"errors"
	"fmt"
	"net"
	"testing"
	"time"
)

// silentListener accepts TCP connections and never says a word: the
// shape of a domain controller behind a half-open path, or of a port
// that is not LDAP at all.
func silentListener(t *testing.T) net.Listener {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	done := make(chan struct{})
	t.Cleanup(func() { close(done); ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				<-done
				conn.Close()
			}()
		}
	}()
	return ln
}

// within fails the test when fn has not returned after limit.
func within(t *testing.T, limit time.Duration, what string, fn func()) {
	t.Helper()
	finished := make(chan struct{})
	go func() { fn(); close(finished) }()
	select {
	case <-finished:
	case <-time.After(limit):
		t.Fatalf("%s did not return within %s", what, limit)
	}
}

// A server that accepts TCP and stays silent must not hold the caller
// past its deadline, on either transport.
func TestDialTLSGivesUpOnASilentServer(t *testing.T) {
	caPath, _ := testCertificates(t)
	for _, startTLS := range []bool{false, true} {
		ln := silentListener(t)
		cfg := validConfig(t)
		cfg.Server = "localhost"
		cfg.Port = ln.Addr().(*net.TCPAddr).Port
		cfg.CAFile = caPath
		cfg.StartTLS = startTLS
		ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
		within(t, 5*time.Second, fmt.Sprintf("dialTLS (starttls=%t)", startTLS), func() {
			conn, _, err := dialTLS(ctx, cfg)
			if err == nil {
				conn.Close()
				t.Errorf("starttls=%t: a silent server produced a connection", startTLS)
			}
		})
		cancel()
	}
}

// timeout_ms is the budget of the whole sign-in: a DC that completes
// TLS and then never answers the bind is a domain failure, in time.
func TestDomainLoginTimeoutCoversTheBind(t *testing.T) {
	s, cfg := loginFixture(t)
	s.muteBind = true
	cfg.TimeoutMS = 1000
	within(t, 6*time.Second, "DomainLogin", func() {
		_, err := DomainLogin(context.Background(), cfg, "jruiz", []byte("pw"))
		if !errors.Is(err, ErrLoginDomainDown) {
			t.Errorf("err = %v, want ErrLoginDomainDown", err)
		}
	})
}

// Start hands the first sync to the background (the engine calls it
// ahead of the API and the detection pipeline) and Stop abandons a
// handshake in flight instead of waiting it out.
func TestConnectorStartDoesNotWaitForTheFirstSync(t *testing.T) {
	ln := silentListener(t)
	caPath, _ := testCertificates(t)
	fake := &fixtureServer{listener: ln, bindDN: "CN=soc-reader,OU=Service Accounts," + fixtureBase}
	c, _ := newTestConnector(t, fake, caPath, nil)

	within(t, 2*time.Second, "Start", func() { c.Start(context.Background()) })
	if c.Snapshot().NextSyncAt == nil {
		t.Error("NextSyncAt must be promised as soon as Start returns")
	}
	within(t, 5*time.Second, "Stop", c.Stop)
	if st := c.Snapshot(); st.Connected || st.LastSuccessAt != nil {
		t.Errorf("status after an abandoned first sync = %+v", st)
	}
}

// A group above the server's MaxValRange comes back as
// "member;range=0-N": every slice must be followed, or the group syncs
// with no members at all.
func TestSyncFollowsMemberRanges(t *testing.T) {
	const bigDN = "CN=Todos,OU=Groups," + fixtureBase
	members := make([]string, 8)
	for i := range members {
		members[i] = fmt.Sprintf("CN=user%02d,OU=Users,%s", i, fixtureBase)
	}
	entries := append(testEntries(t), fixtureEntry{
		dn: bigDN,
		attrs: map[string][]string{
			"objectCategory": {"group"}, "objectClass": {"group"},
			"sAMAccountName": {"Todos"},
			"member":         members,
		},
	})
	s, caPath, _ := newFixtureServer(t, entries, true)
	defer s.close()
	s.rangeLimit = 3 // slices 0-2, 3-5, 6-*
	c, st := newTestConnector(t, s, caPath, nil)
	if err := c.SyncOnce(context.Background()); err != nil {
		t.Fatalf("sync: %v", err)
	}
	edges, err := st.ADGroupEdges()
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, e := range edges {
		if e.GroupDN == bigDN {
			got[e.MemberDN] = true
		}
	}
	if len(got) != len(members) {
		t.Fatalf("edges of the ranged group = %d, want %d", len(got), len(members))
	}
	obj, err := st.ADObjectByDN(bigDN)
	if err != nil || obj == nil {
		t.Fatalf("group object: %v %v", obj, err)
	}
	if obj.Attributes["member_count"] != "8" {
		t.Errorf("member_count = %q, want 8", obj.Attributes["member_count"])
	}
}

func TestParseRangeAttr(t *testing.T) {
	for _, tc := range []struct {
		name            string
		low, high       int
		last, wantRange bool
	}{
		{"member;range=0-1499", 0, 1499, false, true},
		{"member;range=1500-*", 1500, 0, true, true},
		{"Member;Range=3000-4499", 3000, 4499, false, true},
		{"member;binary;range=0-9", 0, 9, false, true},
		{"member", 0, 0, false, false},
		{"memberOf;range=0-1499", 0, 0, false, false},
		{"member;range=5-2", 0, 0, false, false},
		{"member;range=-1-2", 0, 0, false, false},
		{"member;range=abc", 0, 0, false, false},
	} {
		low, high, last, ok := parseRangeAttr(tc.name, "member")
		if ok != tc.wantRange || low != tc.low || high != tc.high || last != tc.last {
			t.Errorf("%q = (%d, %d, %t, %t), want (%d, %d, %t, %t)", tc.name, low, high, last, ok, tc.low, tc.high, tc.last, tc.wantRange)
		}
	}
}
