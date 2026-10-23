// The settings surface of the external notification channels (F3,
// Ajustes -> Avisos externos). Three routes, all admin business:
//
//   GET  /api/settings/notify   the -notify file as the console edits it,
//                               with every secret replaced by a presence
//                               flag (a Slack hook URL, a Telegram or
//                               ntfy token, an SMTP password are never
//                               read back), plus the live counters
//   PUT  /api/settings/notify   validate with the loader's own rules ->
//                               commit the YAML atomically -> swap the
//                               channels in without restarting the
//                               engine; 409 when the file drifted on disk
//   POST /api/notify/test       "Enviar prueba": one test message to one
//                               channel or to all, answered per channel
//
// Contract: the same as the Active Directory settings (ad_settings.go)
// — behind -api-write (403), because the single bearer token has no
// role model and arming writes IS the admin gate, and 501 while the
// engine runs without -notify. A secret left empty in a PUT keeps the
// stored one of the channel with the same name; clear_secret drops it.
// Every committed change and every test leaves one line in the engine
// log, never a secret.

package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/Ruby570bocadito/bluetardigrade/internal/notify"
	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
)

// notifySettingsMaxBodyBytes caps the PUT body: eight channels of short
// fields fit many times over.
const notifySettingsMaxBodyBytes = 32 << 10

type notifySettings struct {
	mu      sync.Mutex // serializes PUTs and tests
	path    string
	live    *notify.Live
	sum     [sha256.Size]byte
	existed bool
}

// SetNotifySettings arms the surface with the -notify path and the
// running channels. The drift baseline is the file as the engine loaded
// it (or its absence): a hand edit after startup must be reconciled by
// a human, never clobbered by a PUT.
func (h *Hub) SetNotifySettings(path string, live *notify.Live) {
	ns := &notifySettings{path: path, live: live}
	if _, raw, exists, err := notify.ReadFileConfig(path); err == nil {
		ns.existed = exists
		if exists {
			ns.sum = sha256.Sum256(raw)
		}
	}
	h.mu.Lock()
	h.notifySettings = ns
	h.mu.Unlock()
}

func (h *Hub) registerNotifySettings(mux *http.ServeMux) {
	const what = "Ajustes de notificaciones"
	mux.HandleFunc("GET /api/settings/notify", unscopedOnly(what, h.handleNotifySettingsGet))
	mux.HandleFunc("PUT /api/settings/notify", unscopedOnly(what, h.handleNotifySettingsPut))
	mux.HandleFunc("POST /api/notify/test", unscopedOnly(what, h.handleNotifyTest))
}

// notifyGate: 403 without -api-write (a non-admin probe learns nothing,
// not even whether -notify is on), then 501 while -notify is off.
func (h *Hub) notifyGate(w http.ResponseWriter) *notifySettings {
	h.mu.Lock()
	writeOK, ns := h.writeEnabled, h.notifySettings
	h.mu.Unlock()
	if !writeOK {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		fmt.Fprintln(w, `{"error":"api writes are disabled: restart the engine with -api-write (or SF_API_WRITE=1) to manage notifications"}`)
		return nil
	}
	if ns == nil {
		writeErr(w, http.StatusNotImplemented, "las notificaciones no están armadas: arranca el motor con -notify <fichero> (sf-start lo hace con tools\\config\\notify.yaml)")
		return nil
	}
	return ns
}

// notifyChannelWire is one channel as the console sees and sends it.
// The secret fields (url of a Slack hook, token, password) are
// write-only: GET leaves them empty and reports *_set instead.
type notifyChannelWire struct {
	Type        string   `json:"type"`
	Name        string   `json:"name"`
	MinSeverity string   `json:"min_severity"`
	URL         string   `json:"url,omitempty"`
	URLSet      bool     `json:"url_set"`
	URLLabel    string   `json:"url_label,omitempty"`
	Topic       string   `json:"topic,omitempty"`
	Token       string   `json:"token,omitempty"`
	TokenEnv    string   `json:"token_env,omitempty"`
	TokenSet    bool     `json:"token_set"`
	ChatID      string   `json:"chat_id,omitempty"`
	APIURL      string   `json:"api_url,omitempty"`
	Server      string   `json:"server,omitempty"`
	From        string   `json:"from,omitempty"`
	To          []string `json:"to,omitempty"`
	Username    string   `json:"username,omitempty"`
	UsernameEnv string   `json:"username_env,omitempty"`
	Password    string   `json:"password,omitempty"`
	PasswordEnv string   `json:"password_env,omitempty"`
	PasswordSet bool     `json:"password_set"`
	StartTLS    *bool    `json:"starttls,omitempty"`
	Hello       string   `json:"hello,omitempty"`
	// PUT only: drop the stored literal token/password of this channel
	ClearSecret bool `json:"clear_secret,omitempty"`
}

