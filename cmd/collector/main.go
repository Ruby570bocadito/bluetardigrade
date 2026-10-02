// Command collector imports supported SOC logs and offline mail evidence into
// the actual engine ingest, or emits normalized JSONL for inspection.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/collector"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

type options struct {
	source, file, observer, addr, ca, zone string
	tls, stdout                            bool
}

func main() {
	host, _ := os.Hostname()
	var opts options
	flag.StringVar(&opts.source, "source", "", "suricata, zeek (JSON conn), osquery, cowrie, windows-firewall or eml")
	flag.StringVar(&opts.file, "file", "-", "input file once; '-' reads stdin (use an external follower for rotation)")
	flag.StringVar(&opts.observer, "observer", host, "source observer identity, used to attribute imported evidence")
	flag.StringVar(&opts.addr, "addr", "127.0.0.1:7777", "engine ingest host:port; auth via SF_INGEST_TOKEN")
	flag.BoolVar(&opts.tls, "tls", false, "verified TLS ingest (required with token for remote hosts)")
	flag.StringVar(&opts.ca, "tls-ca", "", "PEM CA for verified TLS ingest")
	flag.StringVar(&opts.zone, "firewall-timezone", "", "IANA timezone of source host when firewall uses Local")
	flag.BoolVar(&opts.stdout, "stdout", false, "offline normalization to JSONL; no network connection")
	flag.Parse()
	if flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "collector: unexpected positional arguments")
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, opts, os.Stdin, os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "collector:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, opts options, input io.Reader, output, diagnostics io.Writer) error {
	decoder, err := collector.NewDecoder(opts.source, opts.observer)
	if err != nil {
		return err
	}
	if opts.zone != "" {
		if err := decoder.SetFirewallTimezone(opts.zone); err != nil {
			return err
		}
	}
	if opts.file != "" && opts.file != "-" {
		file, err := os.Open(opts.file)
		if err != nil {
			return errors.New("cannot open collector input file")
		}
		defer file.Close()
		input = file
	}
	finished := make(chan struct{})
	defer close(finished)
	if closer, ok := input.(io.Closer); ok {
		go func() {
			select {
			case <-ctx.Done():
				_ = closer.Close()
			case <-finished:
			}
		}()
	}
	var transport *collector.Transport
	if !opts.stdout {
		transport, err = collector.NewTransport(collector.TransportConfig{Addr: opts.addr, Token: os.Getenv("SF_INGEST_TOKEN"), TLS: opts.tls, CAFile: opts.ca})
		if err != nil {
			return err
		}
		defer transport.Close()
	}
	accepted, ignored := 0, 0
	emit := func(ev *model.Event) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if opts.stdout {
			raw, err := ev.Encode()
			if err != nil {
				return err
			}
			if _, err = fmt.Fprintln(output, string(raw)); err != nil {
				return err
			}
		} else {
			if err := transport.Send(ctx, ev); err != nil {
				return err
			}
		}
		accepted++
		return nil
	}
	if opts.source == "eml" {
		raw, err := io.ReadAll(io.LimitReader(input, collector.MaxMail+1))
		if err != nil {
			return errors.New("cannot read EML input")
		}
		ev, err := decoder.DecodeMail(raw, time.Now())
		if err != nil {
			return err
		}
		if err := emit(ev); err != nil {
			return err
		}
	} else {
		scanner := bufio.NewScanner(input)
		scanner.Buffer(make([]byte, 64<<10), collector.MaxLine)
		line := 0
		for scanner.Scan() {
			line++
			if len(scanner.Bytes()) == 0 {
				ignored++
				continue
			}
			ev, err := decoder.Decode(scanner.Bytes())
			if errors.Is(err, collector.ErrIgnored) {
				ignored++
				continue
			}
			if err != nil {
				return fmt.Errorf("line %d: %w", line, err)
			}
			if err := emit(ev); err != nil {
				return fmt.Errorf("line %d: %w", line, err)
			}
			if accepted%1000 == 0 {
				fmt.Fprintf(diagnostics, "collector: %d records written, %d ignored\n", accepted, ignored)
			}
		}
		if err := scanner.Err(); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return errors.New("input read failed or record exceeded 1 MiB")
		}
	}
	fmt.Fprintf(diagnostics, "collector: %d records written, %d ignored (transport writes are not processing acknowledgements)\n", accepted, ignored)
	return nil
}
