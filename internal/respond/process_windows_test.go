//go:build windows

package respond

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
)

// La proteccion va por ruta completa: el binario de sistema bajo
// System32 es intocable, uno con el mismo nombre en otra carpeta no.
func TestProtectedImageIsDecidedByFullPath(t *testing.T) {
	const sys = `C:\Windows\System32`
	const self = `C:\bluetardigrade\bin`
	cases := []struct {
		path string
		want bool
	}{
		{`C:\Windows\System32\lsass.exe`, true},
		{`c:\windows\system32\LSASS.EXE`, true},
		{`C:\Windows\System32\winlogon.exe`, true},
		{`C:\Windows\System32\csrss.exe`, true},
		{`C:\Windows\System32\services.exe`, true},
		{`C:\Users\Public\lsass.exe`, false},
		{`C:\Windows\Temp\winlogon.exe`, false},
		{`C:\Windows\System32\drivers\lsass.exe`, false},
		{`C:\Windows\System32\notepad.exe`, false},
		{`C:\bluetardigrade\bin\security-sensor.exe`, true},
		{`C:\bluetardigrade\bin\sf-engine.exe`, true},
		{`C:\bluetardigrade\bin\engine.exe`, true},
		{`C:\Users\Public\security-sensor.exe`, false},
		{`C:\Users\Public\engine.exe`, false},
	}
	for _, c := range cases {
		if got := protectedImage(c.path, sys, self); got != c.want {
			t.Errorf("protectedImage(%q) = %v, want %v", c.path, got, c.want)
		}
	}
	if protectedImage(`C:\Windows\System32\lsass.exe`, "", "") {
		t.Error("an unresolved system directory must not match every folder")
	}
}

// Un proceso real con nombre de sistema fuera de System32 pasa la
// guarda: se resuelve su ruta, no solo su nombre.
func TestSameNamedBinaryOutsideSystem32IsNotProtected(t *testing.T) {
	src := filepath.Join(os.Getenv("SystemRoot"), "System32", "ping.exe")
	data, err := os.ReadFile(src)
	if err != nil {
		t.Skipf("no ping.exe to copy: %v", err)
	}
	fake := filepath.Join(t.TempDir(), "winlogon.exe")
	if err := os.WriteFile(fake, data, 0o700); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(fake, "-n", "30", "127.0.0.1")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Start(); err != nil {
		t.Skipf("cannot start the copy (application control?): %v", err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}()
	pid := cmd.Process.Pid
	resolved, err := resolveProcessName(pid)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if isProtectedDefault(pid, resolved) {
		t.Fatalf("%s outside System32 was reported protected", resolved)
	}
	if _, _, err := killVerified(pid, "winlogon.exe"); err != nil {
		t.Fatalf("the impostor must be killable: %v", err)
	}
}

// Sin ruta legible la decision cae al nombre y deniega.
func TestProtectedFallsBackToNameWithoutPath(t *testing.T) {
	const noSuchPID = 0x7ffffffc
	if !isProtectedDefault(noSuchPID, "lsass.exe") {
		t.Error("unreadable path + system name must stay protected")
	}
	if isProtectedDefault(noSuchPID, "notepad.exe") {
		t.Error("an ordinary name is not protected")
	}
	if isProtectedDefault(os.Getpid(), filepath.Base(os.Args[0])) {
		t.Error("the test binary is neither a system nor a critical process")
	}
}
