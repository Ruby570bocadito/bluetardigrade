package main

import (
        "bufio"
        "crypto/rand"
        "encoding/hex"
        "errors"
        "fmt"
        "io"
        "strings"
        "unicode"

        "github.com/Ruby570bocadito/bluetardigrade/internal/ingest"
        "github.com/spf13/cobra"
)

const identityLong = `Genera una credencial de ingesta propia para un sensor: un token
aleatorio de 256 bits (se muestra una sola vez) y la entrada YAML con su
SHA-256 y los hosts a los que queda atado, lista para pegar en el
fichero de -ingest-identities. El motor solo guarda el hash.

Con --token-stdin no se genera token: se lee uno existente de la
entrada estandar y solo se imprime la entrada YAML.`

const identityExamples = `  engine ingest-identity --name wks-01 --host WKS-01
  engine ingest-identity --name ids-01 --any-host        colector que informa de muchos hosts
  echo -n "$TOKEN" | engine ingest-identity --name srv-02 --host SRV-02 --token-stdin`

func newIngestIdentityCmd() *cobra.Command {
        var name string
        var hosts []string
        var anyHost, fromStdin bool
        cmd := &cobra.Command{
                Use:     "ingest-identity",
                Short:   "Genera una identidad de ingesta por sensor (token + entrada YAML)",
                Long:    identityLong,
                Example: identityExamples,
                Args:    cobra.NoArgs,
                RunE: func(cmd *cobra.Command, args []string) error {
                        return runIngestIdentity(cmd.InOrStdin(), cmd.OutOrStdout(), cmd.ErrOrStderr(), name, hosts, anyHost, fromStdin)
                },
        }
        cmd.Flags().StringVar(&name, "name", "", "nombre de la identidad (se graba en cada evento como attributes.ingest_identity)")
        cmd.Flags().StringArrayVar(&hosts, "host", nil, "host que el sensor puede reportar (repetible)")
        cmd.Flags().BoolVar(&anyHost, "any-host", false, "permite cualquier host (colectores IDS, correo, firewall)")
        cmd.Flags().BoolVar(&fromStdin, "token-stdin", false, "lee un token existente de stdin en vez de generar uno")
        return cmd
}

func runIngestIdentity(in io.Reader, out, errOut io.Writer, name string, hosts []string, anyHost, fromStdin bool) error {
        name = strings.TrimSpace(name)
        if name == "" || strings.IndexFunc(name, unicode.IsControl) >= 0 || strings.ContainsAny(name, `"'\:#`) {
                return errors.New("--name es obligatorio y no puede llevar caracteres de control, comillas, ':' ni '#'")
        }
        if anyHost == (len(hosts) > 0) {
                return errors.New("usa --host (una o varias veces) o --any-host, no ambos")
        }
        for _, h := range hosts {
                if strings.TrimSpace(h) == "" || strings.ContainsAny(h, "\"'\\,[]{}#\n\r\t") {
                        return fmt.Errorf("host invalido %q", h)
                }
        }
        token, err := credentialToken(in, fromStdin)
        if err != nil {
                return err
        }
        hostList := `["*"]`
        if !anyHost {
                quoted := make([]string, len(hosts))
                for i, h := range hosts {
                        quoted[i] = `"` + strings.TrimSpace(h) + `"`
                }
                hostList = "[" + strings.Join(quoted, ", ") + "]"
        }
        if !fromStdin {
                // token goes to STDERR (audit 5.2): stdout carries the YAML
                // blob, so `engine ingest-identity ... > identities.yaml`
                // used to persist the CLEAR token as comments inside the
                // identities file itself. Stderr keeps the one-time reveal
                // on the terminal while the redirect captures YAML only.
                fmt.Fprintln(errOut, "# Token del sensor (SF_INGEST_TOKEN o -token del sensor). Se muestra UNA vez:")
                fmt.Fprintln(errOut, "# "+token)
                fmt.Fprintln(errOut)
        }
        fmt.Fprintln(out, "# Entrada para el fichero de -ingest-identities (version: 1, identities: [...]):")
        fmt.Fprintf(out, "  - name: %s\n    token_sha256: %s\n    hosts: %s\n", name, ingest.TokenDigest(token), hostList)
        return nil
}

// credentialToken generates a 256-bit hex token, or reads an existing
// one (>= 16 characters) from in.
func credentialToken(in io.Reader, fromStdin bool) (string, error) {
        if fromStdin {
                line, err := bufio.NewReader(io.LimitReader(in, 4096)).ReadString('\n')
                if err != nil && !errors.Is(err, io.EOF) {
                        return "", fmt.Errorf("leyendo el token de stdin: %w", err)
                }
                token := strings.TrimRight(line, "\r\n")
                if len(token) < 16 {
                        return "", errors.New("el token de stdin debe tener al menos 16 caracteres")
                }
                return token, nil
        }
        var b [32]byte
        if _, err := rand.Read(b[:]); err != nil {
                return "", fmt.Errorf("generando el token: %w", err)
        }
        return hex.EncodeToString(b[:]), nil
}

const operatorCredentialLong = `Genera la credencial propia de un operador de respuesta activa: un
token aleatorio de 256 bits (se muestra una sola vez) y la entrada YAML
con su SHA-256 para el fichero -respond-operators en formato version 2.
Cada peticion POST /api/respond/kill de ese operador debe llevar el token
en la cabecera X-SF-Operator-Token, ademas del token de la API: el token
de la API es compartido, la credencial del operador no.`

func newOperatorCredentialCmd() *cobra.Command {
        var name string
        var fromStdin bool
        cmd := &cobra.Command{
                Use:     "operator-credential",
                Short:   "Genera la credencial de un operador de respuesta activa (token + entrada YAML)",
                Long:    operatorCredentialLong,
                Example: "  engine operator-credential --name ana\n  echo -n \"$TOKEN\" | engine operator-credential --name beto --token-stdin",
                Args:    cobra.NoArgs,
                RunE: func(cmd *cobra.Command, args []string) error {
                        return runOperatorCredential(cmd.InOrStdin(), cmd.OutOrStdout(), name, fromStdin)
                },
        }
        cmd.Flags().StringVar(&name, "name", "", "nombre del operador (el campo operator de cada peticion)")
        cmd.Flags().BoolVar(&fromStdin, "token-stdin", false, "lee un token existente de stdin en vez de generar uno")
        return cmd
}

func runOperatorCredential(in io.Reader, out io.Writer, name string, fromStdin bool) error {
        name = strings.TrimSpace(name)
        if name == "" || len([]rune(name)) > 64 || strings.IndexFunc(name, unicode.IsControl) >= 0 || strings.ContainsAny(name, `"'\:#{}[],`) {
                return errors.New("--name es obligatorio (maximo 64 caracteres, sin caracteres de control, comillas, ':', '#', llaves, corchetes ni comas)")
        }
        token, err := credentialToken(in, fromStdin)
        if err != nil {
                return err
        }
        if !fromStdin {
                fmt.Fprintln(out, "# Credencial del operador (cabecera X-SF-Operator-Token). Se muestra UNA vez:")
                fmt.Fprintln(out, "# "+token)
                fmt.Fprintln(out)
        }
        fmt.Fprintln(out, "# Entrada para -respond-operators (version: 2, operators: [...]):")
        fmt.Fprintf(out, "  - name: %s\n    token_sha256: %s\n", name, ingest.TokenDigest(token))
        return nil
}
