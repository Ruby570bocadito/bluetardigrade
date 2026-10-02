// Command engine is the detection engine binary: it ingests NDJSON
// event streams from sensors, enriches them, evaluates YAML rules and
// raises alerts.
//
// Since the CLI round it also exposes a subcommand surface (run, rules,
// validate, version) built on Cobra with a lipgloss presentation layer,
// but the no-subcommand invocation keeps the historical single-dash
// flag behavior byte for byte (see legacyMain).
package main

import (
	"flag"
	"log"
	"os"
)

func main() {
	log.SetFlags(0)

	if len(os.Args) > 1 && isRoutedSubcommand(os.Args[1]) {
		Execute()
		return
	}
	legacyMain()
}

// isRoutedSubcommand reports whether the first CLI argument belongs to
// the Cobra command tree. Everything else (bare invocation, the classic
// single-dash flags, unknown junk that the stdlib flag package would
// treat as a positional) keeps the pre-CLI behavior unchanged.
func isRoutedSubcommand(arg string) bool {
	switch arg {
	case "run", "rules", "validate", "version", "sigma", "report",
		"help", "completion", "__complete", "__completeNoDesc",
		"-h", "--help":
		return true
	}
	return false
}

// legacyMain is the historical entry path: a stdlib flag.FlagSet with
// ExitOnError parses os.Args, so "-addr x", "--addr x", "-flag=value",
// the "stop parsing at the first positional" rule and the error/exit
// semantics (usage on stderr, exit 2 on a bad flag, exit 0 on -h
// buried after other flags) are exactly the ones the engine always had.
func legacyMain() {
	opts := &options{}
	interactive := false
	fs := newRunFlagSet(os.Args[0], opts, &interactive, flag.ExitOnError)
	_ = fs.Parse(os.Args[1:]) // ExitOnError: never returns on error
	if err := runEngine(opts, interactive); err != nil {
		// runEngine returns only the errors that must reach the
		// operator verbatim (half-set TLS flags, ...); its own fatal
		// paths already printed. The CLI "run" subcommand prints the
		// same error through Cobra — the legacy path stays fail-loud
		// too instead of exiting with an unexplained status.
		log.Printf("[ENGINE] %v", err)
		os.Exit(1)
	}
}