type notifySettingsWire struct {
	Path       string                `json:"path"`
	Exists     bool                  `json:"exists"`
	ConsoleURL string                `json:"console_url"`
	Channels   []notifyChannelWire   `json:"channels"`
	Stats      []notify.ChannelStats `json:"stats"`
}

// slackLike: the channel types whose url is the credential itself.
func urlIsSecret(typ string) bool { return strings.EqualFold(typ, "slack") }

func channelToWire(cc notify.ChannelConfig) notifyChannelWire {
	typ := strings.ToLower(strings.TrimSpace(cc.Type))
	out := notifyChannelWire{
		Type:        typ,
		Name:        cc.ChannelName(),
		MinSeverity: cc.MinSeverity,
		Topic:       cc.Topic,
		TokenEnv:    cc.TokenEnv,
		TokenSet:    cc.Token != "",
		ChatID:      cc.ChatID,
		APIURL:      cc.APIURL,
		Server:      cc.Server,
		From:        cc.From,
		To:          append([]string{}, cc.To...),
		Username:    cc.Username,
		UsernameEnv: cc.UsernameEnv,
		PasswordEnv: cc.PasswordEnv,
		PasswordSet: cc.Password != "",
		StartTLS:    cc.StartTLS,
		Hello:       cc.Hello,
	}
	if urlIsSecret(typ) {
		out.URLSet = cc.URL != ""
		if cc.URL != "" {
			out.URLLabel = redact.EndpointLabel(cc.URL)
		}
	} else {
		out.URL = cc.URL
		out.URLSet = cc.URL != ""
	}
	return out
}

// wireToChannel builds the config channel from a PUT entry, filling the
// secrets left empty from the stored channel of the same name and type.
func wireToChannel(in notifyChannelWire, prev map[string]notify.ChannelConfig) notify.ChannelConfig {
	typ := strings.ToLower(strings.TrimSpace(in.Type))
	cc := notify.ChannelConfig{
		Type:        typ,
		Name:        strings.TrimSpace(in.Name),
		MinSeverity: strings.TrimSpace(in.MinSeverity),
		URL:         strings.TrimSpace(in.URL),
		Topic:       strings.TrimSpace(in.Topic),
		Token:       in.Token,
		TokenEnv:    strings.TrimSpace(in.TokenEnv),
		ChatID:      strings.TrimSpace(in.ChatID),
		APIURL:      strings.TrimSpace(in.APIURL),
		Server:      strings.TrimSpace(in.Server),
		From:        strings.TrimSpace(in.From),
		Username:    strings.TrimSpace(in.Username),
		UsernameEnv: strings.TrimSpace(in.UsernameEnv),
		Password:    in.Password,
		PasswordEnv: strings.TrimSpace(in.PasswordEnv),
		StartTLS:    in.StartTLS,
		Hello:       strings.TrimSpace(in.Hello),
	}
	for _, r := range in.To {
		if r = strings.TrimSpace(r); r != "" {
			cc.To = append(cc.To, r)
		}
	}
	old, ok := prev[cc.ChannelName()]
	if !ok || !strings.EqualFold(old.Type, typ) {
		return cc
	}
	if urlIsSecret(typ) && cc.URL == "" {
		cc.URL = old.URL
	}
	if in.ClearSecret {
		cc.Token, cc.Password = "", ""
		return cc
	}
	// a secret moved to the environment does not keep the literal
	if cc.Token == "" && cc.TokenEnv == "" {
		cc.Token = old.Token
	}
	if cc.Password == "" && cc.PasswordEnv == "" {
		cc.Password = old.Password
	}
	return cc
}

func (ns *notifySettings) wire(cfg *notify.FileConfig, exists bool) *notifySettingsWire {
	out := &notifySettingsWire{Path: ns.path, Exists: exists, ConsoleURL: cfg.ConsoleURL, Channels: []notifyChannelWire{}, Stats: ns.live.Stats()}
	for _, cc := range cfg.Channels {
		out.Channels = append(out.Channels, channelToWire(cc))
	}
	return out
}

