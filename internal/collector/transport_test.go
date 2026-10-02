package collector

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestTransportAuthenticatedWireAndRefusedConfiguration(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	observed := make(chan string, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			observed <- "accept failed"
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		scan := bufio.NewScanner(conn)
		if !scan.Scan() || scan.Text() != "AUTH fixture-token" {
			observed <- "bad auth"
			return
		}
		_, _ = conn.Write([]byte("{\"ack\":\"ok\"}\n"))
		if scan.Scan() {
			observed <- scan.Text()
		} else {
			observed <- "no event"
		}
	}()
	transport, err := NewTransport(TransportConfig{Addr: listener.Addr().String(), Token: "fixture-token"})
	if err != nil {
		t.Fatal(err)
	}
	defer transport.Close()
	ev := &model.Event{ID: "wire", Type: model.TypeHostQuery, Source: "osquery", Host: "LAB", Timestamp: time.Now(), Attributes: map[string]string{"query_name": "observed"}}
	if err := transport.Send(context.Background(), ev); err != nil {
		t.Fatal(err)
	}
	select {
	case line := <-observed:
		var received model.Event
		if json.Unmarshal([]byte(line), &received) != nil || received.Attributes["query_name"] != "observed" {
			t.Fatal("wire lost observation", line)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("wire timeout")
	}
	for _, config := range []TransportConfig{{Addr: "remote.example:7777"}, {Addr: "remote.example:7777", TLS: true}, {Addr: "127.0.0.1:0"}, {Addr: "localhost:7777", Token: "bad\nAUTH"}} {
		if _, err := NewTransport(config); err == nil {
			t.Fatal("unsafe config accepted")
		}
	}
}

func TestTransportVerifiedTLSAndUntrustedCertificate(t *testing.T) {
	seed := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	certificate := seed.TLS.Certificates[0]
	parsed := seed.Certificate()
	seed.Close()
	ca := filepath.Join(t.TempDir(), "fixture-ca.pem")
	if err := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: parsed.Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	for _, trusted := range []bool{false, true} {
		t.Run(map[bool]string{false: "untrusted", true: "trusted"}[trusted], func(t *testing.T) {
			listener, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			result := make(chan string, 1)
			go func() {
				conn, err := listener.Accept()
				if err != nil {
					result <- ""
					return
				}
				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
				scan := bufio.NewScanner(conn)
				if !scan.Scan() {
					result <- ""
					return
				}
				auth := scan.Text()
				_, _ = conn.Write([]byte("{\"ack\":\"ok\"}\n"))
				if scan.Scan() {
					result <- auth + " " + scan.Text()
				} else {
					result <- auth
				}
			}()
			config := TransportConfig{Addr: listener.Addr().String(), Token: "fixture-token", TLS: true}
			if trusted {
				config.CAFile = ca
			}
			transport, err := NewTransport(config)
			if err != nil {
				t.Fatal(err)
			}
			defer transport.Close()
			err = transport.Send(context.Background(), &model.Event{ID: "tls", Type: model.TypeHostQuery, Timestamp: time.Now()})
			line := <-result
			if trusted {
				if err != nil || !strings.Contains(line, "AUTH fixture-token") || !strings.Contains(line, "\"id\":\"tls\"") {
					t.Fatal("verified TLS delivery failed", err)
				}
			} else if err == nil || line != "" {
				t.Fatal("untrusted TLS received credentials or event")
			}
		})
	}
}

type partialConnection struct {
	writes int
	closed bool
}

func (c *partialConnection) Read([]byte) (int, error) { return 0, errors.New("read unavailable") }
func (c *partialConnection) Write(p []byte) (int, error) {
	c.writes++
	return len(p) / 2, errors.New("partial write")
}
func (c *partialConnection) Close() error                   { c.closed = true; return nil }
func (*partialConnection) LocalAddr() net.Addr              { return &net.TCPAddr{} }
func (*partialConnection) RemoteAddr() net.Addr             { return &net.TCPAddr{} }
func (*partialConnection) SetDeadline(time.Time) error      { return nil }
func (*partialConnection) SetReadDeadline(time.Time) error  { return nil }
func (*partialConnection) SetWriteDeadline(time.Time) error { return nil }

func TestTransportDoesNotReplayUncertainWrite(t *testing.T) {
	conn := &partialConnection{}
	transport := &Transport{conn: conn, lastWrite: time.Now()}
	err := transport.Send(context.Background(), &model.Event{ID: "partial", Type: model.TypeHostQuery, Timestamp: time.Now()})
	if err == nil || !strings.Contains(err.Error(), "processing unknown") || conn.writes != 1 || !conn.closed || transport.conn != nil {
		t.Fatal("uncertain delivery was retried or concealed")
	}
}

func TestTransportRejectedAuthNeverSendsEvidenceOrEchoesServerBody(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	done := make(chan bool, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			done <- false
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
		scanner := bufio.NewScanner(conn)
		if !scanner.Scan() {
			done <- false
			return
		}
		_, _ = conn.Write([]byte("{\"ack\":\"error\",\"message\":\"fixture-token\"}\n"))
		done <- scanner.Scan()
	}()
	transport, err := NewTransport(TransportConfig{Addr: listener.Addr().String(), Token: "fixture-token"})
	if err != nil {
		t.Fatal(err)
	}
	defer transport.Close()
	err = transport.Send(context.Background(), &model.Event{ID: "must-not-send", Type: model.TypeHostQuery, Timestamp: time.Now()})
	if err == nil || strings.Contains(err.Error(), "fixture-token") || <-done {
		t.Fatal("rejected authentication leaked token or sent evidence")
	}
}
