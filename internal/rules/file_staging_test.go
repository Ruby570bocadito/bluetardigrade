package rules

import (
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/enrich"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestFileStagingPack(t *testing.T) {
	e := loadTestEngine(t)
	cases := []struct {
		label, writer, path, rule string
	}{
		{"Office payload", "WINWORD.EXE", `C:\Users\ana\AppData\Local\Temp\loader.EXE`, "Office escribe un payload en una ruta de usuario"},
		{"Office script", "excel.exe", `C:\Users\Public\stage.ps1`, "Office escribe un payload en una ruta de usuario"},
		{"Office document", "winword.exe", `C:\Users\ana\AppData\Local\Temp\report.docx`, ""},
		{"different writer", "notepad.exe", `C:\Users\Public\stage.ps1`, ""},
		{"system deployment", "winword.exe", `C:\Program Files\Office\loader.exe`, ""},
		{"script DLL", "PWSH.EXE", `C:\Users\ana\AppData\Roaming\tool\plugin.DLL`, "Interprete escribe una DLL en una ruta temporal"},
		{"public DLL", "wscript.exe", `C:\Users\Public\plugin.dll`, "Interprete escribe una DLL en una ruta temporal"},
		{"script data", "pwsh.exe", `C:\Users\Public\plugin.json`, ""},
		{"system DLL", "powershell.exe", `C:\Windows\System32\plugin.dll`, ""},
		{"unrelated path", "powershell.exe", `C:\Users\ana\AppDataBackup\plugin.dll`, ""},
		{"DLL extraction", "7zFM.exe", `C:\Users\ana\Downloads\tool\VERSION.DLL`, "DLL candidata a carga lateral descargada o extraida"},
		{"browser DLL", "msedge.exe", `C:\Users\Public\drop\winmm.dll`, "DLL candidata a carga lateral descargada o extraida"},
		{"direct DLL download", "chrome.exe", `C:\Users\ana\Downloads\version.dll`, "DLL candidata a carga lateral descargada o extraida"},
		{"unrecognized DLL", "7zfm.exe", `C:\Users\ana\Downloads\tool\ordinary.dll`, ""},
		{"installed DLL", "7zfm.exe", `C:\Program Files\tool\version.dll`, ""},
		{"fake DLL suffix", "msedge.exe", `C:\Users\Public\drop\version.dll.txt`, ""},
		{"user profile", "notepad.exe", `C:\Users\ana\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`, "Modificacion de un perfil de PowerShell"},
		{"redirected profile", "code.exe", `C:\Users\ana\OneDrive\Documents\PowerShell\profile.ps1`, "Modificacion de un perfil de PowerShell"},
		{"system profile", "notepad.exe", `C:\Windows\System32\WindowsPowerShell\v1.0\Microsoft.PowerShellISE_profile.ps1`, "Modificacion de un perfil de PowerShell"},
		{"PowerShell 7 profile", "code.exe", `C:\Program Files\PowerShell\7\profile.ps1`, "Modificacion de un perfil de PowerShell"},
		{"unrelated profile script", "notepad.exe", `C:\Ops\profile.ps1`, ""},
		{"profile backup", "code.exe", `C:\Users\ana\Documents\PowerShell\profile.ps1.bak`, ""},
		{"Word startup", "explorer.exe", `C:\Users\ana\AppData\Roaming\Microsoft\Word\STARTUP\loader.dotm`, "Contenido activo en el inicio automatico de Office"},
		{"Excel startup", "explorer.exe", `C:\Users\ana\AppData\Roaming\Microsoft\Excel\XLSTART\loader.XLAM`, "Contenido activo en el inicio automatico de Office"},
		{"Office installed startup", "setup.exe", `C:\Program Files\Microsoft Office\root\Office16\XLSTART\loader.xlsm`, "Contenido activo en el inicio automatico de Office"},
		{"Word startup document", "explorer.exe", `C:\Users\ana\AppData\Roaming\Microsoft\Word\STARTUP\readme.docx`, ""},
		{"Office archive", "explorer.exe", `C:\Users\ana\AppData\Roaming\Microsoft\Excel\XLSTART-backup\loader.xlam`, ""},
		{"Word non-template", "explorer.exe", `C:\Users\ana\AppData\Roaming\Microsoft\Word\STARTUP\loader.xlsm`, ""},
		{"LSASS dump", "PROCDUMP64.EXE", `C:\Temp\lsass.exe_261001_120000.DMP`, "Artefacto de volcado de LSASS escrito en disco"},
		{"LSASS task manager dump", "taskmgr.exe", `C:\Users\ana\AppData\Local\Temp\lsass.dmp`, "Artefacto de volcado de LSASS escrito en disco"},
		{"different process dump", "procdump64.exe", `C:\Temp\notepad.dmp`, ""},
		{"dump name in document", "taskmgr.exe", `C:\Temp\lsass.dmp.txt`, ""},
		{"unrelated dump writer", "notepad.exe", `C:\Ops\lsass.dmp`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			ev := testEvent(tc.writer, "")
			ev.Type = model.TypeFileWrite
			ev.File = &model.File{Path: tc.path} // extension deliberately absent
			var names []string
			for _, h := range e.Evaluate(ev) {
				if strings.HasPrefix(h.Rule.ID, "d4e5f607-") {
					names = append(names, h.Rule.Name)
				}
			}
			if tc.rule == "" {
				if len(names) != 0 {
					t.Fatalf("benign twin fired new rules: %v", names)
				}
			} else if len(names) != 1 || names[0] != tc.rule {
				t.Fatalf("want exactly %q, got %v", tc.rule, names)
			}
			ev.Type = model.TypeImageLoad
			for _, h := range e.Evaluate(ev) {
				if strings.HasPrefix(h.Rule.ID, "d4e5f607-") {
					t.Fatal("file-write rule fired on an image-load event")
				}
			}
		})
	}
}

