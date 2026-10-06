package main

import (
	"bytes"
	"fmt"
	"io"

	"github.com/Ruby570bocadito/bluetardigrade/internal/secretfile"
	"github.com/spf13/cobra"
)

const secretWriteLong = `Guarda un secreto (p. ej. la contrasena de la cuenta de servicio del
conector AD) en un fichero sobre SEC-2: un secreto por fichero, sobre
JSON versionado. En Windows se cifra con DPAPI (ambito LOCAL_MACHINE);
en otros sistemas el fichero queda en texto plano con permisos 0600,
exigidos en cada lectura. El secreto entra SOLO por stdin, jamas por
argv ni por entorno:

  engine secret-write /etc/bluetardigrade/ad-bind.secret < contrasena.txt

El fichero resultante se referencia desde password_file de la
configuracion -ad. La consola jamas lo devuelve por la API y el motor
jamas lo escribe en el log.`

func newSecretWriteCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "secret-write <fichero>",
		Short:   "Guarda un secreto de stdin en un fichero sobre SEC-2 (DPAPI en Windows, 0600 en otros sistemas)",
		Long:    secretWriteLong,
		Example: "  engine secret-write /etc/bluetardigrade/ad-bind.secret < ad-bind.txt",
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runSecretWrite(cmd.InOrStdin(), cmd.OutOrStdout(), args[0])
		},
	}
	return cmd
}

func runSecretWrite(in io.Reader, out io.Writer, path string) error {
	raw, err := io.ReadAll(in)
	if err != nil {
		return fmt.Errorf("leyendo el secreto de stdin: %w", err)
	}
	// Mismo convenio que el fichero en bruto legado: se recortan los
	// saltos de linea del final (lo que entra por "cat fichero |" o por
	// una linea interactiva), el resto es el secreto, byte a byte.
	secret := bytes.Trim(raw, "\r\n")
	if len(secret) == 0 {
		return fmt.Errorf("stdin no trajo ningun secreto: pasalo por stdin (p. ej. 'engine secret-write <fichero> < contrasena.txt')")
	}
	if err := secretfile.Write(path, secret); err != nil {
		return err
	}
	secretfile.Zero(secret)
	scheme := secretfile.DefaultScheme()
	if scheme == "dpapi" {
		scheme = "dpapi (ambito LOCAL_MACHINE)"
	}
	fmt.Fprintf(out, "Secreto guardado en %s (esquema %s). Referencialo desde password_file en la configuracion de -ad.\n", path, scheme)
	return nil
}
