package main

import (
	"context"
	"encoding/json"
	"html"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const doctorWebBodyLimit = 128 * 1024

// These probes only read the console and hub's public status surfaces. They
// never send the engine token, request an analysis, or report response bodies.
func doctorConsoleChecks(ctx context.Context, consoleURL, hubURL string, client *http.Client) []doctorCheck {
	probeClient := &http.Client{Timeout: 5 * time.Second}
	if client != nil {
		*probeClient = *client
		if probeClient.Timeout == 0 {
			probeClient.Timeout = 5 * time.Second
		}
	}
	probeClient.Jar = nil
	probeClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }

	console, consoleValid := doctorPublicURL(consoleURL)
	hub, hubValid := doctorPublicURL(hubURL)
	checks := make([]doctorCheck, 0, 4)
	var consoleBody []byte
	var consoleHeaders http.Header
	consoleVerified := false

	switch {
	case consoleURL == "":
		checks = append(checks, doctorCheck{Name: "Consola", Status: "skip", Detail: "No se ha indicado una consola."})
	case !consoleValid:
		checks = append(checks, doctorCheck{Name: "Consola", Status: "warn", Detail: "La URL de la consola no es una URL HTTP(S) valida sin credenciales, consulta ni fragmento.", Remedy: "Indica la URL base de la consola con -console-url."})
	default:
		body, headers, status, err := doctorPublicGet(ctx, probeClient, console)
		mediaType, _, _ := mime.ParseMediaType(headers.Get("Content-Type"))
		switch {
		case err != nil:
			checks = append(checks, doctorCheck{Name: "Consola", Status: "warn", Detail: "No se pudo leer la consola en " + console.Host + ".", Remedy: "Arranca la consola y comprueba su puerto y -console-url."})
		case status != http.StatusOK:
			checks = append(checks, doctorCheck{Name: "Consola", Status: "warn", Detail: "La consola no devuelve HTTP 200 en " + console.Host + ".", Remedy: "Comprueba la URL base y el servicio de la consola; el diagnostico no sigue redirecciones."})
		case mediaType != "text/html" || !strings.Contains(strings.ToLower(string(body)), "bluetardigrade"):
			checks = append(checks, doctorCheck{Name: "Consola", Status: "warn", Detail: "La respuesta de " + console.Host + " no permite confirmar la consola bluetardigrade en los primeros 128 KiB.", Remedy: "Comprueba que -console-url apunta a la consola SOC y no a otra web."})
		default:
			consoleVerified, consoleBody, consoleHeaders = true, body, headers
			checks = append(checks, doctorCheck{Name: "Consola", Status: "ok", Detail: "La consola bluetardigrade responde con HTML en " + console.Host + "."})
		}
	}

	switch {
	case !consoleVerified:
		checks = append(checks, doctorCheck{Name: "CSP del analista", Status: "skip", Detail: "No se ha podido verificar la consola."})
	case hubURL == "" || !hubValid:
		checks = append(checks, doctorCheck{Name: "CSP del analista", Status: "skip", Detail: "No hay una URL valida del hub para comparar con la CSP."})
	default:
		checks = append(checks, doctorAnalystCSP(console, hub, consoleHeaders, consoleBody))
	}

	switch {
	case hubURL == "":
		checks = append(checks, doctorCheck{Name: "Hub IA", Status: "skip", Detail: "No se ha indicado un hub IA."}, doctorCheck{Name: "Configuracion IA", Status: "skip", Detail: "No se ha indicado un hub IA."})
	case !hubValid:
		checks = append(checks, doctorCheck{Name: "Hub IA", Status: "warn", Detail: "La URL del hub no es una URL HTTP(S) valida sin credenciales, consulta ni fragmento.", Remedy: "Indica la URL base del hub con -hub-url."}, doctorCheck{Name: "Configuracion IA", Status: "skip", Detail: "No hay una URL valida del hub."})
	default:
		healthURL := *hub
		healthURL.Path = strings.TrimRight(healthURL.Path, "/") + "/health"
		healthURL.RawPath = ""
		body, _, status, err := doctorPublicGet(ctx, probeClient, &healthURL)
		var health struct {
			Service string `json:"service"`
			Status  string `json:"status"`
			Mode    string `json:"mode"`
			Engine  struct {
				Connected *bool `json:"connected"`
			} `json:"engine"`
			Analyst struct {
				Configured *bool `json:"configured"`
			} `json:"analyst"`
		}
		if err != nil || status != http.StatusOK || json.Unmarshal(body, &health) != nil || health.Service != "console-service" {
			checks = append(checks, doctorCheck{Name: "Hub IA", Status: "warn", Detail: "No se pudo confirmar console-service en /health de " + hub.Host + ".", Remedy: "Arranca web/console-service y comprueba -hub-url; el diagnostico no sigue redirecciones."}, doctorCheck{Name: "Configuracion IA", Status: "skip", Detail: "No se ha podido leer un estado valido del hub."})
			break
		}
		if health.Mode == "engine" && health.Status == "ok" && health.Engine.Connected != nil && *health.Engine.Connected {
			checks = append(checks, doctorCheck{Name: "Hub IA", Status: "ok", Detail: "console-service responde en " + hub.Host + " y declara conexion al motor."})
		} else if health.Mode == "sin-motor" && health.Engine.Connected != nil && !*health.Engine.Connected {
			checks = append(checks, doctorCheck{Name: "Hub IA", Status: "warn", Detail: "console-service responde en " + hub.Host + " en modo sin-motor; no declara telemetria conectada.", Remedy: "Si necesitas telemetria en el hub, arranca el motor y comprueba ENGINE_URL y su token."})
		} else {
			checks = append(checks, doctorCheck{Name: "Hub IA", Status: "warn", Detail: "console-service responde en " + hub.Host + ", pero su estado no confirma la conexion al motor.", Remedy: "Comprueba el estado del hub, ENGINE_URL y el token del motor."})
		}
		switch {
		case health.Analyst.Configured == nil:
			checks = append(checks, doctorCheck{Name: "Configuracion IA", Status: "warn", Detail: "El hub no informa si el analista esta configurado.", Remedy: "Comprueba la version y las variables ANALYST_* del hub."})
		case *health.Analyst.Configured:
			checks = append(checks, doctorCheck{Name: "Configuracion IA", Status: "ok", Detail: "El hub declara configured=true. No se ha realizado una consulta al proveedor IA."})
		default:
			checks = append(checks, doctorCheck{Name: "Configuracion IA", Status: "warn", Detail: "El hub declara configured=false; el analista IA no esta configurado.", Remedy: "Configura ANALYST_BASE_URL, ANALYST_MODEL y ANALYST_API_KEY y reinicia el hub."})
		}
	}
	return checks
}

