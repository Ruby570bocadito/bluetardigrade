package main

// Doctor checks for the offline threat-intel lists, the baseline
// learning setting and the console accounts file: the three operator
// files a typo can quietly disable (intel, baseline) or that lock the
// console (accounts) — caught here before a restart instead of after.

import (
	"bytes"
	"encoding/base32"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/hostgroup"
	"github.com/Ruby570bocadito/bluetardigrade/internal/ingest"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
	"github.com/Ruby570bocadito/bluetardigrade/internal/known"
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

	checks = append(checks, doctorConsoleUsers(root), doctorHostGroups(root), doctorIdentities(root), doctorKnownSoftware(root))
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

// doctorHostGroups validates the launcher's tools/config/host-groups.yaml
// with the engine's own loader: the launcher always passes it, and a
// malformed file stops the engine.
func doctorHostGroups(root string) doctorCheck {
	const name = "Grupos de equipos"
	path := filepath.Join(root, "tools", "config", "host-groups.yaml")
	if !fileExists(path) {
		return doctorCheck{name, "skip", "Sin grupos de equipos: se crean en la consola, Ajustes -> Grupos", ""}
	}
	set, _, err := hostgroup.Load(path)
	if err != nil {
		return doctorCheck{name, "error", err.Error() + ": el motor no arrancaria", "Corrige " + path + " o borralo y vuelve a crear los grupos desde la consola"}
	}
	n := len(set.Names())
	noun := "grupos"
	if n == 1 {
		noun = "grupo"
	}
	return doctorCheck{name, "ok", fmt.Sprintf("%d %s de equipos", n, noun), ""}
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
	counts, mfa, problem := validateConsoleUsers(data)
	if problem != "" {
		return doctorCheck{name, "error", problem + ": la consola quedaria bloqueada", "Corrige " + path + " (cada entrada se genera con web/console/scripts/console-user.mjs)"}
	}
	total := counts["admin"] + counts["analyst"] + counts["viewer"]
	noun := "cuentas"
	if total == 1 {
		noun = "cuenta"
	}
	detail := fmt.Sprintf("%d %s (administradores %d, analistas %d, lectores %d); verificacion en dos pasos: %d de %d", total, noun, counts["admin"], counts["analyst"], counts["viewer"], mfa.enrolled, total)
	if len(mfa.required) > 0 {
		detail += fmt.Sprintf(", obligatoria para %s", strings.Join(mfa.required, ", "))
		if mfa.pending > 0 {
			detail += fmt.Sprintf(" (%d la configuraran al entrar)", mfa.pending)
		}
	}
	if counts["disabled"] > 0 {
		detail += fmt.Sprintf("; deshabilitadas %d", counts["disabled"])
	}
	if counts["must_change"] > 0 {
		detail += fmt.Sprintf("; con contrasena temporal %d", counts["must_change"])
	}
	if counts["scoped"] > 0 {
		detail += fmt.Sprintf("; limitadas a grupos de equipos %d", counts["scoped"])
		if missing := missingAccountGroups(root, data); len(missing) > 0 {
			return doctorCheck{name, "warn", detail + ": " + strings.Join(missing, "; "), "Crea esos grupos en Ajustes -> Grupos o quitaselos a la cuenta en Ajustes -> Cuentas: un grupo que el motor no tiene no da acceso a ningun equipo"}
		}
	}
	if counts["enabled_admin"] == 0 {
		return doctorCheck{name, "warn", detail + ": ningun administrador habilitado", "Sin administrador nadie ve la auditoria, gestiona las cuentas ni puede usar la respuesta activa (sf-console -AddUser <nombre> crea uno)"}
	}
	return doctorCheck{name, "ok", detail, ""}
}

// consoleMFA summarizes two-step sign-in: accounts that have it, the
// roles that require it, and accounts of those roles still to enroll.
type consoleMFA struct {
	enrolled int
	required []string
	pending  int
}

var recoveryHash = regexp.MustCompile(`^[0-9a-f]{64}$`)

func validConsoleRole(r string) bool { return r == "admin" || r == "analyst" || r == "viewer" }

func validateConsoleUsers(data []byte) (map[string]int, consoleMFA, string) {
	var mfa consoleMFA
	// Notepad and PowerShell 5 may save a UTF-8 BOM; the console strips it too
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	var doc struct {
		MFARequired *[]string `json:"mfa_required"`
		Users       []struct {
			User     string    `json:"user"`
			Role     string    `json:"role"`
			Password string    `json:"password"`
			TOTP     *string   `json:"totp"`
			Recovery *[]string `json:"recovery"`
			// raw, so a non-boolean is named like the console names it
			Disabled   json.RawMessage `json:"disabled"`
			MustChange json.RawMessage `json:"must_change"`
			Groups     json.RawMessage `json:"groups"`
		} `json:"users"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		var list []json.RawMessage
		if json.Unmarshal(data, &list) != nil {
			return nil, mfa, "El fichero de cuentas no es JSON valido"
		}
		wrapped, _ := json.Marshal(map[string]any{"users": list})
		if err := json.Unmarshal(wrapped, &doc); err != nil {
			return nil, mfa, "El fichero de cuentas no es JSON valido"
		}
	}
	if len(doc.Users) == 0 {
		return nil, mfa, "El fichero de cuentas no tiene cuentas"
	}
	required := map[string]bool{}
	if doc.MFARequired != nil {
		for _, r := range *doc.MFARequired {
			if !validConsoleRole(r) {
				return nil, mfa, "mfa_required debe ser una lista de roles (admin, analyst, viewer)"
			}
			if !required[r] {
				mfa.required = append(mfa.required, r)
			}
			required[r] = true
		}
	}
	counts := map[string]int{}
	seen := map[string]bool{}
	for i, u := range doc.Users {
		user := strings.TrimSpace(u.User)
		if !consoleUserName.MatchString(user) {
			return nil, mfa, fmt.Sprintf("Cuenta %d: nombre de usuario invalido", i+1)
		}
		if seen[strings.ToLower(user)] {
			return nil, mfa, fmt.Sprintf("Cuenta %s: repetida", user)
		}
		seen[strings.ToLower(user)] = true
		if !validConsoleRole(u.Role) {
			return nil, mfa, fmt.Sprintf("Cuenta %s: rol invalido (admin, analyst o viewer)", user)
		}
		if !validPasswordHash(u.Password) {
			return nil, mfa, fmt.Sprintf("Cuenta %s: contrasena con formato invalido", user)
		}
		disabled, ok1 := consoleFlag(u.Disabled)
		mustChange, ok2 := consoleFlag(u.MustChange)
		if !ok1 || !ok2 {
			return nil, mfa, fmt.Sprintf("Cuenta %s: disabled y must_change deben ser true o false", user)
		}
		if disabled {
			counts["disabled"]++
		} else if u.Role == "admin" {
			counts["enabled_admin"]++
		}
		if mustChange {
			counts["must_change"]++
		}
		groups, ok := consoleGroups(u.Groups)
		if !ok {
			return nil, mfa, fmt.Sprintf("Cuenta %s: groups debe ser una lista de nombres de grupo (minusculas, cifras, - y _; hasta %d)", user, maxAccountGroups)
		}
		if len(groups) > 0 && u.Role != "admin" {
			counts["scoped"]++
		}
		if u.TOTP != nil {
			if !validTOTPSecret(*u.TOTP) {
				return nil, mfa, fmt.Sprintf("Cuenta %s: secreto de verificacion en dos pasos invalido", user)
			}
			mfa.enrolled++
		} else if required[u.Role] {
			mfa.pending++
		}
		if u.Recovery != nil {
			if len(*u.Recovery) > 20 {
				return nil, mfa, fmt.Sprintf("Cuenta %s: codigos de recuperacion invalidos", user)
			}
			for _, h := range *u.Recovery {
				if !recoveryHash.MatchString(h) {
					return nil, mfa, fmt.Sprintf("Cuenta %s: codigos de recuperacion invalidos", user)
				}
			}
		}
		counts[u.Role]++
	}
	return counts, mfa, ""
}

// maxAccountGroups is the console's cap on an account's host groups.
const maxAccountGroups = 64

// consoleGroups reads an account's optional "groups": absent or null is
// none; otherwise a list of group names (any case), as the console reads
// it (cleanGroups in web/console/src/lib/users.ts).
func consoleGroups(raw json.RawMessage) ([]string, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, true
	}
	var list []string
	if json.Unmarshal(raw, &list) != nil || len(list) > maxAccountGroups {
		return nil, false
	}
	out := []string{}
	for _, g := range list {
		g = strings.ToLower(strings.TrimSpace(g))
		if !hostgroup.ValidName(g) {
			return nil, false
		}
		out = append(out, g)
	}
	return out, true
}

// missingAccountGroups names the groups the limited accounts of a valid
// users file use that the launcher's host-groups file does not define
// (nothing when that file is absent or broken: its own check reports it).
func missingAccountGroups(root string, data []byte) []string {
	set, _, err := hostgroup.Load(filepath.Join(root, "tools", "config", "host-groups.yaml"))
	if err != nil {
		return nil
	}
	known := map[string]bool{}
	for _, n := range set.Names() {
		known[n] = true
	}
	var doc struct {
		Users []struct {
			User   string          `json:"user"`
			Role   string          `json:"role"`
			Groups json.RawMessage `json:"groups"`
		} `json:"users"`
	}
	if json.Unmarshal(bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF}), &doc) != nil {
		return nil
	}
	var out []string
	for _, u := range doc.Users {
		if u.Role == "admin" {
			continue
		}
		groups, _ := consoleGroups(u.Groups)
		var gone []string
		for _, g := range groups {
			if !known[g] {
				gone = append(gone, g)
			}
		}
		if len(gone) > 0 {
			out = append(out, fmt.Sprintf("la cuenta %s nombra grupos que el motor no tiene (%s)", strings.TrimSpace(u.User), strings.Join(gone, ", ")))
		}
	}
	return out
}

// consoleFlag reads an optional boolean field: absent or null is false.
func consoleFlag(raw json.RawMessage) (value, ok bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return false, true
	}
	return string(raw) == "true", string(raw) == "true" || string(raw) == "false"
}

// validTOTPSecret applies the console's rule: base32 (any case, spaces
// and padding allowed) of 16 to 64 bytes.
func validTOTPSecret(s string) bool {
	clean := strings.ToUpper(strings.NewReplacer(" ", "", "=", "", "\t", "", "\n", "", "\r", "").Replace(s))
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(clean)
	return err == nil && len(key) >= 16 && len(key) <= 64
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

// doctorKnownSoftware validates the §2.2 known-software list with the
// engine's own parser: a malformed file is FATAL at engine startup
// (the engine refuses to run rather than silently disarm a list the
// operator believes is armed), so the doctor catches the typo before
// the restart does.
func doctorKnownSoftware(root string) doctorCheck {
	const name = "Software conocido"
	path := filepath.Join(root, "known-software.yaml")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return doctorCheck{name, "skip", "Sin lista de software conocido (es opcional): ningun evento se marca como conocido", "Copia known-software.example.yaml como known-software.yaml junto al motor y edita las entradas de tu organizacion"}
		}
		return doctorCheck{name, "error", "No se puede leer la lista: el motor no arrancaria", "Revisa los permisos de " + path}
	}
	sws, err := known.Parse(data)
	if err != nil {
		return doctorCheck{name, "error", "El motor no arrancaria: " + err.Error(), "Corrige " + path + " (known-software.example.yaml documenta el formato: version 1 y cada entrada con imagen o sha256)"}
	}
	if len(sws) == 0 {
		return doctorCheck{name, "warn", "La lista no tiene entradas: ningun evento se marcara como conocido", "Anade entradas (imagen o sha256) o retira el fichero"}
	}
	noun := "entradas validas de software conocido"
	if len(sws) == 1 {
		noun = "entrada valida de software conocido"
	}
	return doctorCheck{name, "ok", fmt.Sprintf("%d %s; los eventos coincidentes se marcan como conocidos y salen del ruido", len(sws), noun), ""}
}
