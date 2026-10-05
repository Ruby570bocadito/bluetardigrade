package main

// The `engine scenarios` subcommand: detection validation with inert
// synthetic telemetry (TODO SIM-1). All the loading/running logic
// lives in internal/scenario; this file is CLI surface only (flags,
// wire, report, exit codes) and follows the house conventions:
// Spanish report on stdout, exit code 1 on failure, and a HARD
// loopback-only rule for the laboratory engine — a replay may never
// touch a production ingest or point at a remote host.

import (
	"bufio"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/scenario"
	"github.com/spf13/cobra"
)

const scenariosLong = `Valida las detecciones del motor con telemetria sintetica e inerte
(TODO SIM-1/SIM-2). Un escenario es un fichero YAML con la secuencia de
eventos (el mismo esquema que envia el sensor), su tecnica ATT&CK y las
alertas que se esperan; nada se ejecuta en ningun equipo.

Subcomandos:
  list    tabla de los escenarios cargados (id, tecnica, eventos, esperado)
  replay  envia los escenarios a un motor de laboratorio y comprueba,
          alerta por alerta, que se disparan las expectativas

El reproductor SOLO acepta direcciones loopback (motor de laboratorio,
por ejemplo -ingest 127.0.0.1:17777 -api http://127.0.0.1:17778) y toda
la telemetria viaja etiquetada "simulation" sobre hosts LAB-SIM-*, para
que las pruebas nunca se mezclen con la evidencia real.`

const scenariosListExample = `  engine scenarios list
  engine scenarios list -dir ./scenarios
  engine scenarios list -dir ./scenarios -only sim-lsass-comsvcs,sim-ransom-prep`

const scenariosReplayExample = `  engine scenarios replay
  engine scenarios replay -ingest 127.0.0.1:17777 -api http://127.0.0.1:17778
  engine scenarios replay -only sim-lsass-comsvcs -interval 20ms
  engine scenarios replay -tls -ca certs/ca.pem -api-token <token>`

// hostSuffixNone turns off the per-run host suffix (--host-suffix none).
const hostSuffixNone = "none"

func newScenariosCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "scenarios",
		Short: "Valida detecciones con escenarios de telemetria sintetica (solo laboratorio)",
		Long:  scenariosLong,
	}
	cmd.AddCommand(newScenariosListCmd(), newScenariosReplayCmd())
	return cmd
}

func newScenariosListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "list",
		Short:   "Tabla de los escenarios cargados (id, tecnica ATT&CK, eventos, esperado)",
		Example: scenariosListExample,
		// Same muscle-memory contract as run/rules/validate: single-dash
		// flags parsed manually with stdlib flag.
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			fs := flag.NewFlagSet("engine scenarios list", flag.ContinueOnError)
			fs.SetOutput(io.Discard)
			dir := fs.String("dir", "./scenarios", "directorio con los escenarios (.yml/.yaml)")
			only := fs.String("only", "", "ids de escenario separados por comas (filtra la lista)")
			if err := fs.Parse(args); err != nil {
				if errors.Is(err, flag.ErrHelp) {
					return cmd.Help()
				}
				return fmt.Errorf("banderas invalidas para 'scenarios list': %v", err)
			}
			if fs.NArg() > 0 {
				return fmt.Errorf("argumentos inesperados para 'scenarios list': %s; usa 'engine scenarios list -h'", strings.Join(fs.Args(), " "))
			}
			return runScenariosList(cmd.OutOrStdout(), *dir, *only)
		},
	}
}

func newScenariosReplayCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "replay",
		Short:   "Reproduce los escenarios contra un motor de laboratorio y comprueba las alertas",
		Example: scenariosReplayExample,
		// Single-dash flags, same manual stdlib parsing as 'list'.
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			fs := flag.NewFlagSet("engine scenarios replay", flag.ContinueOnError)
			fs.SetOutput(io.Discard)
			dir := fs.String("dir", "./scenarios", "directorio con los escenarios (.yml/.yaml)")
			ingest := fs.String("ingest", "127.0.0.1:17777", "ingesta NDJSON del motor de laboratorio (IP loopback literal)")
			api := fs.String("api", "http://127.0.0.1:17778", "URL de la API del motor de laboratorio (host loopback literal)")
			only := fs.String("only", "", "ids de escenario separados por comas (vacio = todos)")
			token := fs.String("token", "", "token de ingesta ('AUTH <token>'; por defecto SF_INGEST_TOKEN)")
			apiToken := fs.String("api-token", "", "credencial Bearer de la API si el motor la pide (por defecto SF_API_TOKEN)")
			tlsConn := fs.Bool("tls", false, "conectar la ingesta por TLS (motor arrancado con -ingest-cert/-ingest-key)")
			caFile := fs.String("ca", "", "CA (PEM) que firma el certificado de ingesta del motor; requiere -tls")
			interval := fs.Duration("interval", 10*time.Millisecond, "pausa entre eventos del mismo escenario")
			timeout := fs.Duration("timeout", 15*time.Second, "espera maxima por escenario a que se disparen las alertas")
			hostSuffix := fs.String("host-suffix", "", "sufijo del host sintetico por ejecucion ('none' = host exacto del YAML; vacio = -<segundos epoch>)")
			if err := fs.Parse(args); err != nil {
				if errors.Is(err, flag.ErrHelp) {
					return cmd.Help()
				}
				return fmt.Errorf("banderas invalidas para 'scenarios replay': %v", err)
			}
			if fs.NArg() > 0 {
				return fmt.Errorf("argumentos inesperados para 'scenarios replay': %s; usa 'engine scenarios replay -h'", strings.Join(fs.Args(), " "))
			}
			return runScenariosReplay(cmd.OutOrStdout(), replayOptions{
				dir: *dir, ingest: *ingest, api: *api, only: *only,
				token: *token, caFile: *caFile, hostSuffix: *hostSuffix,
				apiToken: *apiToken, tlsConn: *tlsConn,
				interval: *interval, timeout: *timeout,
			})
		},
	}
}

// replayOptions is the parsed -replay invocation.
type replayOptions struct {
	dir        string
	ingest     string
	api        string
	only       string
	token      string
	apiToken   string
	caFile     string
	hostSuffix string
	tlsConn    bool
	interval   time.Duration
	timeout    time.Duration
}

// runScenariosList prints the scenario table.
func runScenariosList(out io.Writer, dir, only string) error {
	list, err := loadScenarioLibrary(dir)
	if err != nil {
		return err
	}
	selected, err := filterScenarios(list, only)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "ESCENARIOS (%d de %d) en %s\n\n", len(selected), len(list), dir)
	fmt.Fprintln(out, "ID\tNOMBRE\tTECNICAS\tEVENTOS\tESPERADOS\tHOST")
	for _, sc := range selected {
		fmt.Fprintf(out, "%s\t%s\t%s\t%d\t%d\t%s\n",
			sc.ID, sc.Name,
			strings.Join(sc.Attack, ", "),
			len(sc.Events), len(sc.Expected), sc.Host)
	}
	return nil
}

// runScenariosReplay streams the library to the lab engine and checks
// the raised alerts through the API. Exit contract: 0 = every selected
// expectation fired; 1 = any missing expectation, unknown expectation,
// wire failure or load error.
func runScenariosReplay(out io.Writer, o replayOptions) error {
	// The lab-only guard runs BEFORE anything else: a typo in the
	// address must never push synthetic telemetry at a real ingest.
	if err := loopbackIngest(o.ingest); err != nil {
		return err
	}
	if err := loopbackAPI(o.api); err != nil {
		return err
	}
	list, err := loadScenarioLibrary(o.dir)
	if err != nil {
		return err
	}
	selected, err := filterScenarios(list, o.only)
	if err != nil {
		return err
	}
	if len(selected) == 0 {
		return fmt.Errorf("ningun escenario seleccionado en %s", o.dir)
	}

	// Catalog check FIRST: an expectation naming a rule the lab engine
	// does not have is an authoring bug (renamed rule, different pack)
	// and must fail loudly instead of reporting false regressions.
	cat, err := fetchCatalog(o)
	if err != nil {
		return fmt.Errorf("catalogo del motor de laboratorio: %w", err)
	}
	suffix := o.hostSuffix
	if suffix == "" {
		suffix = "-" + strconv.FormatInt(time.Now().Unix(), 10)
	}
	failures := 0
	fmt.Fprintf(out, "REPLAY de %d escenario(s) contra %s (API %s)\n\n", len(selected), o.ingest, o.api)
	for _, sc := range selected {
		if missing := cat.MissingExpectations(sc); len(missing) > 0 {
			failures++
			fmt.Fprintf(out, "[FALTA-CATALOGO] %s (%s): la regla %s no existe en el motor de laboratorio\n",
				sc.ID, sc.Name, strings.Join(missing, ", "))
			continue
		}
		host := sc.Host
		if suffix != hostSuffixNone {
			host += suffix
		}
		sent, err := streamScenario(sc, host, o)
		if err != nil {
			failures++
			fmt.Fprintf(out, "[ERROR] %s (%s): %v\n", sc.ID, sc.Name, err)
			continue
		}
		fired, untagged, err := waitForExpectations(sc, host, o)
		if err != nil {
			failures++
			fmt.Fprintf(out, "[ERROR] %s (%s): %v\n", sc.ID, sc.Name, err)
			continue
		}
		if untagged > 0 {
			fmt.Fprintf(out, "[AVISO] %s: %d alerta(s) del host %s SIN la etiqueta %q\n",
				sc.ID, untagged, host, alert.SimulationTag)
		}
		if !satisfied(sc, fired) {
			failures++
			var parts []string
			for _, e := range sc.Expected {
				if fired[e.RuleID] < e.MinOrDefault() {
					parts = append(parts, fmt.Sprintf("%s (esperada %d, disparada %d)", e.RuleID, e.MinOrDefault(), fired[e.RuleID]))
				}
			}
			fmt.Fprintf(out, "[FALTA] %s (%s): no se detecto -> %s\n", sc.ID, sc.Name, strings.Join(parts, "; "))
			continue
		}
		fmt.Fprintf(out, "[OK] %s (%s): %d evento(s) en host %s, %d expectativa(s) cumplida(s)\n",
			sc.ID, sc.Name, sent, host, len(sc.Expected))
	}
	fmt.Fprintln(out)
	if failures > 0 {
		return fmt.Errorf("replay con %d fallo(s) de %d escenario(s)", failures, len(selected))
	}
	fmt.Fprintf(out, "REPLAY completo: %d escenario(s), todas las expectativas disparadas.\n", len(selected))
	return nil
}

