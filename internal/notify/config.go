package notify

import (
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
	"github.com/Ruby570bocadito/bluetardigrade/internal/yamlcheck"
	"gopkg.in/yaml.v3"
)

// MaxChannels caps how many channels one config may declare. It keeps
// the fan-out (and therefore the per-alert Handle cost and the total
// outbound goroutine count) bounded no matter what an operator pastes
// into the file, same as every other config surface of the engine.
const MaxChannels = 8

// ntfyTopicRE is ntfy's own topic alphabet, capped.
var ntfyTopicRE = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// maxFileBytes is the same input standard as the rules, sequences,
// beacons and thresholds loaders: a notify config larger than 4 MiB
// is a mistake, not a configuration.
const maxFileBytes = 4 << 20

// FileConfig is the YAML shape of the -notify file. It is exported so
// the settings API (internal/api, Ajustes -> Avisos externos) reads and
// rewrites the very structure the engine loads.
type FileConfig struct {
	// ConsoleURL is the console's address as the people receiving the
	// notifications reach it (https://soc.example.org). When set, every
	// message carries the link to its alert in the console.
	ConsoleURL string          `yaml:"console_url,omitempty"`
	Channels   []ChannelConfig `yaml:"channels"`
}

// ChannelConfig is one channel of the -notify file.
type ChannelConfig struct {
	Type        string   `yaml:"type"`
	Name        string   `yaml:"name,omitempty"`
	MinSeverity string   `yaml:"min_severity,omitempty"`
	URL         string   `yaml:"url,omitempty"`       // slack hook; ntfy server
	Topic       string   `yaml:"topic,omitempty"`     // ntfy
	Token       string   `yaml:"token,omitempty"`     // telegram, ntfy
	TokenEnv    string   `yaml:"token_env,omitempty"` // telegram, ntfy: secret from environment
	ChatID      string   `yaml:"chat_id,omitempty"`   // telegram
	APIURL      string   `yaml:"api_url,omitempty"`   // telegram, optional endpoint override
	Server      string   `yaml:"server,omitempty"`    // email, host:port
	From        string   `yaml:"from,omitempty"`      // email
	To          []string `yaml:"to,omitempty"`        // email
	Username    string   `yaml:"username,omitempty"`  // email, optional
	UsernameEnv string   `yaml:"username_env,omitempty"`
	Password    string   `yaml:"password,omitempty"` // email, optional
	PasswordEnv string   `yaml:"password_env,omitempty"`
	StartTLS    *bool    `yaml:"starttls,omitempty"` // email, default true
	Hello       string   `yaml:"hello,omitempty"`    // email, optional EHLO domain
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
	cfg, err := ParseConfig(path, raw)
	if err != nil {
		return nil, err
	}
	return Build(path, cfg)
}

// LoadOptional is Load for the file the console edits: a file that
// does not exist yet is an empty Service (no channels until someone
// creates them from Ajustes -> Avisos externos), anything else follows
// Load's fail-loud contract.
func LoadOptional(path string) (*Service, error) {
	if _, err := os.Stat(path); errors.Is(err, fs.ErrNotExist) {
		return &Service{backoff: backoff}, nil
	}
	return Load(path)
}

// ParseConfig decodes a notify file under the same input guard as
// every YAML surface of the engine. An empty document is refused (a
// file with nothing in it is a mistake), an explicit `channels: []`
// is not: it is what the console writes when the last channel goes.
func ParseConfig(path string, raw []byte) (*FileConfig, error) {
	if err := yamlcheck.Guard(path, raw); err != nil {
		return nil, err
	}
	var cfg FileConfig
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("notify: %s: %w", path, err)
	}
	if cfg.Channels == nil {
		return nil, fmt.Errorf("notify: %s: no channels configured", path)
	}
	return &cfg, nil
}

// Build validates a parsed config and builds the Service it describes.
func Build(path string, cfg *FileConfig) (*Service, error) {
	if len(cfg.Channels) > MaxChannels {
		return nil, fmt.Errorf("notify: %s: %d channels exceed the cap of %d", path, len(cfg.Channels), MaxChannels)
	}
	if cfg.ConsoleURL != "" {
		if err := validConsoleURL(cfg.ConsoleURL); err != nil {
			return nil, fmt.Errorf("notify: %s: console_url: %w", path, err)
		}
	}
	link := strings.TrimRight(strings.TrimSpace(cfg.ConsoleURL), "/")

	s := &Service{backoff: backoff, consoleURL: link}
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
		if l, ok := ch.(linker); ok {
			l.setConsoleURL(link)
		}
		s.workers = append(s.workers, &worker{
			ch:     ch,
			typ:    typ,
			minSev: minSev,
			queue:  make(chan alert.Alert, queueSize),
		})
	}
	return s, nil
}

