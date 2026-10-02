//go:build !windows

package main

import "context"

func platformDoctorChecks(_ context.Context, _ string, sensor string) []doctorCheck {
	checks := []doctorCheck{
		{Name: "Registro Sysmon", Status: "skip", Detail: "La telemetria Sysmon solo esta disponible en Windows."},
		{Name: "Lectura de Sysmon", Status: "skip", Detail: "Los permisos del registro de eventos de Windows no se aplican en esta plataforma."},
		{Name: "Sensor ETW", Status: "skip", Detail: "El sensor ETW incluido solo esta disponible en Windows."},
	}
	if sensor == "sysmon" {
		checks[0].Status = "error"
		checks[0].Remedy = "Ejecuta el sensor Sysmon en Windows o selecciona --sensor providers para una fuente externa."
	}
	if sensor == "etw" {
		checks[2].Status = "error"
		checks[2].Remedy = "Ejecuta el sensor ETW en Windows o selecciona --sensor providers para una fuente externa."
	}
	return checks
}