func doctorPublicURL(raw string) (*url.URL, bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" {
		return nil, false
	}
	return u, true
}

func doctorPublicGet(ctx context.Context, client *http.Client, target *url.URL) ([]byte, http.Header, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, http.Header{}, 0, err
	}
	req.Header.Set("Accept", "text/html, application/json")
	res, err := client.Do(req)
	if err != nil {
		return nil, http.Header{}, 0, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, doctorWebBodyLimit))
	return body, res.Header, res.StatusCode, err
}

var doctorMetaTag = regexp.MustCompile(`(?is)<meta\s+[^>]*>`)
var doctorMetaAttribute = regexp.MustCompile(`(?is)([a-z][a-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`)

func doctorAnalystCSP(console, hub *url.URL, headers http.Header, body []byte) doctorCheck {
	if len(body) >= doctorWebBodyLimit {
		return doctorCheck{Name: "CSP del analista", Status: "warn", Detail: "La respuesta supera el limite de lectura de 128 KiB; no se han podido comprobar todas las posibles CSP de la pagina.", Remedy: "Comprueba connect-src en los encabezados y en las etiquetas meta de la consola."}
	}
	policies := append([]string(nil), headers.Values("Content-Security-Policy")...)
	for _, tag := range doctorMetaTag.FindAllString(string(body), -1) {
		attrs := map[string]string{}
		for _, attr := range doctorMetaAttribute.FindAllStringSubmatch(tag, -1) {
			value := attr[2] + attr[3] + attr[4]
			key := strings.ToLower(attr[1])
			if _, duplicate := attrs[key]; !duplicate {
				attrs[key] = html.UnescapeString(value)
			}
		}
		if strings.EqualFold(attrs["http-equiv"], "Content-Security-Policy") {
			policies = append(policies, attrs["content"])
		}
	}
	if len(policies) == 0 {
		return doctorCheck{Name: "CSP del analista", Status: "warn", Detail: "La consola no publica una CSP verificable.", Remedy: "Revisa los encabezados de seguridad de la consola."}
	}
	websocket := *hub
	websocket.Scheme = strings.Replace(hub.Scheme, "http", "ws", 1)
	for _, policyList := range policies {
		for _, policy := range strings.Split(policyList, ",") {
			if strings.TrimSpace(policy) == "" {
				return doctorCheck{Name: "CSP del analista", Status: "warn", Detail: "La consola publica una CSP vacia que no permite verificar su configuracion.", Remedy: "Revisa los encabezados de seguridad de la consola."}
			}
			sources, restricted := doctorConnectSources(policy)
			if restricted && (!doctorCSPAllows(sources, console, hub) || !doctorCSPAllows(sources, console, &websocket)) {
				return doctorCheck{Name: "CSP del analista", Status: "warn", Detail: "La CSP no permite confirmar HTTP(S) y WebSocket hacia el hub seleccionado en " + hub.Host + ".", Remedy: "Alinea NEXT_PUBLIC_CONSOLE_URL y connect-src con los origenes HTTP(S) y WS(S) del hub y recompila la consola."}
			}
		}
	}
	return doctorCheck{Name: "CSP del analista", Status: "ok", Detail: "La CSP permite HTTP(S) y WebSocket hacia el hub seleccionado en " + hub.Host + "."}
}

