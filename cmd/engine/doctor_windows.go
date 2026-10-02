//go:build windows

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

const doctorSysmonProbeLimit = 4096

// The probe emits only fixed diagnostic fields. It never prints a record,
// changes the log configuration, installs Sysmon, or requests elevation.
// Error IDs and exception types keep classification independent of locale.
const doctorSysmonScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Test-AccessDenied($record) {
    $exception = $record.Exception
    while ($null -ne $exception) {
        if ($exception -is [System.UnauthorizedAccessException] -or
            $exception -is [System.Security.SecurityException] -or
            (($exception.HResult -band 65535) -eq 5) -or
            (($exception -is [System.ComponentModel.Win32Exception]) -and $exception.NativeErrorCode -eq 5)) {
            return $true
        }
        $exception = $exception.InnerException
    }
    return $false
}
$result = [ordered]@{ exists = 'unknown'; access = 'unknown'; enabled = $null }
try {
    $log = Get-WinEvent -ListLog 'Microsoft-Windows-Sysmon/Operational' -ErrorAction Stop
    $result.exists = 'present'
    $result.enabled = [bool]$log.IsEnabled
} catch {
    if (Test-AccessDenied $_) {
        $result.access = 'denied'
    } elseif ($_.FullyQualifiedErrorId -like 'NoMatchingLogsFound*' -or $_.Exception -is [System.Diagnostics.Eventing.Reader.EventLogNotFoundException]) {
        $result.exists = 'missing'
    }
}
if ($result.exists -eq 'present') {
    try {
        Get-WinEvent -LogName 'Microsoft-Windows-Sysmon/Operational' -MaxEvents 1 -ErrorAction Stop | Out-Null
        $result.access = 'readable'
    } catch {
        if (Test-AccessDenied $_) {
            $result.access = 'denied'
        } elseif ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') {
            $result.access = 'empty'
        }
    }
}
$result | ConvertTo-Json -Compress
`

type doctorSysmonState struct {
	Exists  string `json:"exists"`
	Access  string `json:"access"`
	Enabled *bool  `json:"enabled"`
}

type doctorSysmonProbe func(context.Context) (doctorSysmonState, error)

func platformDoctorChecks(ctx context.Context, root string, sensor string) []doctorCheck {
	return platformDoctorChecksWithProbe(ctx, root, sensor, probeDoctorSysmon)
}

func platformDoctorChecksWithProbe(ctx context.Context, root string, sensor string, probe doctorSysmonProbe) []doctorCheck {
	checks := []doctorCheck{
		{Name: "Registro Sysmon", Status: "skip", Detail: "Este modo de sensor no utiliza Sysmon."},
		{Name: "Lectura de Sysmon", Status: "skip", Detail: "Este modo de sensor no utiliza Sysmon."},
		{Name: "Sensor ETW", Status: "skip", Detail: "ETW no esta seleccionado; usa --sensor etw para comprobar el binario instalado."},
	}
	if sensor == "etw" {
		path := filepath.Join(root, "bin", "security-sensor.exe")
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			checks[2].Status = "error"
			checks[2].Detail = "El binario instalado del sensor ETW falta o no es accesible: " + path
			checks[2].Remedy = "Compila/instala el sensor Rust con -WithSensor y vuelve a ejecutar doctor."
		} else {
			checks[2].Status = "ok"
			checks[2].Detail = "Existe el binario del sensor ETW. Solo se comprueba la instalacion; los permisos y la captura real de procesos requieren validacion en Windows con el sensor activo."
		}
		return checks
	}
	if sensor != "auto" && sensor != "sysmon" {
		return checks
	}
	problemStatus := "warn"
	if sensor == "sysmon" {
		problemStatus = "error"
	}
	checks[0].Status = problemStatus
	checks[1].Detail = "La disponibilidad de Sysmon no esta confirmada."
	state, err := probe(ctx)
	if err != nil {
		checks[0].Detail = "No se pudo consultar Sysmon mediante Windows PowerShell nativo."
		if errors.Is(err, context.DeadlineExceeded) {
			checks[0].Detail = "La consulta de solo lectura a Sysmon agoto su tiempo limite."
		} else if errors.Is(err, context.Canceled) {
			checks[0].Detail = "La consulta de solo lectura a Sysmon fue cancelada."
		}
		checks[0].Remedy = "Comprueba que Windows PowerShell nativo esta disponible y vuelve a ejecutar doctor."
		return checks
	}
	switch state.Exists {
	case "missing":
		checks[0].Detail = "El canal Microsoft-Windows-Sysmon/Operational no esta instalado."
		checks[0].Remedy = "Configura Sysmon con sf-sensor -SetupSysmon o selecciona una fuente ETW/providers ya configurada."
		checks[1].Detail = "No existe un registro Sysmon que consultar."
		return checks
	case "present":
		if state.Enabled != nil && *state.Enabled {
			checks[0].Status = "ok"
			checks[0].Detail = "El registro Sysmon Operational existe y esta habilitado. La captacion activa no esta verificada."
		} else {
			checks[0].Detail = "El registro Sysmon Operational existe pero esta deshabilitado."
			checks[0].Remedy = "Revisa el servicio Sysmon y la configuracion del registro de eventos antes de iniciar el sensor."
		}
	default:
		checks[0].Detail = "No se pudo confirmar la disponibilidad del registro Sysmon."
		checks[0].Remedy = "Revisa el acceso al registro de eventos de Windows y vuelve a ejecutar doctor."
	}
	switch state.Access {
	case "readable":
		checks[1].Status = "ok"
		checks[1].Detail = "El usuario actual puede consultar el registro Sysmon; se omite el contenido de los eventos."
	case "empty":
		checks[1].Status = "ok"
		checks[1].Detail = "La consulta Sysmon esta permitida, pero el registro esta vacio. No confirma telemetria activa."
	case "denied":
		checks[1].Status = problemStatus
		checks[1].Detail = "El usuario actual no tiene permiso para leer el registro de eventos Sysmon."
		checks[1].Remedy = "Usa una cuenta con permiso de lectura o solicita a un administrador acceso mediante Event Log Readers y vuelve a abrir la sesion."
	default:
		checks[1].Status = problemStatus
		checks[1].Detail = "No se pudo confirmar el permiso de lectura del registro Sysmon."
		checks[1].Remedy = "Comprueba el servicio Windows Event Log y los permisos de lectura y vuelve a ejecutar doctor."
	}
	return checks
}

func parseDoctorSysmonState(data []byte) (doctorSysmonState, error) {
	var state doctorSysmonState
	if len(data) > doctorSysmonProbeLimit {
		return state, errors.New("sysmon probe output exceeds the diagnostic limit")
	}
	// Accept a BOM from Windows PowerShell without accepting diagnostic text
	// before or after the single structured response.
	data = bytes.TrimPrefix(bytes.TrimSpace(data), []byte{0xef, 0xbb, 0xbf})
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return state, errors.New("invalid Sysmon probe response")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return state, errors.New("invalid Sysmon probe response")
	}
	validExists := state.Exists == "present" || state.Exists == "missing" || state.Exists == "unknown"
	validAccess := state.Access == "readable" || state.Access == "empty" || state.Access == "denied" || state.Access == "unknown"
	if !validExists || !validAccess || (state.Exists == "present" && state.Enabled == nil) ||
		(state.Exists != "present" && state.Enabled != nil) ||
		(state.Exists == "missing" && state.Access != "unknown") ||
		(state.Exists == "unknown" && (state.Access == "readable" || state.Access == "empty")) {
		return state, errors.New("invalid Sysmon probe state")
	}
	return state, nil
}

// Continue draining output after the limit, so an unexpected response cannot
// cause unbounded allocation or block the child process's stdout pipe.
type doctorProbeBuffer struct {
	buffer    bytes.Buffer
	truncated bool
}

func (b *doctorProbeBuffer) Write(p []byte) (int, error) {
	remaining := doctorSysmonProbeLimit - b.buffer.Len()
	if len(p) > remaining {
		b.truncated = true
		if remaining > 0 {
			_, _ = b.buffer.Write(p[:remaining])
		}
	} else {
		_, _ = b.buffer.Write(p)
	}
	return len(p), nil
}

func probeDoctorSysmon(ctx context.Context) (doctorSysmonState, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return doctorSysmonState{}, err
	}
	// Resolve the OS-bundled executable rather than a PATH entry. Sysnative
	// reaches 64-bit PowerShell when doctor itself is a 32-bit process.
	windowsRoot := os.Getenv("SystemRoot")
	if windowsRoot == "" {
		windowsRoot = `C:\Windows`
	}
	powershell := filepath.Join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	sysnative := filepath.Join(windowsRoot, "Sysnative", "WindowsPowerShell", "v1.0", "powershell.exe")
	if info, err := os.Stat(sysnative); err == nil && info.Mode().IsRegular() {
		powershell = sysnative
	}
	cmd := exec.CommandContext(ctx, powershell, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", doctorSysmonScript)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output := &doctorProbeBuffer{}
	cmd.Stdout = output
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return doctorSysmonState{}, ctx.Err()
		}
		return doctorSysmonState{}, fmt.Errorf("native PowerShell probe failed: %w", err)
	}
	if output.truncated {
		return doctorSysmonState{}, errors.New("sysmon probe output exceeds the diagnostic limit")
	}
	return parseDoctorSysmonState(output.buffer.Bytes())
}
