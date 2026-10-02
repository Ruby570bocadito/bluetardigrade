// Package model defines the unified event schema shared by sensors,
// the detection engine and every output interface. It is the contract
// described in docs/architecture (chapter 4) and must remain backwards
// compatible: add fields, never repurpose them.
package model

import (
	"encoding/json"
	"time"
)

// Hashes stores binary digests keyed by algorithm ("sha256", "md5").
type Hashes map[string]string

// Process carries process-creation/termination telemetry.
type Process struct {
	PID         int    `json:"pid"`
	PPID        int    `json:"ppid,omitempty"`
	Name        string `json:"name"`
	CommandLine string `json:"command_line,omitempty"`
	Image       string `json:"image,omitempty"`
	Hashes      Hashes `json:"hashes,omitempty"`
}

// File carries file-write telemetry.
type File struct {
	Path      string `json:"path,omitempty"`
	Extension string `json:"extension,omitempty"`
	SizeBytes int64  `json:"size_bytes,omitempty"`
	Hashes    Hashes `json:"hashes,omitempty"`
}

// Network carries connection telemetry (L4/L7).
type Network struct {
	Protocol        string `json:"protocol,omitempty"`
	SourceIP        string `json:"source_ip,omitempty"`
	SourcePort      int    `json:"source_port,omitempty"`
	DestinationIP   string `json:"destination_ip,omitempty"`
	DestinationPort int    `json:"destination_port,omitempty"`
	Domain          string `json:"domain,omitempty"`
}

// ProcessAccess carries process-handle telemetry (Sysmon event ID
// 10): which process opened which target process and with what access
// rights. This is the primary real-telemetry signal for credential
// dumping (LSASS) and code injection.
type ProcessAccess struct {
	GrantedAccess string `json:"granted_access,omitempty"` // hex mask, e.g. 0x1010
	CallTrace     string `json:"call_trace,omitempty"`     // stack of the caller
}

// Registry carries registry telemetry: which key/value was touched,
// how (create, set, rename, delete) and, when available, the data
// written. Populated by real sensors (Sysmon event IDs 12/13/14).
type Registry struct {
	Key       string `json:"key,omitempty"`        // e.g. HKCU\Software\...\Run
	ValueName string `json:"value_name,omitempty"` // value name inside the key
	Value     string `json:"value,omitempty"`      // data written (Sysmon Details)
	Operation string `json:"operation,omitempty"`  // SetValue | CreateKey | DeleteKey | RenameKey
}

// Event is the unified, transport-agnostic event record. One JSON line
// on the wire (NDJSON), one row in forensic storage.
type Event struct {
	ID        string         `json:"id"`
	Timestamp time.Time      `json:"timestamp"`
	Type      string         `json:"type"`
	Source    string         `json:"source"`
	Host      string         `json:"host"`
	User      string         `json:"user,omitempty"`
	Process   *Process       `json:"process,omitempty"`
	Target    *Process       `json:"target,omitempty"` // target of process.access
	Access    *ProcessAccess `json:"access,omitempty"`
	File      *File          `json:"file,omitempty"`
	Network   *Network       `json:"network,omitempty"`
	Registry  *Registry      `json:"registry,omitempty"`
	Tags      []string       `json:"tags,omitempty"`
	// Attributes contains declared source observations, never engine enrichment.
	Attributes map[string]string `json:"attributes,omitempty"`

	// Enrichment is added by the engine, never by sensors, and never
	// mutates the raw evidence fields above.
	Enrichment map[string]string `json:"enrichment,omitempty"`
}

// Event types supported by the v0.1 schema.
const (
	TypeProcessCreate    = "process.create"
	TypeProcessTerminate = "process.terminate"
	TypeProcessAccess    = "process.access"
	TypeFileWrite        = "file.write"
	TypeNetworkConnect   = "network.connect"
	TypeImageLoad        = "image.load"
	TypeRegistrySet      = "registry.set"
	TypeNetworkAlert     = "network.alert"
	TypeHostQuery        = "host.query"
	TypeHoneypotConnect  = "honeypot.connect"
	TypeHoneypotLogin    = "honeypot.login"
	TypeHoneypotCommand  = "honeypot.command"
	TypeNetworkFirewall  = "network.firewall"
	TypeEmailMessage     = "email.message"
)

// FieldMap flattens the event into a generic map so rule conditions can
// address any field with a dotted path (e.g. "process.command_line").
// Numeric values arrive as float64, as produced by encoding/json.
func (e *Event) FieldMap() map[string]any {
	b, err := json.Marshal(e)
	if err != nil {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil
	}
	return m
}

// Encode serializes the event as a single NDJSON line (no trailing
// newline) ready to be written to a TCP stream or forensic log.
func (e *Event) Encode() ([]byte, error) {
	return json.Marshal(e)
}

// MaxFutureSkew bounds how far ahead of the engine clock an event
// timestamp is trusted by the time-window detectors.
const MaxFutureSkew = 5 * time.Minute

// DetectionTime is the instant the time-window detectors (correlator,
// beaconing, thresholds) assign to the event: its own timestamp, so
// imported logs and batching sensors are judged on when things
// happened rather than on when they reached the engine, or wall when
// the timestamp is missing or more than MaxFutureSkew ahead of wall (a
// skewed or hostile clock must not push detector windows forward).
func (e *Event) DetectionTime(wall time.Time) time.Time {
	if e.Timestamp.IsZero() || e.Timestamp.After(wall.Add(MaxFutureSkew)) {
		return wall
	}
	return e.Timestamp
}

// Validate performs the minimal sanity checks required at ingestion.
func (e *Event) Validate() error {
	if e.ID == "" {
		return ErrMissingID
	}
	if e.Type == "" {
		return ErrMissingType
	}
	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now().UTC()
	}
	return nil
}
