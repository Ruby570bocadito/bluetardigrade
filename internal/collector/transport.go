package collector

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// TransportConfig describes a verified ingest connection. Tokens are supplied
// by the caller's environment, never by a command-line flag.
type TransportConfig struct {
	Addr   string
	Token  string
	TLS    bool
	CAFile string
}

// Transport sends observed NDJSON. A successful write is not an engine
// processing acknowledgement; uncertain sends are never automatically replayed.
type Transport struct {
	config    TransportConfig
	tls       *tls.Config
	conn      net.Conn
	lastWrite time.Time
}

// NewTransport rejects unauthenticated or unencrypted remote ingest.
func NewTransport(config TransportConfig) (*Transport, error) {
	host, port, err := net.SplitHostPort(config.Addr)
	if err != nil || host == "" {
		return nil, errors.New("ingest addr must be host:port")
	}
	p, err := strconv.Atoi(port)
	if err != nil || p < 1 || p > 65535 {
		return nil, errors.New("invalid ingest port")
	}
	if len(config.Token) > 8192 {
		return nil, errors.New("ingest token exceeds supported limit")
	}
	for _, r := range config.Token {
		if r < 33 || r > 126 {
			return nil, errors.New("ingest token must be printable ASCII without spaces")
		}
	}
	if config.CAFile != "" {
		config.TLS = true
	}
	ip := net.ParseIP(host)
	loopback := strings.EqualFold(host, "localhost") || (ip != nil && ip.IsLoopback())
	if !loopback && (!config.TLS || config.Token == "") {
		return nil, errors.New("remote ingest requires verified TLS and SF_INGEST_TOKEN")
	}
	t := &Transport{config: config}
	if config.TLS {
		t.tls = &tls.Config{MinVersion: tls.VersionTLS12, ServerName: host}
		if config.CAFile != "" {
			file, err := os.Open(config.CAFile)
			if err != nil {
				return nil, errors.New("cannot open ingest CA file")
			}
			pem, readErr := readBounded(file, 1<<20)
			_ = file.Close()
			if readErr != nil {
				return nil, errors.New("invalid ingest CA file size")
			}
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM(pem) {
				return nil, errors.New("invalid PEM ingest CA file")
			}
			t.tls.RootCAs = pool
		}
	}
	return t, nil
}

func (t *Transport) connect(ctx context.Context) error {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var conn net.Conn
	var err error
	if t.tls != nil {
		conn, err = (&tls.Dialer{NetDialer: dialer, Config: t.tls}).DialContext(ctx, "tcp", t.config.Addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", t.config.Addr)
	}
	if err != nil {
		return errors.New("cannot establish verified ingest connection")
	}
	t.conn = conn
	if t.config.Token != "" {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
		if _, err := fmt.Fprintf(conn, "AUTH %s\n", t.config.Token); err != nil {
			_ = t.Close()
			return errors.New("ingest authentication write failed")
		}
		scanner := bufio.NewScanner(conn)
		scanner.Buffer(make([]byte, 1024), 4096)
		var ack struct {
			Ack string `json:"ack"`
		}
		if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &ack) != nil || ack.Ack != "ok" {
			_ = t.Close()
			return errors.New("ingest authentication rejected or timed out")
		}
		_ = conn.SetDeadline(time.Time{})
	}
	return nil
}

// Send writes one record with a deadline. On a partial/error write, processing
// is unknown and the caller must stop; this method does not silently retry.
func (t *Transport) Send(ctx context.Context, ev *model.Event) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if ev == nil {
		return errors.New("cannot send nil event")
	}
	raw, err := ev.Encode()
	if err != nil {
		return err
	}
	if len(raw)+1 > MaxLine {
		return errors.New("normalized event exceeds ingest record limit")
	}
	if t.conn != nil && time.Since(t.lastWrite) > 4*time.Minute {
		_ = t.Close()
	}
	if t.conn == nil {
		if err := t.connect(ctx); err != nil {
			return err
		}
	}
	_ = t.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	line := append(raw, '\n')
	written, err := t.conn.Write(line)
	if err != nil || written != len(line) {
		_ = t.Close()
		return errors.New("ingest write failed; processing unknown, record not replayed")
	}
	t.lastWrite = time.Now()
	return nil
}

// Close releases the connection. The next Send establishes a new one.
func (t *Transport) Close() error {
	if t.conn == nil {
		return nil
	}
	conn := t.conn
	t.conn = nil
	return conn.Close()
}