// loadScenarioLibrary wraps scenario.LoadDir with a friendly error.
func loadScenarioLibrary(dir string) ([]*scenario.Scenario, error) {
	list, err := scenario.LoadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("cargando escenarios de %s: %w", dir, err)
	}
	if len(list) == 0 {
		return nil, fmt.Errorf("no hay escenarios en %s", dir)
	}
	return list, nil
}

// filterScenarios applies the -only comma-separated id filter.
func filterScenarios(list []*scenario.Scenario, only string) ([]*scenario.Scenario, error) {
	if strings.TrimSpace(only) == "" {
		return list, nil
	}
	want := map[string]bool{}
	for _, id := range strings.Split(only, ",") {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		want[id] = true
	}
	var out []*scenario.Scenario
	seen := map[string]bool{}
	for _, sc := range list {
		if want[sc.ID] {
			out = append(out, sc)
			seen[sc.ID] = true
		}
	}
	for id := range want {
		if !seen[id] {
			return nil, fmt.Errorf("-only %q: ningun escenario con ese id", id)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// loopbackIngest enforces the project boundary: the replay ingest must
// be a literal loopback IP with a valid port (no DNS names).
func loopbackIngest(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("-ingest %q: se necesita IP:puerto", addr)
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("-ingest %q: el reproductor solo apunta a una IP de loopback literal (motor de laboratorio)", addr)
	}
	n, err := strconv.ParseUint(port, 10, 16)
	if err != nil || n == 0 {
		return fmt.Errorf("-ingest %q: puerto invalido", addr)
	}
	return nil
}

// loopbackAPI enforces the same boundary for the API base URL.
func loopbackAPI(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("-api %q: URL invalida", raw)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("-api %q: usa http:// o https://", raw)
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("-api %q: el reproductor solo consulta una API en loopback literal (motor de laboratorio)", raw)
	}
	return nil
}

// streamScenario dials the ingest (plain TCP or TLS), performs the
// AUTH handshake when a token is configured and writes the scenario
// events as NDJSON lines. It returns the number of events sent.
func streamScenario(sc *scenario.Scenario, host string, o replayOptions) (int, error) {
	conn, err := dialIngest(o)
	if err != nil {
		return 0, fmt.Errorf("conectar a %s: %w", o.ingest, err)
	}
	defer conn.Close()
	if err := authenticate(conn, o.token); err != nil {
		return 0, err
	}
	sent := 0
	for _, ev := range sc.Events {
		// the loader pins the scenario host; the per-run suffix keeps
		// repeated replays clear of the engine's 60 s alert dedup
		ev.Host = host
		line, err := ev.Encode()
		if err != nil {
			return sent, fmt.Errorf("codificar evento %s: %w", ev.ID, err)
		}
		if _, err := conn.Write(append(line, '\n')); err != nil {
			return sent, fmt.Errorf("enviar evento %s: %w", ev.ID, err)
		}
		sent++
		if o.interval > 0 {
			time.Sleep(o.interval)
		}
	}
	return sent, nil
}

// dialIngest opens the ingest connection: plain TCP by default, TLS
// when -tls is set (with an optional pinned -ca; there is deliberately
// no skip-verification mode, same as the bundled dev player).
func dialIngest(o replayOptions) (net.Conn, error) {
	if !o.tlsConn {
		return net.DialTimeout("tcp", o.ingest, 5*time.Second)
	}
	cfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if o.caFile != "" {
		pem, err := os.ReadFile(o.caFile)
		if err != nil {
			return nil, fmt.Errorf("leer -ca: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("-ca %s no contiene certificados utilizables", o.caFile)
		}
		cfg.RootCAs = pool
	}
	d := &net.Dialer{Timeout: 5 * time.Second}
	return tls.DialWithDialer(d, "tcp", o.ingest, cfg)
}

// authenticate performs the 'AUTH <token>' handshake. Empty token and
// empty SF_INGEST_TOKEN means the engine has auth disabled and the
// handshake is skipped.
func authenticate(conn net.Conn, token string) error {
	if token == "" {
		token = os.Getenv("SF_INGEST_TOKEN")
	}
	if token == "" {
		return nil
	}
	conn.SetDeadline(time.Now().Add(10 * time.Second))
	defer conn.SetDeadline(time.Time{})
	if _, err := fmt.Fprintf(conn, "AUTH %s\n", token); err != nil {
		return fmt.Errorf("enviar AUTH: %w", err)
	}
	ack, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		return fmt.Errorf("sin ack de autenticacion: %w", err)
	}
	if !strings.Contains(ack, `"ack":"ok"`) {
		return fmt.Errorf("autenticacion rechazada por el motor: %s", strings.TrimRight(ack, "\n"))
	}
	return nil
}

// apiAlert is the slice of GET /api/alerts the replay needs.
type apiAlert struct {
	RuleID string   `json:"rule_id"`
	Host   string   `json:"host"`
	Tags   []string `json:"tags"`
}

// fetchCatalog reads the lab engine's rule and sequence IDs from its
// API, so expectations are validated against what the engine actually
// loaded (not against the repo the player was compiled from).
func fetchCatalog(o replayOptions) (*scenario.Catalog, error) {
	var ruleIDs, seqIDs []string
	// The helper callbacks keep the wire payloads minimal: the replay
	// only needs the id of every rule and sequence the engine loaded.
	if err := getJSONInto(o, "/api/rules", func(data []byte) error {
		var out []struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(data, &out); err != nil {
			return err
		}
		for _, r := range out {
			ruleIDs = append(ruleIDs, r.ID)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	if err := getJSONInto(o, "/api/sequences", func(data []byte) error {
		var out []struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(data, &out); err != nil {
			return err
		}
		for _, s := range out {
			seqIDs = append(seqIDs, s.ID)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return scenario.NewCatalog(ruleIDs, seqIDs), nil
}

// waitForExpectations polls GET /api/alerts?host=... until every
// expectation of the scenario is satisfied or the timeout expires.
// It returns the fired counts and how many matching alerts arrived
// WITHOUT the simulation tag (an anomaly worth reporting, never
// counted as success).
func waitForExpectations(sc *scenario.Scenario, host string, o replayOptions) (map[string]int, int, error) {
	deadline := time.Now().Add(o.timeout)
	var fired map[string]int
	untagged := 0
	for {
		var alerts []apiAlert
		if err := getJSON(o, "/api/alerts?limit=500&host="+url.QueryEscape(host), &alerts); err != nil {
			return nil, 0, err
		}
		fired = map[string]int{}
		untagged = 0
		for _, a := range alerts {
			if a.Host != host {
				continue
			}
			tagged := false
			for _, t := range a.Tags {
				if t == alert.SimulationTag {
					tagged = true
					break
				}
			}
			if !tagged {
				untagged++
				continue
			}
			fired[a.RuleID]++
		}
		if satisfied(sc, fired) {
			return fired, untagged, nil
		}
		if time.Now().After(deadline) {
			return fired, untagged, nil
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// satisfied reports whether every expectation reached its minimum.
func satisfied(sc *scenario.Scenario, fired map[string]int) bool {
	for _, e := range sc.Expected {
		if fired[e.RuleID] < e.MinOrDefault() {
			return false
		}
	}
	return true
}

// getJSON performs an authenticated GET and decodes the body.
func getJSON(o replayOptions, path string, out any) error {
	return getJSONInto(o, path, func(data []byte) error {
		return json.Unmarshal(data, out)
	})
}

// getJSONInto performs an authenticated GET and hands the raw body to
// the decoder callback (the catalog uses it to keep payloads minimal).
func getJSONInto(o replayOptions, path string, into func([]byte) error) error {
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(o.api, "/")+path, nil)
	if err != nil {
		return err
	}
	tok := o.apiToken
	if tok == "" {
		tok = os.Getenv("SF_API_TOKEN")
	}
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: HTTP %d: %s", path, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return into(body)
}
