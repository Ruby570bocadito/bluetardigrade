package main

import (
	"context"
	"testing"
)

// TestStartSinksHandBackTheRunningSink pins the 088eaaa regression: a
// ':=' inside the if shadowed the returned variable, so startElastic and
// startSplunk returned nil while their workers ran. The alert loop only
// hands alerts to a non-nil sink, so nothing was ever delivered and the
// stats sat at 0 sent / 0 failed / 0 dropped.
//
// The workers are only cancelled, never waited for: Run registers itself
// on the sink's WaitGroup from inside its own goroutine, so a Wait issued
// right after the start races that first Add under -race (the siem tests
// follow the same discipline).
func TestStartSinksHandBackTheRunningSink(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	o := &options{elasticURL: "http://127.0.0.1:9", elasticIndex: "sf-alerts", splunkURL: "http://127.0.0.1:9"}
	es := startElastic(o, ctx, nil)
	sp := startSplunk(o, ctx, nil)
	if es == nil || sp == nil {
		t.Fatalf("configured sinks must reach the alert loop: elastic=%t splunk=%t", es != nil, sp != nil)
	}
	if startElastic(&options{}, context.Background(), nil) != nil || startSplunk(&options{}, context.Background(), nil) != nil {
		t.Fatal("a sink without URL must stay off")
	}
}