// Marshal renders the config back to YAML, the form the settings API
// writes to disk.
func (cfg *FileConfig) Marshal() ([]byte, error) {
	if cfg.Channels == nil {
		cfg.Channels = []ChannelConfig{}
	}
	return yaml.Marshal(cfg)
}

// ChannelName is the name a channel is known by: its name, or its type
// when it has none (the same rule Build applies).
func (cc ChannelConfig) ChannelName() string {
	if name := strings.TrimSpace(cc.Name); name != "" {
		return name
	}
	return strings.ToLower(strings.TrimSpace(cc.Type))
}

// validConsoleURL accepts an absolute http(s) address without query or
// fragment: the alert link is appended to it.
func validConsoleURL(raw string) error {
	if err := validHTTPURL(raw); err != nil {
		return err
	}
	u, _ := url.Parse(strings.TrimSpace(raw))
	if u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return fmt.Errorf("must be the console's base address, without credentials, query or fragment (%s)", redact.EndpointLabel(raw))
	}
	return nil
}

func (cc ChannelConfig) build(i int) (Channel, string, int, error) {
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

	case "ntfy":
		if err := validHTTPURL(cc.URL); err != nil {
			return nil, "", 0, fmt.Errorf("ntfy %q: url (the ntfy server): %w", name, err)
		}
		if !ntfyTopicRE.MatchString(cc.Topic) {
			return nil, "", 0, fmt.Errorf("ntfy %q: topic is required: letters, digits, - and _ (1-64)", name)
		}
		token, err := resolveSecret("ntfy "+name, cc.Token, cc.TokenEnv)
		if err != nil {
			return nil, "", 0, err
		}
		return NewNtfy(name, cc.URL, cc.Topic, token), typ, minSev, nil

	default:
		return nil, "", 0, fmt.Errorf("unknown type %q (valid: slack, telegram, email, ntfy)", cc.Type)
	}
}

func (cc ChannelConfig) buildEmail(name string, minSev int) (Channel, string, int, error) {
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
		// Double echo guarded (#35 remainder, family #30): the %q echo AND
		// the wrapped *url.Error both print the raw input verbatim (url.Error
		// embeds the URL in its own message), and this rejected-config error
		// lands in the engine log (run.go "notify config rejected"), which is
		// stderr every downstream log shipper can read. The endpoint can
		// embed a credential (Slack hook path, proxy userinfo, collector
		// key); scheme://host - or the <endpoint> placeholder on parse
		// failure - is enough to locate the line in YAML next to the channel
		// name the caller already wraps in the error.
		return fmt.Errorf("url does not parse (%s)", redact.EndpointLabel(raw))
	}
	if (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("url must be an absolute http(s) endpoint (%s)", redact.EndpointLabel(raw))
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

// WriteFile commits the config atomically (temp file in the same
// directory, 0600 — the file may hold literal secrets — fsync, rename),
// creating the directory the first time the console writes it.
func (cfg *FileConfig) WriteFile(path string) error {
	data, err := cfg.Marshal()
	if err != nil {
		return fmt.Errorf("notify: serialize config: %w", err)
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("notify: config directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".notify-config-*")
	if err != nil {
		return fmt.Errorf("notify: temp file for config: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after a successful rename
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("notify: chmod config: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("notify: write config: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("notify: sync config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("notify: close config: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("notify: install config: %w", err)
	}
	return nil
}

// ReadFileConfig reads the file the settings API edits: a missing file
// is an empty config (exists=false), the rest follows Load's input rules.
func ReadFileConfig(path string) (cfg *FileConfig, raw []byte, exists bool, err error) {
	if _, serr := os.Stat(path); errors.Is(serr, fs.ErrNotExist) {
		return &FileConfig{Channels: []ChannelConfig{}}, nil, false, nil
	}
	raw, err = readFileCapped(path, maxFileBytes)
	if err != nil {
		return nil, nil, true, err
	}
	cfg, err = ParseConfig(path, raw)
	return cfg, raw, true, err
}
