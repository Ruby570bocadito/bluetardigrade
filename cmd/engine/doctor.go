package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"runtime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/beacon"
	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/threshold"
	"github.com/spf13/cobra"
)

type doctorCheck struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
	Remedy string `json:"remedy,omitempty"`
}

type doctorReport struct {
	Checks   []doctorCheck `json:"checks"`
	Errors   int           `json:"errors"`
	Warnings int           `json:"warnings"`
}

func (r *doctorReport) add(checks ...doctorCheck) {
	for _, c := range checks {
		r.Checks = append(r.Checks, c)
		if c.Status == "error" {
			r.Errors++
		}
		if c.Status == "warn" {
			r.Warnings++
		}
	}
}

type doctorOptions struct {
	root, addr, apiURL, consoleURL, hubURL, sensor, apiCA, ingestCA string
	timeout, recent                                                 time.Duration
	json                                                            bool
}

func newDoctorFlagSet() (*flag.FlagSet, *doctorOptions) {
	o := &doctorOptions{}
	fs := flag.NewFlagSet("engine doctor", flag.ContinueOnError)
	fs.StringVar(&o.root, "root", "", "directorio de instalacion; por defecto junto al binario o el directorio actual")
	fs.StringVar(&o.addr, "addr", "127.0.0.1:7777", "destino TCP de ingesta")
	fs.StringVar(&o.apiURL, "api-url", "http://127.0.0.1:7778", "URL base de la API del motor")
	fs.StringVar(&o.consoleURL, "console-url", "http://localhost:3000", "URL de la consola; vacio omite la comprobacion")
	fs.StringVar(&o.hubURL, "hub-url", "http://localhost:3003", "URL del hub IA; vacio omite la comprobacion")
	fs.StringVar(&o.sensor, "sensor", "auto", "fuente esperada: auto, sysmon, etw o providers")
	fs.DurationVar(&o.timeout, "timeout", 3*time.Second, "tiempo maximo por comprobacion de red o plataforma (hasta 30s)")
	fs.DurationVar(&o.recent, "recent-within", 5*time.Minute, "ventana para fechas declaradas de la muestra de eventos")
	fs.StringVar(&o.apiCA, "api-ca", "", "CA PEM adicional para la API HTTPS; nunca omite verificar el certificado")
	fs.StringVar(&o.ingestCA, "ingest-ca", "", "CA PEM para ingesta TLS (tambien SF_INGEST_CA)")
	fs.BoolVar(&o.json, "json", false, "informe JSON; salida 1 si hay errores, 0 con solo avisos")
	return fs, o
}

func newDoctorCmd() *cobra.Command {
	return &cobra.Command{
		Use: "doctor", Short: "Diagnostica reglas, puertos, credenciales, sensor y consola",
		Long:               "Comprueba el despliegue sin arrancar servicios ni enviar telemetria.\nUsa SF_API_TOKEN y SF_INGEST_TOKEN, con fallback a los tokens persistidos de la instalacion.\nUn aviso de inactividad no demuestra que el sensor este roto. No imprime credenciales.",
		Example:            "  engine doctor\n  engine doctor -sensor sysmon\n  engine doctor -root C:\\SOC\\bluetardigrade -json",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			fs, o := newDoctorFlagSet()
			fs.SetOutput(io.Discard)
			if err := fs.Parse(args); err != nil {
				if errors.Is(err, flag.ErrHelp) {
					return cmd.Help()
				}
				return errors.New("banderas invalidas para doctor; usa 'engine doctor -h'")
			}
			if fs.NArg() > 0 {
				return errors.New("doctor no acepta argumentos posicionales; usa 'engine doctor -h'")
			}
			if o.timeout <= 0 || o.timeout > 30*time.Second || o.recent <= 0 {
				return errors.New("timeout debe estar entre 0 y 30s y recent-within debe ser positivo")
			}
			if o.sensor != "auto" && o.sensor != "sysmon" && o.sensor != "etw" && o.sensor != "providers" {
				return errors.New("sensor debe ser auto, sysmon, etw o providers")
			}
			report := runDoctor(cmd.Context(), o)
			if o.json {
				if err := json.NewEncoder(cmd.OutOrStdout()).Encode(report); err != nil {
					return err
				}
			} else {
				renderDoctor(cmd.OutOrStdout(), report)
			}
			if report.Errors > 0 {
				return exitErr{code: 1}
			}
			return nil
		},
	}
}

