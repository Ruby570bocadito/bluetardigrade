package main

// Doctor checks for the offline threat-intel lists, the baseline
// learning setting and the console accounts file: the three operator
// files a typo can quietly disable (intel, baseline) or that lock the
// console (accounts) — caught here before a restart instead of after.

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ingest"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
)

func doctorIntelChecks(root string) []doctorCheck {
	checks := []doctorCheck{}
	dir := filepath.Join(root, "intel")
	if !dirExists(dir) {
		checks = append(checks, doctorCheck{"Inteligencia", "skip", "No hay carpeta intel: las listas de indicadores estan desactivadas", "Crea la carpeta intel y deja en ella ficheros .txt o .list (ver intel/README.md)"})
	} else if m, err := intel.Load(dir); err != nil {
		checks = append(checks, doctorCheck{"Inteligencia", "error", "Una lista no se puede leer: " + err.Error(), "Corrige o retira el fichero; el motor conserva las listas anteriores y lo reintenta en cada recarga"})
	} else if m.Total() == 0 {
		checks = append(checks, doctorCheck{"Inteligencia", "skip", "La carpeta intel no tiene indicadores (es opcional)", "Deja ficheros .txt o .list con un indicador por linea si quieres usarla"})
	} else {
		lists := "listas"
		if len(m.Lists()) == 1 {
			lists = "lista"
		}
		checks = append(checks, doctorCheck{"Inteligencia", "ok", fmt.Sprintf("%d indicadores en %d %s", m.Total(), len(m.Lists()), lists), ""})
		for _, l := range m.Lists() {
			if l.Skipped > 0 {
				checks = append(checks, doctorCheck{"Lista " + l.Name, "warn", fmt.Sprintf("%d lineas descartadas: no son comentarios ni un indicador utilizable", l.Skipped), "Revisa el formato en intel/README.md (loopback, multicast y texto suelto se descartan)"})
			}
		}
	}

	learn, source := os.Getenv("SF_BASELINE_LEARN"), "SF_BASELINE_LEARN"
	if learn == "" {
		if data, err := os.ReadFile(filepath.Join(root, "tools", "config", "baseline.learn")); err == nil {
			learn, source = strings.TrimSpace(string(bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF}))), "tools/config/baseline.learn"
		}
	}
	if learn != "" {
		if d, err := time.ParseDuration(learn); err != nil || d < 0 {
			checks = append(checks, doctorCheck{"Linea base", "warn", fmt.Sprintf("%s = %q no es una duracion valida: el motor usa 24h", source, learn), "Usa valores como 30m, 24h o 0 (desactivada)"})
		} else if d == 0 {
			checks = append(checks, doctorCheck{"Linea base", "ok", fmt.Sprintf("Desactivada por %s", source), ""})
		} else {
			checks = append(checks, doctorCheck{"Linea base", "ok", fmt.Sprintf("Aprendizaje de %s por equipo (%s)", d, source), ""})
		}
	}

	checks = append(checks, doctorConsoleUsers(root), doctorIdentities(root))
	return checks
}

// doctorIdentities validates the per-sensor identities file with the
// engine's own loader: the engine refuses to start on a malformed one,
// and the launcher opens the ingest to the network only when it exists.
func doctorIdentities(root string) doctorCheck {
	const name = "Identidades de sensores"
	path := os.Getenv("SF_INGEST_IDENTITIES")
	if path == "" {
		path = filepath.Join(root, "tools", "config", "ingest-identities.yaml")
		if !fileExists(path) {
			return doctorCheck{name, "skip", "Sin fichero de identidades: la ingesta solo escucha en loopback", "Para vigilar otros equipos sigue docs/FLOTA-REMOTA.md"}
		}
	}
	ids, err := ingest.LoadIdentities(path)
	if err != nil {
		return doctorCheck{name, "error", "El motor no arrancaria: " + err.Error(), "Corrige " + path + " (empieza por «version: 1» e «identities:»; cada entrada sale de sf-engine ingest-identity)"}
	}
	if len(ids) == 0 {
		return doctorCheck{name, "warn", "El fichero no tiene identidades: ningun sensor remoto podra autenticarse", "Anade una entrada con sf-engine ingest-identity --name <nombre> --host <EQUIPO>"}
	}
	noun := "identidades de sensor validas"
	if len(ids) == 1 {
		noun = "identidad de sensor valida"
	}
	return doctorCheck{name, "ok", fmt.Sprintf("%d %s; la ingesta escucha en la red", len(ids), noun), ""}
}

