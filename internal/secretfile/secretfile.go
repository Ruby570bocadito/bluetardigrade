// Package secretfile implements the SEC-2 contract for single-secret
// files: one secret per file, wrapped in a versioned JSON envelope,
// DPAPI-protected on Windows (CRYPTPROTECT_LOCAL_MACHINE scope) and
// permission-guarded (owner-only 0600) on POSIX systems.
//
// Contract (Seguridad B addendum, ronda 2026-10-05 19h10; TODO SEC-2):
//   - The engine is only ever handed the PATH of the file, never the
//     secret itself (the same discipline as the sensor's -token-file).
//   - A legacy raw-text file is still accepted for laboratory parity,
//     but on Windows it yields a one-line warning (not a failure) and
//     the remediation is re-saving it — never an automatic rewrite
//     behind the operator's back.
//   - There is no homemade cryptography: on platforms without DPAPI
//     the scheme is plain and the barrier is the file mode, enforced
//     on read with an actionable error.
//   - Buffers returned by Read are owned by the caller precisely so
//     they can be zeroed after use (secretfile.Zero).
package secretfile

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

const (
	// envelopeVersion is bumped only when the format itself changes;
	// readers reject other versions with an actionable error instead
	// of guessing.
	envelopeVersion = 1

	schemeDPAPI = "dpapi"
	schemePlain = "plain"
)

// Envelope is the on-disk format: exactly one secret per file,
// versioned so future schemes can be added without breaking readers.
type Envelope struct {
	Version    int    `json:"version"`
	CreatedAt  string `json:"created_at"`
	Scheme     string `json:"scheme"`
	Ciphertext []byte `json:"ciphertext"` // base64 in the JSON encoding
}

// DefaultScheme reports the scheme Write installs on this platform:
// dpapi on Windows, plain everywhere else.
func DefaultScheme() string {
	if runtime.GOOS == "windows" {
		return schemeDPAPI
	}
	return schemePlain
}

// Read returns the secret bytes held by the file plus advisory
// warnings (never the secret, never its length). It accepts both an
// envelope file and the legacy raw text (laboratory parity); a
// non-encrypted file on Windows yields a warning pointing at
// "engine secret-write". The returned buffer is owned by the caller,
// who must zero it after use.
func Read(path string) ([]byte, []string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("secretfile: read %s: %w", path, err)
	}
	if isEnvelopeCandidate(raw) {
		env, err := parseEnvelope(path, raw)
		if err != nil {
			return nil, nil, err
		}
		return decodeEnvelope(path, env)
	}
	// Legacy raw file: the exact bytes a password file held before
	// SEC-2, with the same trailing-newline trim the connector always
	// applied. POSIX still checks the mode (audit 5.2): the legacy
	// branch used to hand over the secret without verifying 0600,
	// breaking the contract the envelope path enforces — a
	// world-readable credential now fails loudly instead of loading
	// silently beside every other user on the machine.
	pw := bytes.Trim(raw, "\r\n")
	if len(pw) == 0 {
		return nil, nil, fmt.Errorf("secretfile: %s is empty", path)
	}
	if runtime.GOOS != "windows" {
		if fi, statErr := os.Stat(path); statErr == nil {
			if perm := fi.Mode().Perm(); perm != 0o600 {
				return nil, nil, fmt.Errorf("secretfile: %s is mode %04o, want 0600 (chmod 600 %s) — refusing to load a credential other users can read", path, perm, path)
			}
		}
	}
	out := make([]byte, len(pw))
	copy(out, pw)
	if runtime.GOOS == "windows" {
		return out, []string{fmt.Sprintf(
			"the credential file %s is not encrypted: save it again with \"engine secret-write %s\" so it is protected with DPAPI (LOCAL_MACHINE scope)",
			path, path)}, nil
	}
	return out, nil, nil
}