func renderDoctor(out io.Writer, r *doctorReport) {
	fmt.Fprintln(out, "bluetardigrade doctor")
	for _, c := range r.Checks {
		fmt.Fprintf(out, "\n[%s] %s: %s\n", strings.ToUpper(c.Status), c.Name, c.Detail)
		if c.Remedy != "" {
			fmt.Fprintf(out, "  -> %s\n", c.Remedy)
		}
	}
	fmt.Fprintf(out, "\nResultado: %d error(es), %d aviso(s)\n", r.Errors, r.Warnings)
}

func doctorRoot(explicit string) string {
	if explicit != "" {
		return explicit
	}
	if cwd, err := os.Getwd(); err == nil && dirExists(filepath.Join(cwd, "rules")) {
		return cwd
	}
	if exe, err := os.Executable(); err == nil {
		return filepath.Clean(filepath.Join(filepath.Dir(exe), ".."))
	}
	return "."
}

func runDoctor(ctx context.Context, o *doctorOptions) *doctorReport {
	r := &doctorReport{Checks: []doctorCheck{}}
	root := doctorRoot(o.root)
	r.add(doctorContentChecks(root)...)
	r.add(doctorIntelChecks(root)...)
	if f, err := os.CreateTemp(root, ".doctor-write-"); err != nil {
		r.add(doctorCheck{"Directorio de estado", "error", "No se puede crear estado en el directorio seleccionado", "Selecciona una instalacion escribible con -root; revisa sus permisos"})
	} else {
		name := f.Name()
		_ = f.Close()
		if err := os.Remove(name); err != nil {
			r.add(doctorCheck{"Directorio de estado", "warn", "La escritura funciona pero no se pudo retirar el archivo temporal", "Revisa los permisos de borrado"})
		} else {
			r.add(doctorCheck{"Directorio de estado", "ok", "Permite crear y borrar estado temporal", ""})
		}
	}
	token, err := doctorSetting(root, "SF_INGEST_TOKEN", "ingest.token")
	if err != nil {
		r.add(doctorCheck{"Credencial de ingesta", "error", "No se puede leer una credencial valida", "Revisa SF_INGEST_TOKEN y tools/config/ingest.token"})
	} else {
		ca := o.ingestCA
		if ca == "" {
			ca = os.Getenv("SF_INGEST_CA")
		}
		r.add(doctorIngest(ctx, o.addr, token, ca, o.timeout)...)
	}
	tlsConfig, err := doctorTLS(o.apiCA)
	if err != nil {
		r.add(doctorCheck{"CA de la API", "error", "No se pudo cargar la CA PEM", "Revisa -api-ca; no se desactiva la verificacion TLS"})
	} else {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.TLSClientConfig = tlsConfig
		defer transport.CloseIdleConnections()
		client := &http.Client{Timeout: o.timeout, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		apiToken, tokenErr := doctorSetting(root, "SF_API_TOKEN", "api.token")
		if tokenErr != nil {
			r.add(doctorCheck{"Credencial de la API", "error", "No se puede leer una credencial valida", "Revisa SF_API_TOKEN y tools/config/api.token"})
		} else {
			r.add(doctorEngine(ctx, client, o.apiURL, apiToken, o.recent)...)
		}
		r.add(doctorConsoleChecks(ctx, o.consoleURL, o.hubURL, client)...)
	}
	platformCtx, cancel := context.WithTimeout(ctx, o.timeout)
	defer cancel()
	r.add(platformDoctorChecks(platformCtx, root, o.sensor)...)
	return r
}

func doctorContentChecks(root string) []doctorCheck {
	checks := []doctorCheck{}
	eng, err := rules.LoadDir(filepath.Join(root, "rules"))
	if err != nil || eng.Count() == 0 {
		checks = append(checks, doctorCheck{"Reglas", "error", "El paquete no carga reglas validas", "Comprueba -root y ejecuta engine validate para ver los errores YAML"})
	} else {
		checks = append(checks, doctorCheck{"Reglas", "ok", fmt.Sprintf("%d reglas locales cargadas", eng.Count()), ""})
	}
	seqPath := filepath.Join(root, "sequences")
	if !dirExists(seqPath) {
		checks = append(checks, doctorCheck{"Cadenas", "warn", "No hay directorio de secuencias", "Instala el paquete sequences si quieres correlacion"})
	} else if corr, err := correlate.LoadDir(seqPath, nil); err != nil {
		checks = append(checks, doctorCheck{"Cadenas", "error", "El paquete de secuencias no carga", "Ejecuta engine validate"})
	} else if corr.Count() == 0 {
		checks = append(checks, doctorCheck{"Cadenas", "warn", "No hay secuencias activas", "Carga las cadenas de deteccion que necesitas"})
	} else {
		checks = append(checks, doctorCheck{"Cadenas", "ok", fmt.Sprintf("%d secuencias locales cargadas", corr.Count()), ""})
		if err == nil && eng != nil {
			names := make(map[string]bool)
			for _, rule := range eng.Snapshot() {
				names[rule.Name] = true
			}
			missing := 0
			for _, seq := range corr.Snapshot() {
				dead, _ := stepCoverage(seq, names)
				missing += len(dead)
			}
			if missing > 0 {
				checks = append(checks, doctorCheck{"Pasos de correlacion", "warn", fmt.Sprintf("%d referencias no corresponden a reglas cargadas", missing), "Ejecuta engine validate para localizar los pasos que nunca podrian completarse"})
			}
		}
	}
	for _, kind := range []string{"beacons", "thresholds"} {
		path := filepath.Join(root, kind+".yaml")
		if !fileExists(path) {
			checks = append(checks, doctorCheck{kind, "warn", "Falta el YAML; este detector quedaria desactivado", "Restaura el archivo del paquete de instalacion"})
			continue
		}
		count := 0
		var err error
		if kind == "beacons" {
			var m *beacon.Manager
			m, err = beacon.LoadFile(path, nil)
			if err == nil {
				count = m.Count()
			}
		} else {
			var d *threshold.Detector
			d, err = threshold.LoadFile(path)
			if err == nil {
				count = d.Count()
			}
		}
		if err != nil {
			checks = append(checks, doctorCheck{kind, "error", "Configuracion YAML invalida", "Revisa el archivo del detector"})
		} else if count == 0 {
			checks = append(checks, doctorCheck{kind, "warn", "Configuracion vacia; no hay perfiles activos", "Carga los perfiles que necesitas"})
		} else {
			checks = append(checks, doctorCheck{kind, "ok", fmt.Sprintf("%d perfiles locales cargados", count), ""})
		}
	}
	return checks
}

// doctorFilePerm checks the POSIX mode of a credential file: the
// secretfile standard is 0600, and a world-readable api.token or
// ingest.token is exactly what doctor exists to catch (sesión
// 100agentes-2, agente 32 — solo se puede comprobar en POSIX; en
// Windows la DACL la protege install.ps1/runtime.ps1).
func doctorFilePerm(path string) (string, bool) {
	if runtime.GOOS == "windows" {
		return "", true // sin sevside: la DACL es la barrera
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", true // no existe: doctor lo reporta por su camino
	}
	perm := info.Mode().Perm()
	if perm&0o077 != 0 {
		return fmt.Sprintf("permisos %o (debería ser 600): cualquier cuenta local puede leer la credencial", perm), false
	}
	return "", true
}

func doctorSetting(root, envName, fileName string) (string, error) {
	value := os.Getenv(envName)
	if value == "" {
		path := filepath.Join(root, "tools", "config", fileName)
		// Chequeo de permisos de la credencial en disco (sesión
		// 100agentes-2, agente 32, P1): doctor exigia 0600 al ESCRIBIR
		// (secretfile) pero nunca lo VERIFICABA — un api.token
		// mundo-legible en POSIX reportaba OK.
		if detail, ok := doctorFilePerm(path); !ok {
			return "", errors.New(fileName + ": " + detail)
		}
		file, err := os.Open(path)
		if os.IsNotExist(err) {
			return "", nil
		}
		if err != nil {
			return "", err
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, 4097))
		if err != nil || len(data) > 4096 {
			return "", errors.New("credential file unreadable or oversized")
		}
		// the launcher reads these with Get-Content, which drops a BOM
		value = strings.TrimSpace(strings.TrimPrefix(string(data), "\uFEFF"))
	}
	if strings.ContainsAny(value, "\r\n\x00") {
		return "", errors.New("invalid credential")
	}
	return value, nil
}

