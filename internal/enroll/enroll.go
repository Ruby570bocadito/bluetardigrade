// Package enroll lets a new sensor join the fleet with an enrollment
// token instead of a hand-made ingest identity (-enroll).
//
// An operator creates a token in the console: single use or N uses,
// with an expiry, optionally with a hostname pattern that is approved
// without a human. The sensor opens its first connection with
// "ENROLL <token> <host>" and receives a credential of its own, bound
// to that host. From then on it connects with "AUTH <credential>"
// like any per-sensor identity. A new host starts pending: the engine
// takes none of its events until an administrator approves it, and the
// sensor keeps them in its spool meanwhile. Approving, rejecting and
// revoking are recorded with who did it; a revoked credential stops
// working at once and its open connections are closed.
//
// Only SHA-256 digests of tokens and credentials are kept. The state
// lives in one JSON file written atomically (temp file + rename) on
// every change, so a crash never leaves half a registry behind. A
// malformed file stops the engine at startup: silently starting empty
// would lock out every enrolled sensor.
package enroll

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
)

// State is where an enrolled host stands.
type State string

const (
	// Pending: enrolled, waiting for an administrator.
	Pending State = "pending"
	// Active: approved; its credential authenticates.
	Active State = "active"
	// Rejected: an administrator refused it while pending.
	Rejected State = "rejected"
	// Revoked: its credential was withdrawn after approval (or while
	// pending, by a revoke).
	Revoked State = "revoked"
)

const (
	// MaxTokens caps the tokens kept (used up and expired included).
	MaxTokens = 1000
	// MaxHosts caps the enrolled hosts, whatever their state.
	MaxHosts = 10000
	// MaxPending caps hosts waiting for approval, so a leaked
	// multi-use token cannot fill the approval queue.
	MaxPending = 1000
	// MaxUses caps the uses of one token (a GPO rollout).
	MaxUses = 10000
	// MinTTL and MaxTTL bound a token's lifetime.
	MinTTL = time.Hour
	MaxTTL = 30 * 24 * time.Hour
	// DefaultTTL is used when the request names none.
	DefaultTTL = 24 * time.Hour

	maxLabelRunes   = 64
	maxPatternRunes = 64
	maxHostLen      = 253
	maxByRunes      = 64
	maxFileBytes    = 16 << 20

	// TokenPrefix marks enrollment tokens and CredentialPrefix the
	// credentials they are exchanged for: a secret scanner (and a
	// human) recognizes them, and pasting one where the other belongs
	// fails with a clear message.
	TokenPrefix      = "btenroll_"
	CredentialPrefix = "btsensor_"
)

