package enroll

import "github.com/Ruby570bocadito/bluetardigrade/internal/ingest"

// Gate adapts the registry to the ingest handshake (ingest.Enroller).
type Gate struct {
	Registry *Registry
	// Logf records every enrollment in the engine log (nil = silent).
	Logf func(format string, args ...any)
}

// Enroll implements ingest.Enroller.
func (g Gate) Enroll(token, host, peer string) (ingest.EnrollGrant, error) {
	got, err := g.Registry.Enroll(token, host, peer)
	if err != nil {
		g.logf("[ENROLL] refused host %q from %s: %v", host, peer, err)
		return ingest.EnrollGrant{}, err
	}
	g.logf("[ENROLL] host %s enrolled as %s (%s) from %s", host, got.Name, got.State, peer)
	return ingest.EnrollGrant{Name: got.Name, Credential: got.Credential, Active: got.State == Active}, nil
}

// Authenticate implements ingest.Enroller.
func (g Gate) Authenticate(credential string) (ingest.EnrollCheck, bool) {
	name, host, state, ok := g.Registry.Authenticate(credential)
	return ingest.EnrollCheck{Name: name, Host: host, State: string(state)}, ok
}

func (g Gate) logf(format string, args ...any) {
	if g.Logf != nil {
		g.Logf(format, args...)
	}
}
