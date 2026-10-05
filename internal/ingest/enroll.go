package ingest

// Enrollment at the handshake (-enroll, internal/enroll). A new sensor
// opens its first connection with "ENROLL <token> <host>" instead of
// AUTH. The engine answers with a credential of its own, bound to that
// host, and closes the connection; the sensor stores the credential and
// reconnects with "AUTH <credential>" like any per-sensor identity.
//
// A host waiting for approval gets {"ack":"pending"} and the connection
// is closed before any event: the sensor keeps its events in its spool
// and retries, so nothing is lost and nothing unapproved reaches the
// rules. A rejected or revoked credential fails like a wrong token, and
// revoking one closes the connections already open with it.
//
// ENROLL hands out a secret, so it is only accepted over TLS or from
// loopback: on a plain listener reachable from the network the
// credential would cross it in clear.

import (
	"encoding/json"
	"net"
	"strings"
)

// EnrollGrant is a successful enrollment.
type EnrollGrant struct {
	Name       string // identity stamped on the host's events
	Credential string // the secret the sensor connects with from now on
	Active     bool   // approved at once (token pattern); false = pending
}

// Enrollment states as the handshake sees them.
const (
	EnrollActive   = "active"
	EnrollPending  = "pending"
	EnrollRejected = "rejected"
	EnrollRevoked  = "revoked"
)

// EnrollCheck is what the registry knows about a credential.
type EnrollCheck struct {
	Name  string
	Host  string
	State string // EnrollActive, EnrollPending, EnrollRejected or EnrollRevoked
}

// Enroller is the enrollment registry as the handshake uses it.
type Enroller interface {
	// Enroll exchanges an enrollment token for a credential bound to
	// host. Its error is sent to the sensor, so it says what to fix.
	Enroll(token, host, peer string) (EnrollGrant, error)
	// Authenticate looks a credential up; ok is false when unknown.
	Authenticate(credential string) (check EnrollCheck, ok bool)
}

// SetEnroller turns enrollment on. Call before Serve. With an enroller
// every connection must authenticate: the engine hands out credentials,
// so anonymous streams are no longer accepted.
func (s *Server) SetEnroller(e Enroller) { s.enroller = e }

// Enrolled returns how many ENROLL handshakes succeeded.
func (s *Server) Enrolled() uint64 { return s.enrolledN.Load() }

// PendingRefused returns how many connections were closed because their
// host still waits for approval.
func (s *Server) PendingRefused() uint64 { return s.pendingN.Load() }

func isEnrollLine(line []byte) bool {
	return len(line) >= 7 && string(line[:7]) == "ENROLL "
}

// handleEnroll serves an ENROLL first line and always ends the
// connection: the sensor reconnects with the credential.
func (s *Server) handleEnroll(conn net.Conn, line []byte, peer string) {
	if s.enroller == nil {
		s.rejected.Add(1)
		writeAck(conn, errorAck("enrollment is off on this engine: start it with -enroll, or give the sensor an ingest token"))
		return
	}
	if !s.tls && !isLoopback(peer) {
		s.rejected.Add(1)
		writeAck(conn, errorAck("enrollment needs TLS (engine -ingest-cert, sensor --tls-ca) or a loopback connection: the credential it hands out must not cross the network in clear"))
		return
	}
	fields := strings.Fields(string(line[len("ENROLL "):]))
	if len(fields) != 2 {
		s.rejected.Add(1)
		writeAck(conn, errorAck("enrollment refused: send 'ENROLL <token> <host>' as the first line"))
		return
	}
	grant, err := s.enroller.Enroll(fields[0], fields[1], peer)
	if err != nil {
		s.rejected.Add(1)
		writeAck(conn, errorAck("enrollment refused: "+err.Error()))
		return
	}
	state := EnrollPending
	if grant.Active {
		state = EnrollActive
	}
	ack, _ := json.Marshal(map[string]string{
		"ack":        "enrolled",
		"identity":   grant.Name,
		"credential": grant.Credential,
		"state":      state,
	})
	s.enrolledN.Add(1)
	writeAck(conn, string(ack))
}

// authEnrolled checks a credential against the enrollment registry. It
// returns the identity of an approved host; for any other known state
// it answers the sensor and reports that the connection must close.
func (s *Server) authEnrolled(conn net.Conn, supplied string) (who *Identity, known bool) {
	if s.enroller == nil {
		return nil, false
	}
	chk, ok := s.enroller.Authenticate(supplied)
	if !ok {
		return nil, false
	}
	switch chk.State {
	case EnrollActive:
		return &Identity{
			Name:     chk.Name,
			hosts:    map[string]struct{}{strings.ToLower(chk.Host): {}},
			enrolled: true,
		}, true
	case EnrollPending:
		s.pendingN.Add(1)
		writeAck(conn, `{"ack":"pending","error":"this sensor is enrolled and waits for approval in the console (Equipos); its events stay in its spool until then"}`)
	default:
		s.rejected.Add(1)
		writeAck(conn, errorAck("auth failed: the enrollment of this sensor was "+chk.State+"; enroll it again with a new token"))
	}
	return nil, true
}

// trackIdentity remembers an open connection of an enrolled identity,
// so revoking the identity can close it; the returned func forgets it.
func (s *Server) trackIdentity(name string, conn net.Conn) func() {
	s.mu.Lock()
	if s.byIdentity == nil {
		s.byIdentity = map[string]map[net.Conn]struct{}{}
	}
	if s.byIdentity[name] == nil {
		s.byIdentity[name] = map[net.Conn]struct{}{}
	}
	s.byIdentity[name][conn] = struct{}{}
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		delete(s.byIdentity[name], conn)
		if len(s.byIdentity[name]) == 0 {
			delete(s.byIdentity, name)
		}
		s.mu.Unlock()
	}
}

// DropIdentity closes every open connection of an enrolled identity
// (its credential was rejected or revoked) and returns how many.
func (s *Server) DropIdentity(name string) int {
	s.mu.Lock()
	conns := make([]net.Conn, 0, len(s.byIdentity[name]))
	for c := range s.byIdentity[name] {
		conns = append(conns, c)
	}
	s.mu.Unlock()
	for _, c := range conns {
		_ = c.Close()
	}
	return len(conns)
}

// BoundIdentity names the identity of the -ingest-identities file that
// is explicitly bound to host, or "" (identities bound to every host
// are collectors and do not count).
func (s *Server) BoundIdentity(host string) string {
	ids := s.identities.Load()
	if ids == nil {
		return ""
	}
	h := strings.ToLower(host)
	for i := range *ids {
		if (*ids)[i].hosts == nil {
			continue
		}
		if _, ok := (*ids)[i].hosts[h]; ok {
			return (*ids)[i].Name
		}
	}
	return ""
}

func isLoopback(ip string) bool {
	p := net.ParseIP(ip)
	return p != nil && p.IsLoopback()
}