// handleNotifySettingsGet serves GET /api/settings/notify.
func (h *Hub) handleNotifySettingsGet(w http.ResponseWriter, _ *http.Request) {
	ns := h.notifyGate(w)
	if ns == nil {
		return
	}
	cfg, _, exists, err := notify.ReadFileConfig(ns.path)
	if err != nil {
		writeErr(w, http.StatusConflict, fmt.Sprintf("the -notify file does not load: %v", err))
		return
	}
	writeJSON(w, ns.wire(cfg, exists))
}

type notifyUpdate struct {
	ConsoleURL string              `json:"console_url"`
	Channels   []notifyChannelWire `json:"channels"`
}

// handleNotifySettingsPut serves PUT /api/settings/notify.
func (h *Hub) handleNotifySettingsPut(w http.ResponseWriter, r *http.Request) {
	ns := h.notifyGate(w)
	if ns == nil {
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, notifySettingsMaxBodyBytes))
	if err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("unreadable or oversized request body (%d KiB limit)", notifySettingsMaxBodyBytes>>10))
		return
	}
	var in notifyUpdate
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil || in.Channels == nil {
		writeErr(w, http.StatusBadRequest, `body must be JSON: {"console_url":"...","channels":[{"type":"slack|telegram|email|ntfy",...}]}`)
		return
	}

	ns.mu.Lock()
	defer ns.mu.Unlock()

	current, raw, exists, err := notify.ReadFileConfig(ns.path)
	// Drift gate: the file is the shared source of truth.
	switch {
	case exists && (err != nil || sha256.Sum256(raw) != ns.sum || !ns.existed):
		writeErr(w, http.StatusConflict, "the -notify file changed on disk since the engine loaded it; restart the engine to adopt it before editing notifications here")
		return
	case !exists && ns.existed:
		writeErr(w, http.StatusConflict, "the -notify file was removed from disk since the engine loaded it; restart the engine before editing notifications here")
		return
	}
	prev := map[string]notify.ChannelConfig{}
	for _, cc := range current.Channels {
		prev[cc.ChannelName()] = cc
	}
	next := &notify.FileConfig{ConsoleURL: strings.TrimSpace(in.ConsoleURL), Channels: []notify.ChannelConfig{}}
	for _, c := range in.Channels {
		next.Channels = append(next.Channels, wireToChannel(c, prev))
	}
	svc, err := notify.Build(ns.path, next)
	if err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("configuration rejected: %v", err))
		return
	}
	if err := next.WriteFile(ns.path); err != nil {
		log.Printf("[API] WRITE notify-settings FAILED: %v", err)
		writeErr(w, http.StatusInternalServerError, "the -notify file is not writable (see engine log)")
		return
	}
	committed, rawNew, _, err := notify.ReadFileConfig(ns.path)
	if err != nil {
		log.Printf("[API] WRITE notify-settings: re-read failed: %v", err)
		writeErr(w, http.StatusInternalServerError, "the -notify file was written but does not read back (see engine log)")
		return
	}
	ns.sum, ns.existed = sha256.Sum256(rawNew), true
	ns.live.Swap(svc)
	log.Printf("[API] WRITE notify-settings channels=%d [%s] console_url=%t (file %s)",
		len(next.Channels), oneLine(strings.Join(svc.Summary(), ", ")), next.ConsoleURL != "", oneLine(ns.path))
	writeJSON(w, ns.wire(committed, true))
}

// handleNotifyTest serves POST /api/notify/test: {"name":""} tests every
// channel, {"name":"x"} the one named.
func (h *Hub) handleNotifyTest(w http.ResponseWriter, r *http.Request) {
	ns := h.notifyGate(w)
	if ns == nil {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4096))
	if err != nil || (len(bytes.TrimSpace(body)) > 0 && json.Unmarshal(body, &in) != nil) {
		writeErr(w, http.StatusBadRequest, `body must be JSON: {"name":"<channel>"} or {} for every channel`)
		return
	}
	ns.mu.Lock()
	defer ns.mu.Unlock()
	results := ns.live.Test(r.Context(), strings.TrimSpace(in.Name))
	if in.Name != "" && len(results) == 0 {
		writeErr(w, http.StatusNotFound, "no channel with that name is running")
		return
	}
	ok := 0
	for _, res := range results {
		if res.OK {
			ok++
		}
	}
	log.Printf("[API] notify test name=%q channels=%d ok=%d", oneLine(in.Name), len(results), ok)
	writeJSON(w, map[string]any{"results": results})
}
