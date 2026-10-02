package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestCollectorOfflineOutputAndMalformedInput(t *testing.T) {
	var output, diagnostics bytes.Buffer
	input := strings.NewReader("{\"event_type\":\"dns\"}\n{\"timestamp\":\"2026-10-02T10:00:00Z\",\"event_type\":\"flow\",\"src_ip\":\"10.0.0.1\",\"dest_ip\":\"8.8.8.8\",\"proto\":\"TCP\"}\n")
	if err := run(context.Background(), options{source: "suricata", observer: "LAB", stdout: true}, input, &output, &diagnostics); err != nil {
		t.Fatal(err)
	}
	var event model.Event
	if json.Unmarshal(bytes.TrimSpace(output.Bytes()), &event) != nil || event.Source != "suricata" || event.Attributes["observer_host"] != "LAB" {
		t.Fatal("normalization output is not pure JSONL")
	}
	if !strings.Contains(diagnostics.String(), "1 records written, 1 ignored") {
		t.Fatal("incorrect source counters")
	}
	output.Reset()
	err := run(context.Background(), options{source: "suricata", observer: "LAB", stdout: true}, strings.NewReader("invalid fixture-password\n"), &output, &diagnostics)
	if err == nil || strings.Contains(err.Error(), "fixture-password") || output.Len() != 0 {
		t.Fatal("malformed input accepted or exposed")
	}
}

func TestCollectorCancellationUnblocksInputPipe(t *testing.T) {
	reader, writer := io.Pipe()
	defer writer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- run(ctx, options{source: "suricata", observer: "LAB", stdout: true}, reader, io.Discard, io.Discard)
	}()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal("cancellation lost", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("collector stayed blocked on pipe after cancellation")
	}
}