func doctorConnectSources(policy string) ([]string, bool) {
	var fallback []string
	foundFallback := false
	for _, directive := range strings.Split(policy, ";") {
		parts := strings.Fields(directive)
		if len(parts) == 0 {
			continue
		}
		switch strings.ToLower(parts[0]) {
		case "connect-src":
			return parts[1:], true
		case "default-src":
			if !foundFallback {
				fallback, foundFallback = parts[1:], true
			}
		}
	}
	return fallback, foundFallback
}

func doctorCSPAllows(sources []string, console, target *url.URL) bool {
	for _, source := range sources {
		if source == "*" {
			return true
		}
		if source == "'self'" {
			// Explicit WS(S) sources are required below because browsers differ
			// in whether 'self' also covers WebSocket on the same host.
			if target.Scheme == console.Scheme && doctorURLOrigin(target) == doctorURLOrigin(console) {
				return true
			}
			continue
		}
		if source == target.Scheme+":" {
			return true
		}
		allowed, err := url.Parse(source)
		if err == nil && allowed.Host != "" && allowed.User == nil && allowed.RawQuery == "" && allowed.Fragment == "" && (allowed.Path == "" || allowed.Path == "/") && doctorURLOrigin(allowed) == doctorURLOrigin(target) {
			return true
		}
	}
	return false
}

func doctorURLOrigin(u *url.URL) string {
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if port == "" {
		if u.Scheme == "http" || u.Scheme == "ws" {
			port = "80"
		} else if u.Scheme == "https" || u.Scheme == "wss" {
			port = "443"
		}
	}
	return strings.ToLower(u.Scheme) + "://" + host + ":" + port
}