func doctorTLS(ca string) (*tls.Config, error) {
	cfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if ca == "" {
		return cfg, nil
	}
	f, err := os.Open(ca)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return nil, errors.New("invalid CA file")
	}
	pool, err := x509.SystemCertPool()
	if err != nil {
		pool = x509.NewCertPool()
	}
	if !pool.AppendCertsFromPEM(data) {
		return nil, errors.New("invalid PEM")
	}
	cfg.RootCAs = pool
	return cfg, nil
}

func doctorIngest(ctx context.Context, addr, token, ca string, timeout time.Duration) []doctorCheck {
	host, _, err := net.SplitHostPort(addr)
	if err != nil || host == "" {
		return []doctorCheck{{"Ingesta TCP", "error", "Direccion invalida", "Usa -addr host:puerto"}}
	}
	ip := net.ParseIP(host)
	loopback := strings.EqualFold(host, "localhost") || (ip != nil && ip.IsLoopback())
	if !loopback && (ca == "" || token == "") {
		return []doctorCheck{{"Ingesta TCP", "error", "La ingesta remota requiere TLS verificado y una credencial", "Configura -ingest-ca y SF_INGEST_TOKEN; no se envio AUTH ni se abrio la conexion"}}
	}
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	dialer := &net.Dialer{}
	var conn net.Conn
	err = nil
	if ca == "" {
		conn, err = dialer.DialContext(probeCtx, "tcp", addr)
	} else {
		cfg, caErr := doctorTLS(ca)
		if caErr != nil {
			return []doctorCheck{{"Ingesta TLS", "error", "CA PEM invalida", "Revisa -ingest-ca o SF_INGEST_CA"}}
		}
		conn, err = (&tls.Dialer{NetDialer: dialer, Config: cfg}).DialContext(probeCtx, "tcp", addr)
	}
	if err != nil {
		return []doctorCheck{{"Ingesta TCP", "error", "No se pudo conectar o verificar TLS", "Arranca sf-engine y comprueba -addr, firewall y CA; usa -ingest-ca si el motor requiere TLS"}}
	}
	defer conn.Close()
	checks := []doctorCheck{{"Ingesta TCP", "ok", "Puerto accesible; no se ha enviado ningun evento", ""}}
	if token == "" {
		return append(checks, doctorCheck{"Autenticacion de ingesta", "skip", "Sin credencial; el puerto abierto no confirma el protocolo ni la configuracion de auth", "Si el motor exige token, configura SF_INGEST_TOKEN o tools/config/ingest.token"})
	}
	deadline, _ := probeCtx.Deadline()
	_ = conn.SetDeadline(deadline)
	if _, err := fmt.Fprintf(conn, "AUTH %s\n", token); err != nil {
		return append(checks, doctorCheck{"Autenticacion de ingesta", "error", "No se pudo completar el handshake", "Comprueba el token y la configuracion TLS del motor"})
	}
	var ack struct {
		Ack string `json:"ack"`
	}
	reader := bufio.NewReader(io.LimitReader(conn, 4096))
	line, err := reader.ReadBytes('\n')
	if err != nil || json.Unmarshal(line, &ack) != nil || ack.Ack != "ok" {
		return append(checks, doctorCheck{"Autenticacion de ingesta", "error", "El motor no acepto la credencial", "Usa el mismo token en motor y sensor; comprueba la CA si usas TLS"})
	}
	return append(checks, doctorCheck{"Autenticacion de ingesta", "ok", "Handshake AUTH aceptado; no se ha enviado telemetria", ""})
}

