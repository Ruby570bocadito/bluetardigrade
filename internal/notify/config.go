package notify

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"gopkg.in/yaml.v3"
)

// MaxChannels caps how many channels one config may declare. It keeps
// the fan-out (and therefore the per-alert Handle cost and the total
// outbound goroutine count) bounded no matter what an operator pastes
// into the file, same as every other config surface of the engine.
const MaxChannels = 8

// maxFileBytes is the same input standard as the rules, sequences,
// beacons and thresholds loaders: a notify config larger than 4 MiB
// is a mistake, not a configuration.
const maxFileBytes = 4 << 20

// config is the YAML shape of the -notify file.
type config struct {
	Channels []channelConfig `yaml:"channels"`
}

type channelConfig struct {
	Type        string   `yaml:"type"`
	Name        string   `yaml:"name"`
	MinSeverity string   `yaml:"min_severity"`
	URL         string   `yaml:"url"`       // slack
	Token       string   `yaml:"token"`     // telegram
	TokenEnv    string   `yaml:"token_env"` // telegram, secret from environment
	ChatID      string   `yaml:"chat_id"`   // telegram
	APIURL      string   `yaml:"api_url"`   // telegram, optional endpoint override
	Server      string   `yaml:"server"`    // email, host:port
	From        string   `yaml:"from"`      // email
	To          []string `yaml:"to"`        // email
	Username    string   `yaml:"username"`  // email, optional
	UsernameEnv string   `yaml:"username_env"`
	Password    string   `yaml:"password"` // email, optional
	PasswordEnv string   `yaml:"password_env"`
	StartTLS    *bool    `yaml:"starttls"` // email, default true
	Hello       string   `yaml:"hello"`    // email, optional EHLO domain
}

// Load parses and validates a notify config file and builds the
// ready-to-run Service. Fail loud by design: a config that cannot be
// honored exactly (unknown channel type, missing endpoint, unresolved
// secret, duplicate name) must stop the engine at startup, because a
// notification channel that silently never fires is a silent control.
func Load(path string) (*Service, error) {
	raw, err := readFileCapped(path, maxFileBytes)
	if err != nil {
		return nil, err
	}
	var cfg config
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("notify: %s: %w", path, err)
	}
	if len(cfg.Channels) == 0 {
		return nil, fmt.Errorf("notify: %s: no channels configured", path)
	}
	if len(cfg.Channels) > MaxChannels {
		return nil, fmt.Errorf("notify: %s: %d channels exceed the cap of %d", path, len(cfg.Channels), MaxChannels)
	}

	s := &Service{backoff: backoff}
	seen := map[string]bool{}
	for i, cc := range cfg.Channels {
		ch, typ, minSev, err := cc.build(i)
		if err != nil {
			return nil, fmt.Errorf("notify: %s: channel %d: %w", path, i+1, err)
		}
		if seen[ch.Name()] {
			return nil, fmt.Errorf("notify: %s: duplicate channel name %q", path, ch.Name())
		}
		seen[ch.Name()] = true
		s.workers = append(s.workers, &worker{
			ch:     ch,
			typ:    typ,
			minSev: minSev,
			queue:  make(chan alert.Alert, queueSize),
		})
	}
	return s, nil
}

func (cc channelConfig) build(i int) (Channel, string, int, error) {
	typ := strings.ToLower(strings.TrimSpace(cc.Type))
	name := strings.TrimSpace(cc.Name)
	if name == "" {
		name = typ
	}
	if !validSeverity(cc.MinSeverity) {
		return nil, "", 0, fmt.Errorf("unknown min_severity %q (valid: info, low, medium, high, critical)", cc.MinSeverity)
	}
	minSev := parseSeverity(cc.MinSeverity)

	switch typ {
	case "slack":
		if err := validHTTPURL(cc.URL); err != nil {
			return nil, "", 0, fmt.Errorf("slack %q: %w", name, err)
		}
		return NewSlack(name, cc.URL), typ, minSev, nil

	case "telegram":
		token, err := resolveSecret("telegram "+name, cc.Token, cc.TokenEnv)
		if err != nil {
			return nil, "", 0, err
		}
		if strings.TrimSpace(token) == "" {
			return nil, "", 0, fmt.Errorf("telegram %q: token is required (literal or via token_env)", name)
		}
		if strings.TrimSpace(cc.ChatID) == "" {
			return nil, "", 0, fmt.Errorf("telegram %q: chat_id is required", name)
		}
		if cc.APIURL != "" {
			if err := validHTTPURL(cc.APIURL); err != nil {
				return nil, "", 0, fmt.Errorf("telegram %q: api_url: %w", name, err)
			}
		}
		return NewTelegram(name, token, cc.ChatID, cc.APIURL), typ, minSev, nil

	case "email":
		return cc.buildEmail(name, minSev)

	default:
		return nil, "", 0, fmt.Errorf("unknown type %q (valid: slack, telegram, email)", cc.Type)
	}
}

