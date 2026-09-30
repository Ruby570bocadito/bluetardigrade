package main

// The `engine sigma` subcommand: converts Sigma YAML corpora into the
// engine's native rule format. All the conversion logic lives in
// internal/sigma; this file is CLI surface only (flags, report,
// exit codes) and follows the same conventions as the other
// subcommands: manual stdlib flag parsing so the single-dash flags
// keep working, Spanish report on stdout, exit code 1 on failure.

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/Ruby570bocadito/security-framework/internal/sigma"
	"github.com/spf13/cobra"
)

const sigmaLong = `Convierte un corpus de reglas Sigma (ficheros .yml/.yaml) al formato
nativo de reglas del motor, listo para cargar con -rules o validar
con 'engine validate'.

El conversor es determinista y fail-loud: cada regla que usa un
constructo no soportado (modificadores de codificacion, keyword
selections, negaciones, parentesis) se OMITE con su motivo en el
informe; un fichero YAML roto o sobredimensionado aborta el run.
La procedencia Sigma (autor, estado, referencias, falsos positivos
declarados) viaja en la description de cada regla convertida.`

const sigmaExamples = `  engine sigma -dir ./corpus-sigma -out rules/convertidas.yaml
  engine sigma -dir ./corpus-sigma            (reporte por stdout)
  engine sigma -dir ./corpus -strict          (exit 1 si algo se omite)`

func newSigmaCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "sigma",
		Short:   "Convierte reglas Sigma al formato de reglas del motor",
		Long:    sigmaLong,
		Example: sigmaExamples,
		// Same muscle-memory contract as run/rules/validate: the
		// single-dash flags are parsed manually with stdlib flag.
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			fs := flag.NewFlagSet("engine sigma", flag.ContinueOnError)
			fs.SetOutput(io.Discard)
			dir := fs.String("dir", "", "fichero o directorio con reglas Sigma (.yml/.yaml)")
			out := fs.String("out", "-", "fichero YAML de salida ('-' = stdout)")
			strict := fs.Bool("strict", false, "exit 1 si alguna regla se omite")
			if err := fs.Parse(args); err != nil {
				if errors.Is(err, flag.ErrHelp) {
					return cmd.Help()
				}
				return fmt.Errorf("banderas invalidas para 'sigma': %v", err)
			}
			if *dir == "" {
				return fmt.Errorf("falta -dir <fichero-o-directorio-sigma>")
			}
			return runSigma(*dir, *out, *strict)
		},
	}
}

// runSigma converts, emits, writes the output and prints the report.
// Exit contract: 0 = at least one rule converted and (with -strict)
// zero skips; 1 = hard error, zero conversions, or skips under -strict.
func runSigma(dir, out string, strict bool) error {
	res, err := sigma.ConvertDir(dir)
	if err != nil {
		return err
	}
	data, err := res.Emit()
	if err != nil {
		return err
	}

	fmt.Println("== sigma: conversion de reglas ==")
	fmt.Printf("ficheros: %d | convertidas: %d | omitidas: %d\n",
		res.Files, len(res.Converted), len(res.Skipped))
	if len(res.Skipped) > 0 {
		fmt.Println("omitidas:")
		for _, s := range res.Skipped {
			fmt.Printf("  - %q (%s): %s\n", s.Title, s.ID, s.Reason)
		}
	}

	destino := "stdout"
	if out != "-" {
		// 0644: the emitted file is configuration (like rules/), not
		// evidence — the SQLite/store rules do not apply here.
		if err := os.WriteFile(out, data, 0o644); err != nil {
			return fmt.Errorf("escribir %s: %w", out, err)
		}
		destino = out
	}
	fmt.Printf("salida: %s (%d reglas)\n", destino, len(res.Converted))

	switch {
	case len(res.Converted) == 0:
		fmt.Fprintln(os.Stderr, "error: cero reglas convertidas; revisa los motivos y el alcance del corpus")
		return exitErr{code: 1}
	case strict && len(res.Skipped) > 0:
		fmt.Fprintln(os.Stderr, "error: -strict activo y hay reglas omitidas")
		return exitErr{code: 1}
	}
	return nil
}