var consoleUserName = regexp.MustCompile(`^[\p{L}\p{N}._@-]{1,64}$`)

// doctorConsoleUsers validates CONSOLE_USERS_FILE (or the launcher's
// tools/config/console-users.json) with the console's own rules
// (web/console/src/lib/users.ts): any bad entry rejects the file, and a
// rejected file locks the console.
func doctorConsoleUsers(root string) doctorCheck {
	const name = "Cuentas de la consola"
	path := os.Getenv("CONSOLE_USERS_FILE")
	if path == "" {
		path = filepath.Join(root, "tools", "config", "console-users.json")
		if !fileExists(path) {
			return doctorCheck{name, "skip", "Sin fichero de cuentas: la consola usa loopback o CONSOLE_ACCESS_TOKEN", ""}
		}
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) > 256*1024 {
		return doctorCheck{name, "error", "No se puede leer el fichero de cuentas: la consola quedaria bloqueada", "Revisa la ruta y los permisos de " + path}
	}
	counts, problem := validateConsoleUsers(data)
	if problem != "" {
		return doctorCheck{name, "error", problem + ": la consola quedaria bloqueada", "Corrige " + path + " (cada entrada se genera con web/console/scripts/console-user.mjs)"}
	}
	total := counts["admin"] + counts["analyst"] + counts["viewer"]
	noun := "cuentas"
	if total == 1 {
		noun = "cuenta"
	}
	detail := fmt.Sprintf("%d %s (administradores %d, analistas %d, lectores %d)", total, noun, counts["admin"], counts["analyst"], counts["viewer"])
	if counts["admin"] == 0 {
		return doctorCheck{name, "warn", detail + ": ningun administrador", "Sin administrador nadie ve la auditoria ni puede usar la respuesta activa"}
	}
	return doctorCheck{name, "ok", detail, ""}
}

func validateConsoleUsers(data []byte) (map[string]int, string) {
	// Notepad and PowerShell 5 may save a UTF-8 BOM; the console strips it too
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	var doc struct {
		Users []struct {
			User     string `json:"user"`
			Role     string `json:"role"`
			Password string `json:"password"`
		} `json:"users"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		var list []json.RawMessage
		if json.Unmarshal(data, &list) != nil {
			return nil, "El fichero de cuentas no es JSON valido"
		}
		wrapped, _ := json.Marshal(map[string]any{"users": list})
		if err := json.Unmarshal(wrapped, &doc); err != nil {
			return nil, "El fichero de cuentas no es JSON valido"
		}
	}
	if len(doc.Users) == 0 {
		return nil, "El fichero de cuentas no tiene cuentas"
	}
	counts := map[string]int{}
	seen := map[string]bool{}
	for i, u := range doc.Users {
		user := strings.TrimSpace(u.User)
		if !consoleUserName.MatchString(user) {
			return nil, fmt.Sprintf("Cuenta %d: nombre de usuario invalido", i+1)
		}
		if seen[strings.ToLower(user)] {
			return nil, fmt.Sprintf("Cuenta %s: repetida", user)
		}
		seen[strings.ToLower(user)] = true
		if u.Role != "admin" && u.Role != "analyst" && u.Role != "viewer" {
			return nil, fmt.Sprintf("Cuenta %s: rol invalido (admin, analyst o viewer)", user)
		}
		if !validPasswordHash(u.Password) {
			return nil, fmt.Sprintf("Cuenta %s: contrasena con formato invalido", user)
		}
		counts[u.Role]++
	}
	return counts, ""
}

func validPasswordHash(p string) bool {
	parts := strings.Split(p, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter < 100_000 || iter > 5_000_000 {
		return false
	}
	salt, err1 := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[2], "="))
	hash, err2 := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[3], "="))
	return err1 == nil && err2 == nil && len(salt) >= 16 && len(hash) == 32
}