func TestStartupUsesCanonicalPathWithoutExtensionMetadata(t *testing.T) {
	e := loadTestEngine(t)
	for _, tc := range []struct {
		path, ext string
		want      bool
	}{
		{`C:\Users\ana\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\launch.LNK`, "", true},
		{`C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\launch.exe`, ".exe", true},
		{`C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\launch.ps1`, "txt", true},
		{`C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\readme.txt`, "exe", false},
		{`C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup-backup\launch.exe`, "exe", false},
	} {
		ev := testEvent("explorer.exe", "")
		ev.Type = model.TypeFileWrite
		ev.File = &model.File{Path: tc.path, Extension: tc.ext}
		found := false
		for _, h := range e.Evaluate(ev) {
			if h.Rule.ID == "a04b5c73-8d9e-4fa0-c1b2-3d4e5f6a7b80" {
				found = true
			}
		}
		if found != tc.want {
			t.Errorf("%s (extension %q): hit=%v want %v", tc.path, tc.ext, found, tc.want)
		}
	}
}

func TestOfficeParentAlarmSurvivesPartialTelemetry(t *testing.T) {
	e := loadTestEngine(t)
	en := enrich.New()
	parent := testEvent("WINWORD.EXE", "")
	parent.Process.PID = 900
	en.Apply(parent)
	partial := testEvent("", "")
	partial.Type = model.TypeFileWrite
	partial.Process = &model.Process{PID: 900}
	en.Apply(partial)
	child := testEvent("cmd.exe", "cmd.exe /c whoami")
	en.Apply(child)
	for _, hit := range e.Evaluate(child) {
		if hit.Rule.ID == "b2c3d4e5-0005-4b05-9e05-050505050505" {
			return
		}
	}
	t.Fatalf("Office parent detection missed after file telemetry: %v", child.Enrichment)
}
