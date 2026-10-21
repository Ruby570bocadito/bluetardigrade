package rules

import (
	"slices"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// Active-directory endpoint pack (O-2): every rule fires on the tooling
// invocation of its technique and stays quiet on the admin equivalent
// an analyst or a software installer runs every day. Documented
// overlaps: mimikatz `lsadump::dcsync` also trips the tool-level
// hacktools pack, and `sc create` with an unsafe binPath also trips
// privilege-escalation.yaml — the technique rule adds coverage for
// custom or renamed tooling, it does not replace them.

var adPackRuleNames = []string{
	"Solicitud de tickets Kerberos para un SPN",
	"Herramienta de replicacion de directorio (DCSync)",
	"Rociado de contrasenas desde el endpoint",
	"Alta en grupo con net.exe",
	"Servicio de Windows con interprete como binario",
}

func assertFired(t *testing.T, e *Engine, ev *model.Event, want string) {
	t.Helper()
	got := hitNames(e, ev)
	if !slices.Contains(got, want) {
		t.Fatalf("expected rule %q to fire, hits: %v", want, got)
	}
}

func assertExactlyFired(t *testing.T, e *Engine, ev *model.Event, want []string) {
	t.Helper()
	got := hitNames(e, ev)
	if !slices.Equal(got, want) {
		t.Fatalf("expected hits %v, got %v", want, got)
	}
}

func assertADPackQuiet(t *testing.T, e *Engine, ev *model.Event) {
	t.Helper()
	for _, hit := range e.Evaluate(ev) {
		if slices.Contains(adPackRuleNames, hit.Rule.Name) {
			t.Fatalf("benign event fired AD endpoint rule %q", hit.Rule.Name)
		}
	}
}

func TestActiveDirectoryPackAttackCases(t *testing.T) {
	e := loadTestEngine(t)

	t.Run("kerberoasting raw SPN token", func(t *testing.T) {
		ev := proc("powershell.exe", "", `powershell.exe -c "New-Object System.IdentityModel.Tokens.KerberosRequestorSecurityToken -ArgumentList MSSQLSvc/sql01:1433"`, "")
		assertExactlyFired(t, e, ev, []string{"Solicitud de tickets Kerberos para un SPN"})
	})

	t.Run("dcsync custom tooling", func(t *testing.T) {
		ev := proc("powershell.exe", "", `powershell.exe -c "Invoke-DCSync -Domain corp.local -All"`, "")
		assertExactlyFired(t, e, ev, []string{"Herramienta de replicacion de directorio (DCSync)"})
	})

	t.Run("dcsync mimikatz overlap with hacktools pack", func(t *testing.T) {
		ev := proc("mimikatz.exe", "", `mimikatz.exe "lsadump::dcsync /domain:corp.local /user:krbtgt"`, "")
		assertFired(t, e, ev, "Herramienta de replicacion de directorio (DCSync)")
	})

	t.Run("password spray tooling", func(t *testing.T) {
		ev := proc("powershell.exe", "", `powershell.exe -c "Invoke-DomainPasswordSpray -UserList users.txt -Password P@ssw0rd"`, "")
		assertExactlyFired(t, e, ev, []string{"Rociado de contrasenas desde el endpoint"})
	})

	t.Run("local group add", func(t *testing.T) {
		ev := proc("net.exe", "", `net.exe localgroup administrators eviluser /add`, "")
		assertExactlyFired(t, e, ev, []string{"Alta en grupo con net.exe"})
	})

	t.Run("domain group add overlaps with discovery pack", func(t *testing.T) {
		ev := proc("net.exe", "", `net.exe group "Domain Admins" eviluser /add /domain`, "")
		assertFired(t, e, ev, "Alta en grupo con net.exe")
	})

	t.Run("sc.exe service running an interpreter", func(t *testing.T) {
		ev := proc("sc.exe", "", `sc.exe create UpdaterSvc binpath= "cmd.exe /c C:\Windows\Temp\updater.exe" start= auto`, "")
		assertExactlyFired(t, e, ev, []string{"Servicio de Windows con interprete como binario"})
	})

	t.Run("New-Service running powershell", func(t *testing.T) {
		ev := proc("powershell.exe", "", `powershell.exe -c "New-Service -Name UpdaterSvc -BinaryPathName 'powershell.exe -nop -c iex'"`, "")
		assertExactlyFired(t, e, ev, []string{"Servicio de Windows con interprete como binario"})
	})
}

func TestActiveDirectoryPackBenignTwinsStayQuiet(t *testing.T) {
	e := loadTestEngine(t)
	cases := []struct {
		name string
		ev   *model.Event
	}{
		{"admin SPN inventory", proc("powershell.exe", "", `powershell.exe -c "Get-ADUser -Filter * -Properties servicePrincipalName"`, "")},
		{"admin replication sync", proc("repadmin.exe", "", `repadmin.exe /syncall /AdeP`, "")},
		{"group read", proc("net.exe", "", `net.exe group "Domain Admins" /domain`, "")},
		{"local group read", proc("net.exe", "", `net.exe localgroup administrators`, "")},
		{"net use", proc("net.exe", "", `net.exe use \\fileserver\public`, "")},
		{"service query", proc("sc.exe", "", `sc.exe query wuauserv`, "")},
		{"service description edit", proc("sc.exe", "", `sc.exe description wuauserv "Servicio de actualizaciones"`, "")},
		{"driver service install", proc("sc.exe", "", `sc.exe create DvmService binpath= C:\Windows\System32\DriverStore\dvm.sys start= boot`, "")},
		{"admin password reset", proc("powershell.exe", "", `powershell.exe -c "Set-ADAccountPassword -Identity jdoe -Reset"`, "")},
		{"driver installer service", proc("powershell.exe", "", `powershell.exe -c "Get-WmiObject Win32_Service -Filter \"Name='UpdaterSvc'\""`, "")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assertADPackQuiet(t, e, tc.ev)
		})
	}
}
