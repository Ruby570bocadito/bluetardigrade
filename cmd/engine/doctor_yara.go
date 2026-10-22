package main

// Doctor checks for the YARA rule pack (-yara-rules, M-3). The pack is
// optional, so its failure modes are quiet: an empty or unreadable
// directory leaves the distribution silently disabled, and a file a
// sensor refuses (not UTF-8, beyond the cap) just drops out of the
// bundle. The check reuses the engine's own loader (internal/yara), so
// what the doctor reports is exactly what loadYara would serve, and it
// resolves the directory with the same rule the engine uses.

import (
	"fmt"
	"strings"

	"github.com/Ruby570bocadito/bluetardigrade/internal/yara"
)

// doctorYaraChecks validates the rule pack directory the engine would
// load: the same default, the same -yara-rules flag and the same
// resolveDataDir fallback as loadYara.
func doctorYaraChecks(flagDir string) []doctorCheck {
	const name = "Reglas YARA"
	if flagDir == "" {
		return []doctorCheck{{name, "skip", "Sin -yara-rules: la distribucion de reglas YARA esta desactivada", ""}}
	}
	dir := resolveDataDir(flagDir, "yara-rules")
	if !dirExists(dir) {
		return []doctorCheck{{name, "skip", "Sin directorio de reglas YARA en " + dir + " (es opcional): el motor arranca sin pack y los sensores no reciben reglas", "Crea el directorio y deja en el ficheros .yar (rules/ del paquete es la referencia del formato)"}}
	}
	store, err := yara.Load(dir)
	if err != nil {
		return []doctorCheck{{name, "error", "El pack no se puede leer: " + err.Error(), "Revisa la ruta y los permisos de " + dir + "; el motor arrancaria sin pack"}}
	}
	store.Refresh()
	snap := store.Snapshot()
	if len(snap.Files) == 0 {
		if len(snap.Problems) == 0 {
			return []doctorCheck{{name, "warn", "El directorio existe y no tiene ficheros de reglas: la distribucion YARA sigue desactivada en la practica", "Deja ficheros .yar en " + dir + ", o retira la bandera -yara-rules si no vas a usar YARA"}}
		}
		return []doctorCheck{{name, "error", "Ningun fichero del pack es utilizable: " + strings.Join(snap.Problems, "; "), "Corrige o retira los ficheros nombrados; el motor arrancaria sin pack"}}
	}
	what := fmt.Sprintf("%d ficheros de reglas (%d bytes)", len(snap.Files), snap.TotalBytes)
	if snap.Sha16 != "" {
		what += ", sha16 " + snap.Sha16
	}
	checks := []doctorCheck{}
	if snap.TotalBytes > yara.MaxPackBytes {
		checks = append(checks, doctorCheck{name, "error", what + ": el pack pasa del tope de distribucion (32 MiB) y la descarga del bundle falla entera", "Recorta el pack: el tope protege la memoria del sensor al compilar"})
	} else {
		checks = append(checks, doctorCheck{name, "ok", what + "; listo para distribuir a los sensores", ""})
	}
	for _, p := range snap.Problems {
		checks = append(checks, doctorCheck{"Fichero YARA", "warn", p, "Un fichero que el sensor rechaza no viaja en el bundle: corrigelo o retiralo del pack"})
	}
	return checks
}