// Token is one enrollment token as the API shows it: the secret itself
// is only returned once, by CreateToken.
type Token struct {
	ID          string    `json:"id"`
	Label       string    `json:"label"`
	MaxUses     int       `json:"max_uses"`
	Uses        int       `json:"uses"`
	AutoApprove string    `json:"auto_approve,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedBy   string    `json:"created_by,omitempty"`
	Revoked     bool      `json:"revoked,omitempty"`
	RevokedBy   string    `json:"revoked_by,omitempty"`
	// Status is derived: active, expired, used_up or revoked.
	Status string `json:"status,omitempty"`
}

// Host is one enrolled host as the API shows it.
type Host struct {
	// Name is the ingest identity stamped on its events.
	Name         string     `json:"name"`
	Host         string     `json:"host"`
	State        State      `json:"state"`
	TokenID      string     `json:"token_id"`
	Peer         string     `json:"peer,omitempty"`
	EnrolledAt   time.Time  `json:"enrolled_at"`
	DecidedAt    *time.Time `json:"decided_at,omitempty"`
	DecidedBy    string     `json:"decided_by,omitempty"`
	AutoApproved bool       `json:"auto_approved,omitempty"`
	// Conflict says why the host needs a human even when its token
	// would approve it: another identity already reports as this host.
	Conflict string `json:"conflict,omitempty"`
	// LastAttempt is the last connection of a pending host (kept in
	// memory between writes): the console shows that it is waiting.
	LastAttempt *time.Time `json:"last_attempt,omitempty"`
}

type tokenRecord struct {
	Token
	Digest string `json:"sha256"`
}

type hostRecord struct {
	Host
	Digest string `json:"sha256"`
}

type fileShape struct {
	Version int            `json:"version"`
	Tokens  []*tokenRecord `json:"tokens"`
	Hosts   []*hostRecord  `json:"hosts"`
}

// Registry is the enrollment state of one engine. Safe for concurrent
// use: the ingest handshakes and the API share it.
type Registry struct {
	mu       sync.Mutex
	path     string
	tokens   []*tokenRecord
	hosts    []*hostRecord
	byDigest map[string]*hostRecord
	now      func() time.Time

	// boundElsewhere names an identity outside the registry (the
	// -ingest-identities file) bound to host, or "".
	boundElsewhere func(host string) string
	// onWithdraw runs (outside the lock) when a credential stops
	// working, so the ingest can close its open connections.
	onWithdraw func(name string)
}

// Errors the API maps to HTTP statuses.
var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("not allowed in the current state")
	ErrInvalid  = errors.New("invalid request")
	ErrFull     = errors.New("registry is full")
)

// Open loads the registry at file, or starts an empty one when the file
// does not exist yet (it is created on the first change).
func Open(file string) (*Registry, error) {
	r := &Registry{path: file, byDigest: map[string]*hostRecord{}, now: time.Now}
	st, err := os.Stat(file)
	if errors.Is(err, os.ErrNotExist) {
		return r, nil
	}
	if err != nil {
		return nil, fmt.Errorf("enroll: %w", err)
	}
	if st.Size() > maxFileBytes {
		return nil, fmt.Errorf("enroll: %s is %d bytes, over the %d byte cap", file, st.Size(), maxFileBytes)
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("enroll: %w", err)
	}
	var f fileShape
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		return nil, fmt.Errorf("enroll: %s does not parse: %w", file, err)
	}
	if f.Version != 1 {
		return nil, fmt.Errorf("enroll: %s: unsupported version %d (want 1)", file, f.Version)
	}
	if len(f.Tokens) > MaxTokens || len(f.Hosts) > MaxHosts {
		return nil, fmt.Errorf("enroll: %s: %d tokens / %d hosts exceed the caps (%d / %d)", file, len(f.Tokens), len(f.Hosts), MaxTokens, MaxHosts)
	}
	ids := map[string]bool{}
	for i, t := range f.Tokens {
		if t == nil || !validDigest(t.Digest) || t.ID == "" || ids[t.ID] {
			return nil, fmt.Errorf("enroll: %s: token #%d is malformed or duplicated", file, i+1)
		}
		ids[t.ID] = true
	}
	names := map[string]bool{}
	for i, h := range f.Hosts {
		if h == nil || !validDigest(h.Digest) || h.Name == "" || names[h.Name] || r.byDigest[h.Digest] != nil {
			return nil, fmt.Errorf("enroll: %s: host #%d is malformed or duplicated", file, i+1)
		}
		switch h.State {
		case Pending, Active, Rejected, Revoked:
		default:
			return nil, fmt.Errorf("enroll: %s: host %q has unknown state %q", file, h.Name, h.State)
		}
		names[h.Name] = true
		r.byDigest[h.Digest] = h
	}
	r.tokens, r.hosts = f.Tokens, f.Hosts
	return r, nil
}

// Path is the state file.
func (r *Registry) Path() string { return r.path }

// SetBoundElsewhere installs the lookup of identities outside the
// registry that are bound to a host (conflict detection).
func (r *Registry) SetBoundElsewhere(fn func(host string) string) {
	r.mu.Lock()
	r.boundElsewhere = fn
	r.mu.Unlock()
}

// SetOnWithdraw installs the callback run when a credential stops
// working (reject, revoke).
func (r *Registry) SetOnWithdraw(fn func(name string)) {
	r.mu.Lock()
	r.onWithdraw = fn
	r.mu.Unlock()
}

// Counts returns the hosts per state and the tokens that can still be
// used.
func (r *Registry) Counts() (pending, active, usableTokens int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	for _, h := range r.hosts {
		switch h.State {
		case Pending:
			pending++
		case Active:
			active++
		}
	}
	for _, t := range r.tokens {
		if tokenStatus(&t.Token, now) == "active" {
			usableTokens++
		}
	}
	return pending, active, usableTokens
}

// TokenRequest is what an operator asks for.
type TokenRequest struct {
	Label       string
	MaxUses     int
	TTL         time.Duration
	AutoApprove string
	By          string
}

// CreateToken mints an enrollment token. The secret is returned once;
// only its digest is stored.
func (r *Registry) CreateToken(req TokenRequest) (secret string, tok Token, err error) {
	label := strings.TrimSpace(req.Label)
	if label == "" {
		label = "alta de equipos"
	}
	if len([]rune(label)) > maxLabelRunes || hasControl(label) {
		return "", Token{}, fmt.Errorf("%w: label must be at most %d characters, without control characters", ErrInvalid, maxLabelRunes)
	}
	if req.MaxUses == 0 {
		req.MaxUses = 1
	}
	if req.MaxUses < 1 || req.MaxUses > MaxUses {
		return "", Token{}, fmt.Errorf("%w: max_uses must be between 1 and %d", ErrInvalid, MaxUses)
	}
	if req.TTL == 0 {
		req.TTL = DefaultTTL
	}
	if req.TTL < MinTTL || req.TTL > MaxTTL {
		return "", Token{}, fmt.Errorf("%w: the token must last between 1 hour and 30 days", ErrInvalid)
	}
	pattern := strings.ToLower(strings.TrimSpace(req.AutoApprove))
	if pattern != "" {
		if len([]rune(pattern)) > maxPatternRunes || hasControl(pattern) {
			return "", Token{}, fmt.Errorf("%w: auto_approve must be at most %d characters", ErrInvalid, maxPatternRunes)
		}
		if _, err := path.Match(pattern, ""); err != nil {
			return "", Token{}, fmt.Errorf("%w: auto_approve is not a valid pattern (use * and ?, e.g. pc-conta-*)", ErrInvalid)
		}
	}
	secret, err = randomSecret(TokenPrefix)
	if err != nil {
		return "", Token{}, err
	}
	id, err := randomHex(4)
	if err != nil {
		return "", Token{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.tokens) >= MaxTokens {
		r.pruneTokens()
		if len(r.tokens) >= MaxTokens {
			return "", Token{}, fmt.Errorf("%w: %d tokens kept; revoke unused ones first", ErrFull, MaxTokens)
		}
	}
	now := r.now().UTC()
	rec := &tokenRecord{
		Token: Token{
			ID:          id,
			Label:       label,
			MaxUses:     req.MaxUses,
			AutoApprove: pattern,
			CreatedAt:   now,
			ExpiresAt:   now.Add(req.TTL),
			CreatedBy:   cleanBy(req.By),
		},
		Digest: digest(secret),
	}
	r.tokens = append(r.tokens, rec)
	if err := r.saveLocked(); err != nil {
		r.tokens = r.tokens[:len(r.tokens)-1]
		return "", Token{}, err
	}
	return secret, r.tokenView(rec, now), nil
}

// pruneTokens drops tokens that can no longer be used and have no
// host referencing them, oldest first, to make room.
func (r *Registry) pruneTokens() {
	used := map[string]bool{}
	for _, h := range r.hosts {
		used[h.TokenID] = true
	}
	now := r.now()
	kept := r.tokens[:0]
	for _, t := range r.tokens {
		if tokenStatus(&t.Token, now) != "active" && !used[t.ID] {
			continue
		}
		kept = append(kept, t)
	}
	r.tokens = kept
}

// RevokeToken stops a token from enrolling more hosts. Hosts already
// enrolled with it are not affected.
func (r *Registry) RevokeToken(id, by string) (Token, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, t := range r.tokens {
		if t.ID != id {
			continue
		}
		if t.Revoked {
			return r.tokenView(t, r.now()), nil
		}
		t.Revoked, t.RevokedBy = true, cleanBy(by)
		if err := r.saveLocked(); err != nil {
			t.Revoked, t.RevokedBy = false, ""
			return Token{}, err
		}
		return r.tokenView(t, r.now()), nil
	}
	return Token{}, fmt.Errorf("%w: token %q", ErrNotFound, id)
}

// Tokens lists the tokens, newest first.
func (r *Registry) Tokens() []Token {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	out := make([]Token, 0, len(r.tokens))
	for _, t := range r.tokens {
		out = append(out, r.tokenView(t, now))
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

// Hosts lists the enrolled hosts: pending first, then newest first.
func (r *Registry) Hosts() []Host {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Host, 0, len(r.hosts))
	for _, h := range r.hosts {
		out = append(out, h.Host)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if (out[i].State == Pending) != (out[j].State == Pending) {
			return out[i].State == Pending
		}
		return out[i].EnrolledAt.After(out[j].EnrolledAt)
	})
	return out
}

// Enrolled is the answer to a successful ENROLL.
type Enrolled struct {
	Name       string
	Credential string
	State      State
}

// Enroll exchanges an enrollment token for a credential bound to host.
// The error messages go back to the sensor, so they say what to fix.
func (r *Registry) Enroll(token, host, peer string) (Enrolled, error) {
	host = strings.TrimSpace(host)
	if !ValidHost(host) {
		return Enrolled{}, fmt.Errorf("%w: invalid host name %q", ErrInvalid, host)
	}
	if strings.HasPrefix(token, CredentialPrefix) {
		return Enrolled{}, fmt.Errorf("%w: that is a sensor credential, not an enrollment token: connect with AUTH", ErrInvalid)
	}
	credential, err := randomSecret(CredentialPrefix)
	if err != nil {
		return Enrolled{}, err
	}
	suffix, err := randomHex(3)
	if err != nil {
		return Enrolled{}, err
	}

	r.mu.Lock()
	tok := r.findTokenLocked(token)
	now := r.now().UTC()
	if tok == nil {
		r.mu.Unlock()
		return Enrolled{}, fmt.Errorf("%w: unknown enrollment token", ErrInvalid)
	}
	switch tokenStatus(&tok.Token, now) {
	case "revoked":
		r.mu.Unlock()
		return Enrolled{}, fmt.Errorf("%w: the enrollment token was revoked", ErrInvalid)
	case "expired":
		r.mu.Unlock()
		return Enrolled{}, fmt.Errorf("%w: the enrollment token expired at %s", ErrInvalid, tok.ExpiresAt.Format(time.RFC3339))
	case "used_up":
		r.mu.Unlock()
		return Enrolled{}, fmt.Errorf("%w: the enrollment token has no uses left (%d of %d)", ErrInvalid, tok.Uses, tok.MaxUses)
	}
	if len(r.hosts) >= MaxHosts {
		r.mu.Unlock()
		return Enrolled{}, fmt.Errorf("%w: %d hosts enrolled", ErrFull, MaxHosts)
	}
	pending := 0
	for _, h := range r.hosts {
		if h.State == Pending {
			pending++
		}
	}
	if pending >= MaxPending {
		r.mu.Unlock()
		return Enrolled{}, fmt.Errorf("%w: %d hosts are already waiting for approval", ErrFull, MaxPending)
	}

	conflict := r.conflictLocked(host)
	state := Pending
	auto := false
	if conflict == "" && tok.AutoApprove != "" {
		if ok, _ := path.Match(tok.AutoApprove, strings.ToLower(host)); ok {
			state, auto = Active, true
		}
	}
	rec := &hostRecord{
		Host: Host{
			Name:         identityName(host, suffix),
			Host:         host,
			State:        state,
			TokenID:      tok.ID,
			Peer:         peer,
			EnrolledAt:   now,
			AutoApproved: auto,
			Conflict:     conflict,
		},
		Digest: digest(credential),
	}
	if auto {
		rec.DecidedAt, rec.DecidedBy = &now, "auto:"+tok.ID
	}
	tok.Uses++
	r.hosts = append(r.hosts, rec)
	r.byDigest[rec.Digest] = rec
	if err := r.saveLocked(); err != nil {
		tok.Uses--
		r.hosts = r.hosts[:len(r.hosts)-1]
		delete(r.byDigest, rec.Digest)
		r.mu.Unlock()
		return Enrolled{}, err
	}
	r.mu.Unlock()
	return Enrolled{Name: rec.Name, Credential: credential, State: state}, nil
}

// conflictLocked says whether another live identity already reports as
// host. Such an enrollment never approves itself: it is either a
// reinstall or someone impersonating the machine.
func (r *Registry) conflictLocked(host string) string {
	for _, h := range r.hosts {
		if (h.State == Active || h.State == Pending) && strings.EqualFold(h.Host.Host, host) {
			return fmt.Sprintf("la identidad %s (%s) ya informa como este equipo: reinstalación o suplantación", h.Name, h.State)
		}
	}
	if r.boundElsewhere != nil {
		if name := r.boundElsewhere(host); name != "" {
			return fmt.Sprintf("la identidad %s del fichero de identidades ya informa como este equipo", name)
		}
	}
	return ""
}

func (r *Registry) findTokenLocked(token string) *tokenRecord {
	if !strings.HasPrefix(token, TokenPrefix) {
		return nil
	}
	want := digest(token)
	var found *tokenRecord
	for _, t := range r.tokens {
		if subtle.ConstantTimeCompare([]byte(t.Digest), []byte(want)) == 1 {
			found = t
		}
	}
	return found
}

// Authenticate looks a credential up. It returns the identity name, the
// bound host and the state; ok is false when the credential is unknown.
// A pending host's attempt is recorded so the console can show that it
// is waiting.
//
// The lookup is a map keyed by the SHA-256 of the supplied value: its
// timing depends on that digest, which tells a prober nothing about any
// stored credential (they are 256-bit random values).
func (r *Registry) Authenticate(credential string) (name, host string, state State, ok bool) {
	if !strings.HasPrefix(credential, CredentialPrefix) {
		return "", "", "", false
	}
	d := digest(credential)
	r.mu.Lock()
	defer r.mu.Unlock()
	h := r.byDigest[d]
	if h == nil {
		return "", "", "", false
	}
	if h.State == Pending {
		now := r.now().UTC()
		h.LastAttempt = &now
	}
	return h.Name, h.Host.Host, h.State, true
}

// Action is a decision on an enrolled host.
type Action string

const (
	Approve Action = "approve"
	Reject  Action = "reject"
	Revoke  Action = "revoke"
)

// Decide applies an administrator's decision: approve or reject a
// pending host, revoke a pending or active one.
func (r *Registry) Decide(name string, action Action, by string) (Host, error) {
	r.mu.Lock()
	var h *hostRecord
	for _, x := range r.hosts {
		if x.Name == name {
			h = x
			break
		}
	}
	if h == nil {
		r.mu.Unlock()
		return Host{}, fmt.Errorf("%w: host identity %q", ErrNotFound, name)
	}
	var next State
	switch action {
	case Approve:
		if h.State != Pending {
			r.mu.Unlock()
			return Host{}, fmt.Errorf("%w: only a pending host can be approved (it is %s)", ErrConflict, h.State)
		}
		next = Active
	case Reject:
		if h.State != Pending {
			r.mu.Unlock()
			return Host{}, fmt.Errorf("%w: only a pending host can be rejected (it is %s); revoke an active one", ErrConflict, h.State)
		}
		next = Rejected
	case Revoke:
		if h.State != Pending && h.State != Active {
			r.mu.Unlock()
			return Host{}, fmt.Errorf("%w: the host is already %s", ErrConflict, h.State)
		}
		next = Revoked
	default:
		r.mu.Unlock()
		return Host{}, fmt.Errorf("%w: unknown action %q (approve, reject or revoke)", ErrInvalid, action)
	}
	prev, prevAt, prevBy := h.State, h.DecidedAt, h.DecidedBy
	now := r.now().UTC()
	h.State, h.DecidedAt, h.DecidedBy = next, &now, cleanBy(by)
	if err := r.saveLocked(); err != nil {
		h.State, h.DecidedAt, h.DecidedBy = prev, prevAt, prevBy
		r.mu.Unlock()
		return Host{}, err
	}
	view, withdraw := h.Host, r.onWithdraw
	r.mu.Unlock()
	if next != Active && withdraw != nil {
		withdraw(view.Name)
	}
	return view, nil
}

func (r *Registry) tokenView(t *tokenRecord, now time.Time) Token {
	v := t.Token
	v.Status = tokenStatus(&t.Token, now)
	return v
}

func tokenStatus(t *Token, now time.Time) string {
	switch {
	case t.Revoked:
		return "revoked"
	case !now.Before(t.ExpiresAt):
		return "expired"
	case t.Uses >= t.MaxUses:
		return "used_up"
	}
	return "active"
}

// saveLocked writes the whole registry atomically. The caller holds mu
// and undoes its change when this fails, so memory and disk agree.
func (r *Registry) saveLocked() error {
	data, err := json.MarshalIndent(fileShape{Version: 1, Tokens: r.tokens, Hosts: r.hosts}, "", "  ")
	if err != nil {
		return fmt.Errorf("enroll: marshal: %w", err)
	}
	dir := filepath.Dir(r.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("enroll: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".enrollment-*")
	if err != nil {
		return fmt.Errorf("enroll: temp file in %s: %w", dir, err)
	}
	name := tmp.Name()
	_, werr := tmp.Write(append(data, '\n'))
	if werr == nil {
		werr = tmp.Sync()
	}
	if cerr := tmp.Close(); werr == nil {
		werr = cerr
	}
	if werr == nil {
		werr = os.Chmod(name, 0o600)
	}
	if werr == nil {
		werr = os.Rename(name, r.path)
	}
	if werr != nil {
		os.Remove(name)
		return fmt.Errorf("enroll: write %s: %w", r.path, werr)
	}
	return nil
}

// ValidHost accepts a computer or DNS name: letters, digits, '-', '_'
// and '.', at most 253 characters.
func ValidHost(host string) bool {
	if host == "" || len(host) > maxHostLen {
		return false
	}
	for _, c := range host {
		if !(c == '-' || c == '_' || c == '.' || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
			return false
		}
	}
	return true
}

// identityName builds the identity stamped on the host's events:
// "enr-<host>-<random>", lowercased and short enough for the ingest's
// 64-character identity names.
func identityName(host, suffix string) string {
	h := strings.ToLower(host)
	if len(h) > 48 {
		h = h[:48]
	}
	return "enr-" + h + "-" + suffix
}

func digest(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func validDigest(s string) bool {
	b, err := hex.DecodeString(s)
	return err == nil && len(b) == sha256.Size
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("enroll: random: %w", err)
	}
	return hex.EncodeToString(b), nil
}

func randomSecret(prefix string) (string, error) {
	h, err := randomHex(32)
	if err != nil {
		return "", err
	}
	return prefix + h, nil
}

func hasControl(s string) bool { return strings.IndexFunc(s, unicode.IsControl) >= 0 }

func cleanBy(by string) string {
	by = strings.TrimSpace(by)
	if hasControl(by) {
		by = strings.Map(func(r rune) rune {
			if unicode.IsControl(r) {
				return -1
			}
			return r
		}, by)
	}
	if r := []rune(by); len(r) > maxByRunes {
		by = string(r[:maxByRunes])
	}
	return by
}