func (cc channelConfig) buildEmail(name string, minSev int) (Channel, string, int, error) {
	host, port, err := net.SplitHostPort(strings.TrimSpace(cc.Server))
	if err != nil {
		return nil, "", 0, fmt.Errorf("email %q: server must be host:port (%v)", name, err)
	}
	if host == "" || port == "" {
		return nil, "", 0, fmt.Errorf("email %q: server host and port are both required", name)
	}
	if n, err := net.LookupPort("tcp", port); err != nil || n < 1 || n > 65535 {
		return nil, "", 0, fmt.Errorf("email %q: invalid port %q", name, port)
	}
	if strings.TrimSpace(cc.From) == "" {
		return nil, "", 0, fmt.Errorf("email %q: from is required", name)
	}
	if len(cc.To) == 0 {
		return nil, "", 0, fmt.Errorf("email %q: at least one recipient in to is required", name)
	}
	for _, r := range cc.To {
		if strings.TrimSpace(r) == "" || strings.ContainsAny(r, "\r\n") {
			return nil, "", 0, fmt.Errorf("email %q: invalid recipient %q", name, r)
		}
	}
	username, err := resolveSecret("email "+name, cc.Username, cc.UsernameEnv)
	if err != nil {
		return nil, "", 0, err
	}
	password, err := resolveSecret("email "+name, cc.Password, cc.PasswordEnv)
	if err != nil {
		return nil, "", 0, err
	}
	if (username != "") != (password != "") {
		return nil, "", 0, fmt.Errorf("email %q: username and password must be configured together (or both omitted for auth-free relays)", name)
	}
	starttls := true
	if cc.StartTLS != nil {
		starttls = *cc.StartTLS
	}
	for _, v := range []string{cc.From, cc.Hello} {
		if strings.ContainsAny(v, "\r\n") {
			return nil, "", 0, fmt.Errorf("email %q: from/hello must not contain line breaks", name)
		}
	}
	return NewEmail(name, cc.Server, cc.From, cc.To, username, password, starttls, cc.Hello), "email", minSev, nil
}

// resolveSecret honors the optional *_env indirection: when the env
// name is set, the secret comes from the environment and a literal
// value in the same field is rejected (ambiguous configs are a bug,
// not a preference). Resolution happens at load time and fails loud
// when the variable is empty — an alert channel with no credential
// would otherwise surface only as failed deliveries, minutes or days
// later.
func resolveSecret(what, literal, envName string) (string, error) {
	literal, envName = strings.TrimSpace(literal), strings.TrimSpace(envName)
	switch {
	case literal != "" && envName != "":
		return "", fmt.Errorf("%s: set either the literal value or %s, not both", what, envKeyField(envName))
	case envName != "":
		v := os.Getenv(envName)
		if v == "" {
			return "", fmt.Errorf("%s: environment variable %s is empty or unset", what, envName)
		}
		return v, nil
	default:
		return literal, nil
	}
}

func envKeyField(envName string) string { return envName }

func validHTTPURL(raw string) error {
	if strings.TrimSpace(raw) == "" {
		return fmt.Errorf("url is required")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("url %q does not parse: %w", raw, err)
	}
	if (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("url %q must be an absolute http(s) endpoint", raw)
	}
	return nil
}

// readFileCapped reads path refusing files above cap, the same
// pre-check every YAML loader of the engine applies before reading.
func readFileCapped(path string, capBytes int64) ([]byte, error) {
	fi, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("notify: %w", err)
	}
	if fi.Size() > capBytes {
		return nil, fmt.Errorf("notify: %s is %d bytes, above the %d MiB cap", path, fi.Size(), capBytes>>20)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("notify: %w", err)
	}
	return raw, nil
}
