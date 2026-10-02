package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
	"github.com/Ruby570bocadito/bluetardigrade/internal/socreport"
	"github.com/spf13/cobra"
)

func newReportCmd() *cobra.Command {
	var id, endpoint, notes, format, out string
	var interactive bool
	cmd := &cobra.Command{Use: "report", Short: "Investiga una alerta y exporta un informe humano (Markdown o JSON)", Long: "Consulta una alerta real por ID. Escribe hallazgos, acciones y clasificacion humana; no cambia su estado ni ejecuta respuestas.", Example: "  engine report --alert 0123456789abcdef --interactive --out reports/alerta.md\n  engine report --alert 0123456789abcdef --notes notas.json --format json --out reports/alerta.json", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if !socreport.ValidID(id) {
				return errors.New("--alert requiere 16 caracteres hexadecimales")
			}
			if out == "" {
				return errors.New("--out requiere una ruta nueva para el informe")
			}
			if format != "md" && format != "json" {
				return errors.New("--format debe ser md o json")
			}
			if interactive == (notes != "") {
				return errors.New("usa exactamente una opcion: --interactive o --notes archivo.json")
			}
			raw, err := fetchReportAlert(cmd.Context(), endpoint, id, os.Getenv("SF_API_TOKEN"))
			if err != nil {
				return err
			}
			initial, err := socreport.New(id, raw, socreport.Fields{}, time.Now())
			if err != nil {
				return err
			}
			fields := initial.Fields
			if interactive {
				var pretty strings.Builder
				var evidence any
				_ = json.Unmarshal(raw, &evidence)
				view, _ := json.MarshalIndent(evidence, "", "  ")
				pretty.Write(view)
				fmt.Fprintln(cmd.OutOrStdout(), "Evidencia recibida:\n"+redact.TerminalText(pretty.String()))
				fields, err = interviewReport(cmd.InOrStdin(), cmd.OutOrStdout(), fields)
			} else {
				file, openErr := os.Open(notes)
				if openErr != nil {
					return errors.New("no se pudo abrir --notes")
				}
				fields, err = socreport.ReadFields(file)
				_ = file.Close()
			}
			if err != nil {
				return err
			}
			report, err := socreport.New(id, raw, fields, time.Now())
			if err != nil {
				return err
			}
			rendered, err := report.Render(format)
			if err != nil {
				return err
			}
			if err := socreport.WriteNew(out, rendered); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Informe guardado. El estado de la alerta no ha cambiado.")
			return nil
		}}
	cmd.Flags().StringVar(&id, "alert", "", "ID de alerta")
	cmd.Flags().StringVar(&endpoint, "api", "http://127.0.0.1:7778", "API; SF_API_TOKEN en el entorno, HTTPS obligatorio para destinos remotos")
	cmd.Flags().BoolVar(&interactive, "interactive", false, "entrevista de investigacion")
	cmd.Flags().StringVar(&notes, "notes", "", "campos humanos en JSON estricto")
	cmd.Flags().StringVar(&format, "format", "md", "md o json")
	cmd.Flags().StringVar(&out, "out", "", "archivo nuevo; nunca sobrescribe uno existente")
	return cmd
}

func reportEndpoint(endpoint, token string) (*url.URL, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("API URL invalida: usa http(s) sin credenciales, query ni fragmento")
	}
	ip := net.ParseIP(u.Hostname())
	local := strings.EqualFold(u.Hostname(), "localhost") || (ip != nil && ip.IsLoopback())
	if !local && (u.Scheme != "https" || token == "") {
		return nil, errors.New("API remota requiere HTTPS y SF_API_TOKEN")
	}
	if len(token) > 8192 {
		return nil, errors.New("SF_API_TOKEN demasiado largo")
	}
	for _, r := range token {
		if r < 33 || r > 126 {
			return nil, errors.New("SF_API_TOKEN debe ser ASCII imprimible sin espacios")
		}
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/api/alerts/search"
	u.RawPath = ""
	return u, nil
}

func fetchReportAlert(ctx context.Context, endpoint, id, token string) (json.RawMessage, error) {
	u, err := reportEndpoint(endpoint, token)
	if err != nil {
		return nil, err
	}
	q := url.Values{"q": {id}, "limit": {"25"}}
	u.RawQuery = q.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, errors.New("no se pudo preparar la consulta de alerta")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return nil, errors.New("no se pudo consultar la API de alertas")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("consulta de alerta rechazada (HTTP %d)", response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return nil, errors.New("respuesta de alertas excesiva o ilegible")
	}
	var page struct {
		Items       []json.RawMessage `json:"items"`
		HasMore     bool              `json:"has_more"`
		ScanLimited bool              `json:"scan_limited"`
	}
	if json.Unmarshal(raw, &page) != nil {
		return nil, errors.New("respuesta de alertas invalida")
	}
	for _, item := range page.Items {
		var selected struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(item, &selected) == nil && selected.ID == id {
			return item, nil
		}
	}
	if page.HasMore || page.ScanLimited {
		return nil, errors.New("busqueda incompleta; consulta el historico con filtros mas precisos")
	}
	return nil, errors.New("alerta no encontrada en la retencion disponible")
}

func interviewReport(input io.Reader, output io.Writer, fields socreport.Fields) (socreport.Fields, error) {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 64<<10)
	line := func(prompt string) (string, error) {
		fmt.Fprintln(output, prompt)
		if !scanner.Scan() {
			return "", errors.New("entrevista incompleta; no se creo el informe")
		}
		return scanner.Text(), nil
	}
	value, err := line("Analista (nombre declarado):")
	if err != nil {
		return fields, err
	}
	fields.Analyst = value
	value, err = line("Titulo (vacio conserva el propuesto):")
	if err != nil {
		return fields, err
	}
	if value != "" {
		fields.Title = value
	}
	value, err = line("Clasificacion: 1 pendiente / 2 falso positivo / 3 actividad autorizada / 4 incidente confirmado:")
	if err != nil {
		return fields, err
	}
	switch strings.TrimSpace(value) {
	case "1":
		fields.Decision = "pending"
	case "2":
		fields.Decision = "false_positive"
	case "3":
		fields.Decision = "authorized_activity"
	case "4":
		fields.Decision = "confirmed_incident"
	default:
		return fields, errors.New("clasificacion invalida; no se creo el informe")
	}
	for _, entry := range []struct {
		prompt string
		target *string
	}{{"Hallazgos", &fields.Findings}, {"Acciones realizadas", &fields.Actions}, {"Recomendaciones", &fields.Recommendations}, {"Referencias", &fields.References}} {
		fmt.Fprintln(output, entry.prompt+" (varias lineas; '.' termina):")
		var lines []string
		size := 0
		for {
			value, err := line("")
			if err != nil {
				return fields, err
			}
			if value == "." {
				break
			}
			size += len(value) + 1
			if size > 16000 {
				return fields, errors.New("campo de informe demasiado largo")
			}
			lines = append(lines, value)
		}
		*entry.target = strings.Join(lines, "\n")
	}
	return fields, socreport.Validate(fields)
}
