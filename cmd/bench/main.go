// bench is an honest load and latency harness for the detection engine.
//
// It connects to the engine ingest (NDJSON over TCP, optional AUTH
// handshake), streams process.create events that deterministically fire
// one seeded rule (powershell.exe with an encoded command), and listens
// on the engine SSE stream (/api/stream) for the resulting alerts. The
// latency of every event is measured on the same clock: from the moment
// the NDJSON line leaves the client to the moment the matching alert
// frame arrives on SSE. That includes the full pipeline — ingest parse,
// rule evaluation, alert build, hub broadcast — plus the SSE hop, which
// is exactly what the console experiences.
//
// Inputs are generated benchmark events; pipeline delivery and timing are real.
// If the engine deduplicates, drops or rejects,
// the report says so and the exit code is non-zero. Dedup is avoided by
// construction (unique PID per event, unique host per run; the dedup
// key is rule|host|pid and the engine keeps it for a 60 s TTL — a fixed
// host would make every re-run against a live engine a silent no-op).
//
// Usage (start an engine first, see README "Rendimiento"):
//
//	go run ./cmd/bench -addr 127.0.0.1:7777 -api 127.0.0.1:7778 -n 2000
//
// Flags allow the ingest token (-token), the API bearer token
// (-api-token, for engines started with -api-token; falls back to
// SF_API_TOKEN), a rate cap in events/s (-rate, default 1000;
// 0 = unlimited) and the wait budget after the last send (-wait).
//
// Delivery semantics, reported honestly: the pipeline completeness is
// judged against alerts the engine PRODUCED (alerts_total delta on
// /api/stats), the measured latencies against alerts the bench actually
// received on SSE. The SSE fan-out is best-effort by design (slow
// subscribers miss frames instead of stalling the engine), so a bench
// client that cannot keep up under an unlimited burst reports the gap
// as fan-out misses instead of pretending the pipeline lost alerts.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:7777", "engine ingest TCP address")
	api := flag.String("api", "127.0.0.1:7778", "engine HTTP API (for /api/stream and /api/stats)")
	token := flag.String("token", "", "ingest token (send 'AUTH <token>' first; falls back to SF_INGEST_TOKEN)")
	apiToken := flag.String("api-token", "", "bearer token for the engine HTTP API, mirrors -api-token on the engine (falls back to SF_API_TOKEN)")
	n := flag.Int("n", 2000, "number of events to send")
	rate := flag.Float64("rate", 1000, "events per second cap (0 = as fast as possible)")
	wait := flag.Duration("wait", 10*time.Second, "max wait after the last send for pending alerts")
	flag.Parse()

	if *n <= 0 {
		fmt.Fprintln(os.Stderr, "bench: -n must be > 0")
		os.Exit(2)
	}
	shared := *token
	if shared == "" {
		shared = os.Getenv("SF_INGEST_TOKEN")
	}
	apiBearer := *apiToken
	if apiBearer == "" {
		apiBearer = os.Getenv("SF_API_TOKEN")
	}
	// Per-run host: the engine deduplicates alerts on rule|host|pid for
	// a 60 s TTL, so re-running the bench against a live engine with a
	// fixed host would silently swallow alerts (first symptom: the
	// warmup delivery proof times out). A unique host per run keeps
	// every dedup key fresh; within a run, the unique PID per event
	// does the same job.
	host := fmt.Sprintf("bench-host-%d", time.Now().UnixNano()%1_000_000_000)

	conn, err := net.Dial("tcp", *addr)
	fatalIf(err, "dial ingest")
	defer conn.Close()

	scanner := bufio.NewScanner(conn)
	if shared != "" {
		fmt.Fprintf(conn, "AUTH %s\n", shared)
		if !scanner.Scan() {
			fmt.Fprintln(os.Stderr, "bench: closed during AUTH handshake")
			os.Exit(1)
		}
		var ack struct {
			Ack string `json:"ack"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &ack); err != nil || ack.Ack != "ok" {
			fmt.Fprintf(os.Stderr, "bench: AUTH rejected: %s\n", strings.TrimSpace(scanner.Text()))
			os.Exit(1)
		}
		fmt.Println("auth: ok")
	}

	// outstanding[eventID] = time the line was handed to the socket
	outstanding := sync.Map{}
	latencies := make([]time.Duration, 0, *n)
	var mu sync.Mutex
	unmatched := 0 // alerts that did not correspond to a bench event
	sent := 0
	var writeErr error

	// Collector: subscribe to the engine SSE stream FIRST, and signal
	// the moment the subscription is actually registered (the /api/stream
	// handler registers the subscriber before answering), so the warmup
	// alert cannot race the collector.
	subscribed := make(chan struct{})
	collectDone := make(chan struct{})
	go func() {
		defer close(collectDone)
		resp, err := httpGet("http://"+*api+"/api/stream", apiBearer)
		if err != nil {
			fmt.Fprintln(os.Stderr, "bench: SSE connect failed:", err)
			os.Exit(1)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			fmt.Fprintf(os.Stderr,
				"bench: /api/stream answered %d — is the engine running with -api-token? pass -api-token or SF_API_TOKEN\n",
				resp.StatusCode)
			os.Exit(1)
		}
		close(subscribed)
		parseSSE(resp.Body, func(topic, data string) {
			if topic != "alert" {
				return
			}
			var a struct {
				EventID string `json:"event_id"`
			}
			if json.Unmarshal([]byte(data), &a) != nil || a.EventID == "" {
				return
			}
			if v, ok := outstanding.LoadAndDelete(a.EventID); ok {
				t0 := v.(time.Time)
				if t0.IsZero() {
					return // warmup alert: delivery proof, no latency sample
				}
				lat := time.Since(t0)
				mu.Lock()
				latencies = append(latencies, lat)
				mu.Unlock()
				return
			}
			mu.Lock()
			unmatched++
			mu.Unlock()
		})
	}()

	// Warmup: one unmeasured event before the measured run. It proves
	// the SSE delivery path end to end (its alert must delete its own
	// outstanding entry) and pre-warms first-alert allocations.
	warm := benchEvent(-1, host)
	wline, _ := json.Marshal(warm)
	select {
	case <-subscribed:
	case <-time.After(5 * time.Second):
		fmt.Fprintln(os.Stderr, "bench: SSE subscription timed out")
		os.Exit(1)
	}
	// zero timestamp: the warmup alert proves the delivery path but is
	// never counted as a latency sample. Stored BEFORE the write: the
	// entry must exist before any frame can exist (no races).
	outstanding.Store(warm["id"], time.Time{})
	if _, err := fmt.Fprintf(conn, "%s\n", wline); err != nil {
		fatalIf(err, "warmup write")
	}
	warmOK := false
	for i := 0; i < 100; i++ {
		time.Sleep(50 * time.Millisecond)
		if _, ok := outstanding.Load(warm["id"]); !ok {
			warmOK = true
			break
		}
	}
	if !warmOK {
		fmt.Fprintln(os.Stderr, "bench: warmup alert never arrived on SSE (delivery path broken); aborting")
		os.Exit(1)
	}

	// completeness baseline AFTER the warmup: the delta below measures
	// exactly the alerts produced by the measured run
	alertsBefore := alertsTotal(*api, apiBearer)

	fmt.Printf("sending %d events to %s (rate cap: %s)...\n", *n, *addr, rateLabel(*rate))
	interval := time.Duration(0)
	if *rate > 0 {
		interval = time.Duration(float64(time.Second) / *rate)
	}
	start := time.Now()
	var lastWrite time.Time
	for i := 0; i < *n; i++ {
		ev := benchEvent(i, host)
		t0 := time.Now()
		line, _ := json.Marshal(ev)
		// store BEFORE the write: the entry exists before its alert can
		// possibly exist, so no frame can ever race its own entry
		outstanding.Store(ev["id"], t0)
		if _, err := fmt.Fprintf(conn, "%s\n", line); err != nil {
			outstanding.Delete(ev["id"])
			writeErr = err
			break
		}
		mu.Lock()
		sent++
		mu.Unlock()
		lastWrite = t0
		if interval > 0 && i < *n-1 {
			time.Sleep(interval)
		}
	}
	pace := time.Since(start)
	fmt.Printf("sent in %s (%.0f ev/s)\n", pace.Round(time.Millisecond), float64(sent)/pace.Seconds())

	// wait for the outstanding alerts (poll; exit early when empty)
	deadline := time.Now().Add(*wait)
	var pendingAt time.Duration
	for time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
		left := 0
		outstanding.Range(func(_, _ any) bool { left++; return true })
		if left == 0 {
			break
		}
	}
	pendingAt = time.Since(lastWrite)
	mu.Lock()
	matched := len(latencies)
	mu.Unlock()

	var statsMap map[string]any
	if resp, err := httpGet("http://"+*api+"/api/stats", apiBearer); err == nil {
		if resp.StatusCode == http.StatusOK {
			_ = json.NewDecoder(resp.Body).Decode(&statsMap)
		}
		resp.Body.Close()
	}
	produced := 0
	if after := alertsTotal(*api, apiBearer); after > alertsBefore {
		produced = after - alertsBefore
	}

	report := os.Stdout
	if produced != sent {
		report = os.Stderr
	}
	fmt.Fprintf(report, "\n--- bench report ---\n")
	fmt.Fprintf(report, "sent              : %d\n", sent)
	fmt.Fprintf(report, "alerts produced   : %d (engine alerts_total delta)\n", produced)
	fmt.Fprintf(report, "latency samples   : %d\n", matched)
	if produced > matched {
		fmt.Fprintf(report, "fan-out misses    : %d (SSE backpressure by design; alerts were still logged/delivered)\n", produced-matched)
	}
	mu.Lock()
	if unmatched > 0 {
		fmt.Fprintf(report, "unmatched alerts  : %d (not from this run)\n", unmatched)
	}
	mu.Unlock()
	if writeErr != nil {
		fmt.Fprintf(report, "write error       : %v (run aborted early)\n", writeErr)
	}
	if matched > 0 {
		mu.Lock()
		ls := append([]time.Duration(nil), latencies...)
		mu.Unlock()
		sort.Slice(ls, func(i, j int) bool { return ls[i] < ls[j] })
		pct := func(p float64) time.Duration { return ls[int(float64(len(ls)-1)*p)] }
		var sum time.Duration
		for _, d := range ls {
			sum += d
		}
		fmt.Fprintf(report, "latency p50       : %s\n", pct(0.50).Round(time.Microsecond))
		fmt.Fprintf(report, "latency p90       : %s\n", pct(0.90).Round(time.Microsecond))
		fmt.Fprintf(report, "latency p99       : %s\n", pct(0.99).Round(time.Microsecond))
		fmt.Fprintf(report, "latency max       : %s\n", ls[len(ls)-1].Round(time.Microsecond))
		fmt.Fprintf(report, "latency mean      : %s\n", (sum / time.Duration(len(ls))).Round(time.Microsecond))
	}
	fmt.Fprintf(report, "pacing wait       : %s (budget after last send)\n", pendingAt.Round(time.Millisecond))
	if ev, ok := statsMap["events_total"].(float64); ok {
		fmt.Fprintf(report, "engine ingested   : %.0f\n", ev)
	}
	if d, ok := statsMap["dropped"].(float64); ok && d > 0 {
		fmt.Fprintf(report, "engine dropped    : %.0f (malformed lines)\n", d)
	}
	if produced != sent {
		fmt.Fprintf(report, "RESULT: FAIL (%d alerts produced for %d events sent)\n", produced, sent)
		os.Exit(1)
	}
	fmt.Println("RESULT: OK — every event produced exactly one alert")
}

func rateLabel(r float64) string {
	if r <= 0 {
		return "unlimited"
	}
	return fmt.Sprintf("%.0f ev/s", r)
}

// alertsTotal reads alerts_total from the engine stats (0 when the API
// is unreachable or answers non-200: the completeness criterion then
// stays pessimistic, produced==0 != sent, and the run reports FAIL).
func alertsTotal(api, token string) int {
	resp, err := httpGet("http://"+api+"/api/stats", token)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0
	}
	var s struct {
		AlertsTotal int `json:"alerts_total"`
	}
	if json.NewDecoder(resp.Body).Decode(&s) != nil {
		return 0
	}
	return s.AlertsTotal
}

// httpGet issues a GET with the optional API bearer credential.
func httpGet(url, token string) (*http.Response, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return http.DefaultClient.Do(req)
}

// benchEvent builds a process.create event that deterministically fires
// the powershell_encoded rule (process.name eq powershell.exe AND
// command_line contains -enc). Unique id + unique pid defeat the alert
// dedup (key rule|host|pid); the per-run host keeps keys fresh across
// runs (see the comment at the top of main).
func benchEvent(i int, host string) map[string]any {
	return map[string]any{
		"id":        fmt.Sprintf("bench-%d-%d", time.Now().UnixNano(), i),
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"type":      "process.create",
		"source":    "bench",
		"host":      host,
		"user":      "bench",
		"process": map[string]any{
			"pid":          100 + i,
			"ppid":         4,
			"name":         "powershell.exe",
			"command_line": fmt.Sprintf("powershell.exe -nop -w hidden -enc QQBiAGMAIABiAGUAbgBjAGgAIAAtAGkA %d", i),
			"image":        `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
		},
	}
}

// parseSSE reads a text/event-stream body and calls fn per complete frame.
func parseSSE(body io.Reader, fn func(topic, data string)) {
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	topic := ""
	data := strings.Builder{}
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			topic = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data.WriteString(strings.TrimPrefix(line, "data: "))
		case line == "":
			if topic != "" && data.Len() > 0 {
				fn(topic, data.String())
			}
			topic = ""
			data.Reset()
		}
	}
}

func fatalIf(err error, what string) {
	if err != nil {
		fmt.Fprintf(os.Stderr, "bench: %s: %v\n", what, err)
		os.Exit(1)
	}
}
