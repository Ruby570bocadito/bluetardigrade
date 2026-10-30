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
func TestStartSinksHandBackTheRunningSink(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	o := &options{elasticURL: "http://127.0.0.1:9", elasticIndex: "sf-alerts", splunkURL: "http://127.0.0.1:9"}
	es := startElastic(o, ctx, nil)
	sp := startSplunk(o, ctx, nil)
	cancel()
	if es == nil || sp == nil {
		t.Fatalf("configured sinks must reach the alert loop: elastic=%t splunk=%t", es != nil, sp != nil)
	}
	es.Wait()
	sp.Wait()
	if startElastic(&options{}, context.Background(), nil) != nil || startSplunk(&options{}, context.Background(), nil) != nil {
		t.Fatal("a sink without URL must stay off")
	}
}
