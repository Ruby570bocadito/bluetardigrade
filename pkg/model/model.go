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

// Event is the unified, transport-agnostic event record. One JSON line
// on the wire (NDJSON), one row in forensic storage.
type Event struct {
        ID        string    `json:"id"`
        Timestamp time.Time `json:"timestamp"`
        Type      string    `json:"type"`
        Source    string    `json:"source"`
        Host      string    `json:"host"`
        User      string    `json:"user,omitempty"`
        Process   *Process  `json:"process,omitempty"`
        File      *File     `json:"file,omitempty"`
        Network   *Network  `json:"network,omitempty"`
        Tags      []string  `json:"tags,omitempty"`

        // Enrichment is added by the engine, never by sensors, and never
        // mutates the raw evidence fields above.
        Enrichment map[string]string `json:"enrichment,omitempty"`
}

// Event types supported by the v0.1 schema.
const (
        TypeProcessCreate    = "process.create"
        TypeProcessTerminate = "process.terminate"
        TypeFileWrite        = "file.write"
        TypeNetworkConnect   = "network.connect"
        TypeImageLoad        = "image.load"
        TypeRegistrySet      = "registry.set"
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
