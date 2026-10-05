//go:build windows

package secretfile

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// cryptProtectLocalMachine is CRYPTPROTECT_LOCAL_MACHINE: the machine
// scope is deliberate, because the engine runs as a service and a
// user-scope blob would break the sync cycle the moment the service
// account changes. The binding to this specific machine (the blob does
// not decrypt on another host) plus the file ACL are the real barriers;
// DPAPI adds the host binding on top of the ACL.
const cryptProtectLocalMachine = 0x1

// blobDescription is stored INSIDE the DPAPI blob (never next to the
// secret) so an administrator inspecting the ciphertext can tell which
// component produced it.
const blobDescription = "bluetardigrade secretfile"

func protect(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("secretfile: nothing to protect")
	}
	in := &windows.DataBlob{Size: uint32(len(data)), Data: &data[0]}
	desc, err := windows.UTF16PtrFromString(blobDescription)
	if err != nil {
		return nil, fmt.Errorf("secretfile: CryptProtectData: %w", err)
	}
	var out windows.DataBlob
	if err := windows.CryptProtectData(in, desc, nil, 0, nil, cryptProtectLocalMachine, &out); err != nil {
		return nil, fmt.Errorf("secretfile: CryptProtectData: %w", err)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	res := make([]byte, out.Size)
	copy(res, unsafe.Slice(out.Data, out.Size))
	return res, nil
}

func unprotect(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("secretfile: nothing to unprotect")
	}
	in := &windows.DataBlob{Size: uint32(len(data)), Data: &data[0]}
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(in, nil, nil, 0, nil, 0, &out); err != nil {
		return nil, fmt.Errorf("secretfile: CryptUnprotectData (wrong host, wrong service account or corrupted file?): %w", err)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	res := make([]byte, out.Size)
	copy(res, unsafe.Slice(out.Data, out.Size))
	return res, nil
}
