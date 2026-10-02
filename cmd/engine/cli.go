// Cobra command tree of the engine, including operational diagnostics.
// The root only serves help; the no-subcommand invocation never gets
// here (main routes it to legacyMain so the single-dash flags keep
// working exactly as before).
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/spf13/cobra"
)

const engineLong = `Motor de deteccion de bluetardigrade: ingiere eventos NDJSON de
los sensores, los enriquece, evalua reglas YAML, correlaciona cadenas
de kill-chain y emite alertas por consola, API local y webhook.

Invocado sin subcomando conserva el comportamiento clasico: arranca el
motor con las banderas de un solo guion (-addr, -api, -rules, ...).`

const engineExamples = `  engine run                     arranca el motor con los valores por defecto
  engine run -i                  motor mas panel interactivo (TTY)
  engine -addr 0.0.0.0:7777      modo clasico: sin subcomando, banderas de un guion
  engine rules                   tabla de las reglas cargadas
  engine validate                valida reglas y secuencias y reporta avisos
  engine doctor                  diagnostica instalacion y telemetria sin generar eventos
  engine sigma -dir corpus -out rules/convertidas.yaml   convierte reglas Sigma
  engine report --alert ID --interactive --out reports/ID.md   informe humano
  engine ingest-identity --name wks-01 --host WKS-01   credencial de ingesta por sensor
  engine operator-credential --name ana   credencial propia de un operador de respuesta activa
  engine version                 version, runtime de Go y plataforma`

const runLong = `Arranca el motor completo: ingesta TCP de eventos NDJSON, enriquecido,
evaluacion de reglas YAML, correlacion de kill-chains, API local para
la consola y webhook saliente opcional.

Acepta todas las banderas clasicas de un guion (-addr, -api, -rules,
-sequences, -v, -reload-every, -webhook, -token) y ademas -i y
--interactive para el panel interactivo. Con stdout redirigido (sin
TTY) el panel se omite y la ejecucion degrada a la salida plana.`

const runExamples = `  engine run                       valores por defecto (loopback 7777/7778)
  engine run -i                    panel interactivo sobre el motor
  engine run -addr 0.0.0.0:7777 -token s3cr3t   sensores remotos con auth
  engine run -webhook http://127.0.0.1:9000/siem entrega cada alerta por webhook
  engine run -v -reload-every 30s  log de eventos y hot-reload cada 30s`

const rulesLong = `Carga el arbol de reglas y lo presenta en una tabla: id, nombre,
severidad (con color por severidad), tipo de evento y tags ATT&CK.
El recuento se obtiene del arbol de reglas cargado.`

const validateLong = `Carga y valida reglas y secuencias sin arrancar el motor: reporta
errores de parseo o compilacion, secuencias con pasos que no apuntan a
ninguna regla cargada y avisos operativos. Exit code 0 si todo va
bien, distinto de 0 si hay errores.`

// Execute runs the Cobra tree. It is only invoked when the first
// argument is a routed subcommand or -h/--help.
func Execute() {
	if err := newRootCmd().Execute(); err != nil {
		var ec interface{ ExitCode() int }
		if errors.As(err, &ec) {
			os.Exit(ec.ExitCode())
		}
		fmt.Fprintln(os.Stderr, errStyle.Render("error: "+err.Error()))
		fmt.Fprintln(os.Stderr, dimStyle.Render("usa 'engine -h' para ver la ayuda"))
		os.Exit(1)
	}
}

func newRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:     "engine [comando]",
		Short:   "Motor de deteccion de bluetardigrade",
		Long:    engineLong,
		Example: engineExamples,
		// Errors are rendered by Execute (red "error:" line + hint),
		// and usage is never dumped for command errors.
		SilenceErrors:     true,
		SilenceUsage:      true,
		CompletionOptions: cobra.CompletionOptions{HiddenDefaultCmd: true},
	}
	root.SetHelpFunc(func(cmd *cobra.Command, args []string) {
		fmt.Fprint(cmd.OutOrStdout(), buildHelp(cmd))
	})
	root.AddCommand(newRunCmd(), newRulesCmd(), newValidateCmd(), newDoctorCmd(), newSigmaCmd(), newReportCmd(), newIngestIdentityCmd(), newOperatorCredentialCmd(), newVersionCmd())
	return root
}

func newRunCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "run",
		Short:   "Arranca el motor (ingesta, reglas, correlacion, API, webhook)",
		Long:    runLong,
		Example: runExamples,
		// The historical flags are single-dash (-addr): cobra/pflag
		// would reject them, so parsing is done manually with the same
		// stdlib flag.FlagSet the classic path uses.
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			opts := &options{}
			interactive := false
			fs := newRunFlagSet("engine run", opts, &interactive, flag.ContinueOnError)
			fs.SetOutput(io.Discard)
			if err := fs.Parse(args); err != nil {
				if errors.Is(err, flag.ErrHelp) {
					return cmd.Help()
				}
				return fmt.Errorf("banderas invalidas para 'run': %v", err)
			}
			if fs.NArg() > 0 {
				return fmt.Errorf("argumentos inesperados para 'run': %s; usa 'engine run -h'", strings.Join(fs.Args(), " "))
			}
			return runEngine(opts, interactive)
		},
	}
}

func newRulesCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "rules",
		Short:   "Tabla de las reglas cargadas (nombre, severidad, tipo, tags ATT&CK)",
		Long:    rulesLong,
		Example: "  engine rules\n  engine rules -rules ./rules",
		// -rules (single dash) for muscle memory: manual parse too.
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			fs, rulesDir := newRulesFlagSet()
			fs.SetOutput(io.Discard)
			if err := fs.Parse(args); err != nil {
				if errors.Is(err, flag.ErrHelp) {
					return cmd.Help()
				}
				return fmt.Errorf("banderas invalidas para 'rules': %v", err)
			}
			if fs.NArg() > 0 {
				return fmt.Errorf("argumentos inesperados para 'rules': %s; usa 'engine rules -h'", strings.Join(fs.Args(), " "))
			}
			return runRules(cmd.OutOrStdout(), *rulesDir)
		},
	}
}

func newValidateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "validate",
		Short: "Valida reglas y secuencias y reporta OK, avisos y errores",
		Long:  validateLong,
		Example: `  engine validate
  engine validate -rules ./rules -sequences ./sequences
  engine validate -rules /tmp/reglas-rota   (fallo con exit 1)`,
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			fs, rulesDir, seqDir := newValidateFlagSet()
			fs.SetOutput(io.Discard)
			if err := fs.Parse(args); err != nil {
				if errors.Is(err, flag.ErrHelp) {
					return cmd.Help()
				}
				return fmt.Errorf("banderas invalidas para 'validate': %v", err)
			}
			if fs.NArg() > 0 {
				return fmt.Errorf("argumentos inesperados para 'validate': %s; usa 'engine validate -h'", strings.Join(fs.Args(), " "))
			}
			rep := runValidation(*rulesDir, *seqDir)
			fmt.Fprint(cmd.OutOrStdout(), renderValidateReport(rep))
			if rep.failed() {
				return exitErr{code: 1}
			}
			return nil
		},
	}
}

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Muestra la version del motor y datos de compilacion",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Fprint(cmd.OutOrStdout(), renderVersion(buildInfoNow()))
			return nil
		},
	}
}

func newRulesFlagSet() (*flag.FlagSet, *string) {
	fs := flag.NewFlagSet("engine rules", flag.ContinueOnError)
	rulesDir := fs.String("rules", "./rules", "directorio con reglas YAML")
	return fs, rulesDir
}

func newValidateFlagSet() (*flag.FlagSet, *string, *string) {
	fs := flag.NewFlagSet("engine validate", flag.ContinueOnError)
	rulesDir := fs.String("rules", "./rules", "directorio con reglas YAML")
	seqDir := fs.String("sequences", "./sequences", "directorio con secuencias YAML (kill-chain)")
	return fs, rulesDir, seqDir
}

// runRules loads the rule tree and prints the table.
func runRules(out io.Writer, flagPath string) error {
	path := resolveDataDir(flagPath, "rules")
	eng, err := rules.LoadDir(path)
	if err != nil {
		return fmt.Errorf("no se pudieron cargar las reglas desde %s: %w", path, err)
	}
	fmt.Fprintln(out, renderRulesSummary(path, eng))
	fmt.Fprintln(out, renderRulesTable(eng.Snapshot()))
	return nil
}

// exitErr makes a command request a specific exit code after it has
// already printed its own report (validate).
type exitErr struct {
	code int
}

// Error implements the error interface: the message carries the exit status.
func (e exitErr) Error() string { return fmt.Sprintf("exit %d", e.code) }

// ExitCode implements cobra's ExitCoder so a command can request a
// specific process status after printing its own report.
func (e exitErr) ExitCode() int { return e.code }

// ---- validate ----

const (
	checkOK = iota
	checkWarn
	checkError
)

type check struct {
	status int
	detail string
}

type validationReport struct {
	rulesPath string
	seqsPath  string
	checks    []check
	errCount  int
	warnCount int
}

func (r *validationReport) add(status int, format string, args ...any) {
	r.checks = append(r.checks, check{status: status, detail: fmt.Sprintf(format, args...)})
	switch status {
	case checkError:
		r.errCount++
	case checkWarn:
		r.warnCount++
	}
}

func (r *validationReport) failed() bool { return r.errCount > 0 }