func doctorAPIBase(raw string) (*url.URL, error) {
	u, valid := doctorPublicURL(raw)
	if !valid {
		return nil, errors.New("invalid API URL")
	}
	return u, nil
}

func doctorGet(ctx context.Context, client *http.Client, base, path, token string, target any) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+path, nil)
	if err != nil {
		return 0, errors.New("invalid request")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := client.Do(req)
	if err != nil {
		return 0, errors.New("API unreachable or unverified TLS")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return res.StatusCode, errors.New("API refused request")
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 || json.Unmarshal(data, target) != nil {
		return res.StatusCode, errors.New("invalid API response")
	}
	return res.StatusCode, nil
}

func doctorEngine(ctx context.Context, client *http.Client, base, token string, recent time.Duration) []doctorCheck {
	u, err := doctorAPIBase(base)
	if err != nil {
		return []doctorCheck{{"API del motor", "error", "URL invalida", "Usa -api-url http(s)://host:puerto sin credenciales ni query"}}
	}
	ip := net.ParseIP(u.Hostname())
	loopback := strings.EqualFold(u.Hostname(), "localhost") || (ip != nil && ip.IsLoopback())
	if token != "" && u.Scheme != "https" && !loopback {
		return []doctorCheck{{"API del motor", "error", "No se envia un token Bearer por HTTP a una API remota", "Usa HTTPS y -api-ca si el certificado lo requiere"}}
	}
	var health struct{ Status, Mode string }
	if _, err := doctorGet(ctx, client, base, "/api/health", "", &health); err != nil || health.Status != "ok" || health.Mode != "engine" {
		return []doctorCheck{{"API del motor", "error", "No responde como motor saludable", "Arranca sf-engine y revisa -api-url; para HTTPS configura la CA con -api-ca"}}
	}
	checks := []doctorCheck{{"API del motor", "ok", "Health del motor verificado", ""}}
	var stats struct {
		Mode               string  `json:"mode"`
		EventsTotal        *uint64 `json:"events_total"`
		RulesCount         *int    `json:"rules_count"`
		StoreEnabled       *bool   `json:"store_enabled"`
		StoreWriteFailures *uint64 `json:"store_write_failures"`
		IngestRejected     uint64  `json:"ingest_rejected"`
		Dropped            uint64  `json:"dropped"`
	}
	code, err := doctorGet(ctx, client, base, "/api/stats", token, &stats)
	if err != nil {
		remedy := "Revisa la URL, la version del motor y la CA"
		if code == 401 || code == 403 {
			remedy = "Configura SF_API_TOKEN con el token de la API del motor"
		}
		return append(checks, doctorCheck{"Acceso a estadisticas", "error", "No se pueden leer las estadisticas del motor", remedy})
	}
	if stats.Mode != "engine" || stats.EventsTotal == nil || stats.RulesCount == nil {
		return append(checks, doctorCheck{"Acceso a estadisticas", "error", "Respuesta incompatible; no se inventan metricas", "Revisa -api-url y la version del motor"})
	}
	checks = append(checks, doctorCheck{"Acceso a estadisticas", "ok", fmt.Sprintf("%d eventos y %d reglas en el motor conectado", *stats.EventsTotal, *stats.RulesCount), ""})
	if *stats.RulesCount == 0 {
		checks = append(checks, doctorCheck{"Reglas activas", "error", "El motor no tiene reglas cargadas", "Reinicia con un paquete -rules valido"})
	}
	if stats.StoreEnabled == nil {
		checks = append(checks, doctorCheck{"Persistencia", "warn", "El motor no informa si hay SQLite", "Revisa la version y configuracion de persistencia"})
	} else if !*stats.StoreEnabled {
		checks = append(checks, doctorCheck{"Persistencia", "warn", "SQLite desactivado; el historial depende de buffers de memoria", "Arranca el motor con -store para conservar eventos y alertas"})
	} else {
		checks = append(checks, doctorCheck{"Persistencia", "ok", "SQLite activado en el motor", ""})
	}
	if stats.StoreWriteFailures != nil && *stats.StoreWriteFailures > 0 {
		checks = append(checks, doctorCheck{"Escrituras SQLite", "warn", fmt.Sprintf("%d escrituras fallidas desde el arranque; la evidencia afectada puede estar solo en memoria", *stats.StoreWriteFailures), "Revisa espacio, permisos y logs; el contador acumulado no certifica un fallo actual ni recupera datos perdidos"})
	} else if stats.StoreEnabled != nil && *stats.StoreEnabled && stats.StoreWriteFailures == nil {
		checks = append(checks, doctorCheck{"Escrituras SQLite", "skip", "Esta version del motor no informa fallos de escritura", "Actualiza el motor para consultar este contador"})
	}
	if stats.IngestRejected > 0 || stats.Dropped > 0 {
		checks = append(checks, doctorCheck{"Errores de ingesta", "warn", fmt.Sprintf("%d rechazos de auth y %d descartes acumulados", stats.IngestRejected, stats.Dropped), "Revisa tokens, formato y logs; estos contadores no demuestran un fallo actual"})
	}
	var events []struct {
		Timestamp time.Time `json:"timestamp"`
		Source    string    `json:"source"`
	}
	if _, err := doctorGet(ctx, client, base, "/api/events?limit=25", token, &events); err != nil {
		return append(checks, doctorCheck{"Telemetria", "warn", "No se pudo consultar la muestra de eventos", "Revisa la API; el motor puede estar activo sin un sensor conectado"})
	}
	if len(events) == 0 {
		return append(checks, doctorCheck{"Telemetria", "warn", "La muestra esta vacia", "Arranca sf-sensor o configura un collector; una consola vacia no demuestra un fallo del motor"})
	}
	realRecent, demo := false, false
	for _, e := range events {
		generated := e.Source == "simulate" || e.Source == "bench"
		demo = demo || generated
		known := e.Source == "sysmon" || e.Source == "etw" || e.Source == "suricata" || e.Source == "zeek" || e.Source == "osquery" || e.Source == "cowrie" || e.Source == "windows-firewall" || e.Source == "eml"
		age := time.Since(e.Timestamp)
		if known && age >= 0 && age <= recent {
			realRecent = true
		}
	}
	if demo {
		checks = append(checks, doctorCheck{"Datos de prueba", "warn", "La muestra contiene eventos simulate o bench", "No uses eventos generados como prueba de captacion real"})
	}
	if realRecent {
		checks = append(checks, doctorCheck{"Telemetria", "ok", "Hay eventos de fuentes declaradas con fechas recientes; no certifica identidad ni conexion actual del sensor", ""})
	} else {
		checks = append(checks, doctorCheck{"Telemetria", "warn", "No hay fechas recientes de fuentes conocidas en la muestra de 25 eventos", "Comprueba el sensor y su reloj; la muestra puede estar limitada o el host inactivo"})
	}
	return checks
}
