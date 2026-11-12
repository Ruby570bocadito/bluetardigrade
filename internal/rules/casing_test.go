package rules

import "testing"

// Windows no distingue mayusculas en nombres de imagen, rutas ni
// claves de registro, y PowerShell acepta cualquier prefijo de un
// parametro: la grafia real de disco (WMIC.exe) y las variantes de
// -EncodedCommand tienen que disparar igual que la forma en
// minusculas con la que se escribio la regla.
func TestSeededPackIgnoresCaseAndFlagPrefixes(t *testing.T) {
	e := loadTestEngine(t)
	const blob = "SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA"
	fire := []struct{ name, cmdline, rule string }{
		{"WMIC.exe", "WMIC.exe shadowcopy delete", "Borrado de instantaneas VSS con wmic"},
		{"reg.exe", `reg.exe SAVE hklm\sam C:\t\sam.hiv`, "Volcado del registro SAM"},
		{"RUNDLL32.EXE", `RUNDLL32.EXE C:\WINDOWS\SYSTEM32\COMSVCS.DLL, MiniDump 624 C:\t\l.dmp full`, "Volcado de LSASS via comsvcs.dll"},
		{"PowerShell.EXE", "PowerShell.EXE -ENC " + blob, "PowerShell con comando codificado"},
		{"powershell.exe", "powershell.exe -enco " + blob, "PowerShell con comando codificado"},
		{"powershell.exe", "powershell.exe -ec " + blob, "PowerShell con comando codificado"},
		{"powershell.exe", "powershell.exe /e " + blob, "PowerShell con comando codificado"},
		{"powershell.exe", "powershell.exe \u2013EncodedCommand " + blob, "PowerShell con comando codificado"},
		{"powershell.exe", "powershell.exe -win hidden -file a.ps1", "PowerShell con comando codificado"},
		{"pwsh.exe", "pwsh.exe -enc " + blob, "PowerShell con comando codificado"},
	}
	for _, tc := range fire {
		found := false
		for _, h := range e.Evaluate(testEvent(tc.name, tc.cmdline)) {
			if h.Rule.Name == tc.rule {
				found = true
			}
		}
		if !found {
			t.Errorf("%q no disparo %q", tc.cmdline, tc.rule)
		}
	}
	quiet := []struct{ name, cmdline string }{
		{"powershell.exe", "powershell.exe -File sign.ps1 -Encoding UTF8"},
		{"powershell.exe", "powershell.exe -ExecutionPolicy Bypass -File a.ps1"},
		{"PowerShell.EXE", "PowerShell.EXE -NoProfile -Command Get-Date"},
	}
	for _, tc := range quiet {
		for _, h := range e.Evaluate(testEvent(tc.name, tc.cmdline)) {
			if h.Rule.Name == "PowerShell con comando codificado" || h.Rule.Name == "Interprete renombrado por su gramatica de argumentos" {
				t.Errorf("%q disparo %q", tc.cmdline, h.Rule.Name)
			}
		}
	}
}