// runValidation loads rules and sequences exactly like runEngine does
// (same resolution order) and collects a readable report. Errors are
// parse/compile failures; warnings are operational situations the
// engine tolerates (missing sequences dir, zero rules, dead step
// references). The two trees are checked independently so one broken
// half does not hide the state of the other.
func runValidation(rulesFlag, seqsFlag string) *validationReport {
	rep := &validationReport{}
	rep.rulesPath = resolveDataDir(rulesFlag, "rules")
	rep.seqsPath = resolveDataDir(seqsFlag, "sequences")

	ruleNames := map[string]bool{}
	rulesOK := false
	eng, err := rules.LoadDir(rep.rulesPath)
	if err != nil {
		rep.add(checkError, "reglas: no se pudieron cargar desde %s: %v", rep.rulesPath, err)
	} else {
		rulesOK = true
		for _, r := range eng.Snapshot() {
			ruleNames[r.Name] = true
		}
		rep.add(checkOK, "reglas: %d cargadas (tipos: %v)", eng.Count(), eng.Types())
		if eng.Count() == 0 {
			rep.add(checkWarn, "reglas: el arbol no activo ninguna regla; el motor no detectara nada")
		}
	}

	if !dirExists(rep.seqsPath) {
		rep.add(checkWarn, "secuencias: el directorio %s no existe; el correlator quedara desactivado", rep.seqsPath)
	} else {
		corr, err := correlate.LoadDir(rep.seqsPath, nil)
		if err != nil {
			rep.add(checkError, "secuencias: no se pudieron cargar desde %s: %v", rep.seqsPath, err)
		} else {
			rep.add(checkOK, "secuencias: %d cargadas (%s)", corr.Count(), strings.Join(corr.Names(), ", "))
			// dead steps: a sequence referencing a rule name that is
			// not loaded can never complete; the engine tolerates it
			// but the operator should know.
			if rulesOK {
				for _, seq := range corr.Snapshot() {
					for _, stepRule := range seq.Steps {
						if !ruleNames[stepRule] {
							rep.add(checkWarn,
								"secuencia %q: el paso %q no corresponde a ninguna regla cargada; ese paso nunca se completara",
								seq.Name, stepRule)
						}
					}
				}
			}
		}
	}
	return rep
}

// ---- help rendering ----

// buildHelp renders the pretty help: title, description, usage,
// commands or flags, and examples. It replaces the default cobra help
// for the root and every subcommand (SetHelpFunc propagates).
func buildHelp(cmd *cobra.Command) string {
	var sb strings.Builder
	sb.WriteString(titleStyle.Render(strings.ToUpper(cmd.Name())) + "\n")
	if l := cmd.Long; l != "" {
		sb.WriteString("\n" + l + "\n")
	} else if s := cmd.Short; s != "" {
		sb.WriteString("\n" + s + "\n")
	}
	sb.WriteString("\n" + sectionSty.Render("USO") + "\n  " + cmd.UseLine() + "\n")

	if cmd.HasAvailableSubCommands() {
		sb.WriteString("\n" + sectionSty.Render("COMANDOS") + "\n")
		for _, sub := range cmd.Commands() {
			if sub.Hidden || !sub.IsAvailableCommand() {
				continue
			}
			sb.WriteString("  " + okStyle.Render(pad(sub.Name(), 11)) + sub.Short + "\n")
		}
	}

	if rows := helpFlagRows(cmd); len(rows) > 0 {
		sb.WriteString("\n" + sectionSty.Render("BANDERAS") + "\n")
		w := 0
		for _, r := range rows {
			if len(r[0]) > w {
				w = len(r[0])
			}
		}
		for _, r := range rows {
			sb.WriteString("  " + dimStyle.Render(pad(r[0], w+2)) + r[1] + "\n")
		}
	}

	if ex := cmd.Example; ex != "" {
		sb.WriteString("\n" + sectionSty.Render("EJEMPLOS") + "\n" + ex + "\n")
	}
	return sb.String()
}

// helpFlagRows returns the flag documentation of a command. The
// engine flags live in stdlib flag sets (single-dash compatibility),
// so the help lists them from there instead of pflag.
func helpFlagRows(cmd *cobra.Command) [][2]string {
	switch cmd.Name() {
	case "doctor":
		fs, _ := newDoctorFlagSet()
		return flagRows(fs)
	case "report":
		return [][2]string{{"--alert string", "ID de alerta (16 hex)"}, {"--api string", "API HTTP local o HTTPS remoto"}, {"--interactive", "Entrevista de investigacion"}, {"--notes string", "Campos humanos en JSON estricto"}, {"--format string", "md o json (por defecto md)"}, {"--out string", "Archivo nuevo para el informe"}}
	case "run":
		return flagRows(newRunFlagSet("engine run", &options{}, new(bool), flag.ContinueOnError))
	case "rules":
		fs, _ := newRulesFlagSet()
		return flagRows(fs)
	case "validate":
		fs, _, _ := newValidateFlagSet()
		return flagRows(fs)
	}
	return nil
}

// flagRows turns a stdlib flag set into aligned help rows. Boolean
// flags render without a value placeholder; durations are detected
// via their default value (the flag package does not expose types).
func flagRows(fs *flag.FlagSet) [][2]string {
	var rows [][2]string
	fs.VisitAll(func(f *flag.Flag) {
		left := "-" + f.Name
		isBool := f.DefValue == "true" || f.DefValue == "false"
		if !isBool {
			typ := "string"
			if _, err := time.ParseDuration(f.DefValue); err == nil {
				typ = "duration"
			}
			left += " " + typ
		}
		rows = append(rows, [2]string{left, f.Usage})
	})
	return rows
}