// Write atomically installs secret at path using the platform default
// scheme (secretfile.DefaultScheme). The write is temp+rename+Sync —
// the same pattern as the enrollment file — so a crash never leaves a
// truncated credential behind and a failed write never destroys the
// previous file.
func Write(path string, secret []byte) error {
	if len(secret) == 0 {
		return fmt.Errorf("secretfile: refusing to write an empty secret to %s", path)
	}
	scheme := schemePlain
	payload := secret
	if runtime.GOOS == "windows" {
		scheme = schemeDPAPI
		var err error
		//lint:ignore SA4023 the non-Windows stub always refuses (dpapi_other.go);
		// this check is load-bearing on Windows, where CryptProtectData can fail.
		if payload, err = protect(secret); err != nil {
			return err
		}
	}
	env := Envelope{
		Version:    envelopeVersion,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		Scheme:     scheme,
		Ciphertext: payload,
	}
	data, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("secretfile: encode envelope for %s: %w", path, err)
	}
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("secretfile: create temp file next to %s: %w", path, err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op once the rename succeeds
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("secretfile: write %s: %w", tmpName, err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("secretfile: sync %s: %w", tmpName, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("secretfile: close %s: %w", tmpName, err)
	}
	if err := os.Chmod(tmpName, 0o600); err != nil {
		return fmt.Errorf("secretfile: chmod 600 %s: %w", tmpName, err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("secretfile: rename %s -> %s: %w", tmpName, path, err)
	}
	return nil
}

// Zero overwrites a secret buffer in place. Every buffer this package
// hands out is a private copy so that zeroing it actually reaches the
// memory that held the secret.
func Zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

// isEnvelopeCandidate decides between the envelope and the legacy raw
// format BEFORE parsing: anything that opens with '{' is claimed as an
// envelope attempt, so a corrupted envelope is a hard, actionable
// error instead of being silently swallowed as a weird password.
func isEnvelopeCandidate(raw []byte) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) > 0 && trimmed[0] == '{'
}

func parseEnvelope(path string, raw []byte) (Envelope, error) {
	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return Envelope{}, fmt.Errorf("secretfile: %s looks like an envelope but does not parse (corrupt base64 or truncated JSON?): %w", path, err)
	}
	if env.Scheme == "" {
		return Envelope{}, fmt.Errorf("secretfile: %s: envelope without scheme (supported: %s, %s)", path, schemeDPAPI, schemePlain)
	}
	return env, nil
}

func decodeEnvelope(path string, env Envelope) ([]byte, []string, error) {
	if env.Version != envelopeVersion {
		return nil, nil, fmt.Errorf("secretfile: %s: envelope version %d not supported (expected %d); save the file again with \"engine secret-write\"", path, env.Version, envelopeVersion)
	}
	switch env.Scheme {
	case schemeDPAPI:
		secret, err := unprotect(env.Ciphertext)
		//lint:ignore SA4023 off Windows, unprotect is a deliberate, documented
		// refusal (dpapi_other.go), so staticcheck can prove this check always
		// fires there. It is load-bearing on the Windows build, where
		// CryptUnprotectData can absolutely fail; both platforms share this code.
		if err != nil {
			return nil, nil, fmt.Errorf("secretfile: %s: %w", path, err)
		}
		if len(secret) == 0 {
			return nil, nil, fmt.Errorf("secretfile: %s: decrypted secret is empty", path)
		}
		return secret, nil, nil
	case schemePlain:
		if runtime.GOOS == "windows" {
			return copySecret(env.Ciphertext), []string{fmt.Sprintf(
				"the credential file %s uses scheme=plain: on Windows it should be DPAPI-protected; save it again with \"engine secret-write %s\"",
				path, path)}, nil
		}
		if err := checkPerms(path); err != nil {
			return nil, nil, err
		}
		if len(env.Ciphertext) == 0 {
			return nil, nil, fmt.Errorf("secretfile: %s: envelope holds an empty secret", path)
		}
		return copySecret(env.Ciphertext), nil, nil
	default:
		return nil, nil, fmt.Errorf("secretfile: %s: unknown scheme %q (supported: %s, %s)", path, env.Scheme, schemeDPAPI, schemePlain)
	}
}

// copySecret detaches the returned buffer from the parsed envelope so
// the caller's Zero really owns the only copy of the secret bytes.
func copySecret(b []byte) []byte {
	out := make([]byte, len(b))
	copy(out, b)
	return out
}

// checkPerms enforces the POSIX half of the SEC-2 barrier: a plain
// secret must live in an owner-only file. On Windows the barrier is
// the file ACL (SYSTEM, Administrators and the service account), which
// is the installer's and the operator's responsibility and is
// documented in docs/OPERATIONS.md — the mode bits carry no ACL
// meaning there.
func checkPerms(path string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("secretfile: stat %s: %w", path, err)
	}
	perm := info.Mode().Perm()
	if perm&0o077 != 0 {
		return fmt.Errorf("secretfile: %s: permissions are %#o, expected owner-only (0600 or stricter); fix with chmod 600 %s", path, perm, path)
	}
	return nil
}
