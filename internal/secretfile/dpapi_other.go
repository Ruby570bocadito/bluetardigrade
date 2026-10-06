//go:build !windows

package secretfile

import (
	"errors"
	"fmt"
)

// errDPAPIUnavailable is the honest refusal behind both stubs: DPAPI
// does not exist off Windows and no homemade cryptography is added to
// imitate it — there is no honest key source to trust on a random lab
// host, and a made-up scheme would be exactly the kind of new attack
// surface a defensive tool must not ship. Files encrypted on a Windows
// host cannot be read anywhere else; on this platform the honest scheme
// is plain with owner-only file permissions, enforced on every read.
var errDPAPIUnavailable = errors.New("secretfile: scheme dpapi is only available on Windows")

func protect(data []byte) ([]byte, error) {
	return nil, fmt.Errorf("%w; use the plain scheme on this platform (the file is mode 0600)", errDPAPIUnavailable)
}

func unprotect(data []byte) ([]byte, error) {
	return nil, fmt.Errorf("%w: this file was encrypted on a Windows host and cannot be decrypted here", errDPAPIUnavailable)
}
