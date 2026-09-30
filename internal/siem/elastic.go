// Elasticsearch sink: alerts are indexed through the Bulk API with a
// deterministic document id (the alert ID), so a retry after an
// ambiguous transport failure overwrites the same document instead of
// duplicating it. Documents land in a daily index —
// <prefix>-YYYY.MM.DD (UTC) — following the operator's retention
// convention instead of a single ever-growing index.
//
// The bulk endpoint answers 200 even when individual items fail, so
// the response body is always parsed: accepted items count as sent,
// permanent item failures (4xx) count as failed immediately, and
// retryable ones (429, 5xx) are retried alone — a whole batch is never
// re-sent when the cluster already indexed part of it.

package siem

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
)

const (
	// Batch size cap: one bulk request carries at most this many
	// alerts, bounding both the request body and the blast radius of
	// a failed attempt.
	elasticMaxBatch = 64
	// A partially filled batch is flushed after this window, so a
	// quiet stream never sits undelivered behind the batching.
	elasticFlushEvery = time.Second
	// Hard timeout for each individual bulk POST.
	elasticPostTimeout = 5 * time.Second
	// Default index prefix (overridable by flag).
	elasticDefaultIndex = "sf-alerts"
)

// Elastic delivers alerts to an Elasticsearch cluster through _bulk.
type Elastic struct {
	spool
	url       string // base cluster URL, e.g. http://127.0.0.1:9200
	index     string // index prefix, e.g. sf-alerts
	apiKey    string // empty = no Authorization header
	hc        *http.Client
	backoff   time.Duration
	flushEver time.Duration
	maxBatch  int
}

// NewElastic creates a sink for the cluster at url with the default
// queue depth, batch cap and flush window.
func NewElastic(url, index string) *Elastic {
	return newElastic(url, index, queueSize)
}

func newElastic(url, index string, queue int) *Elastic {
	requireHTTPScheme("elasticsearch", url)
	if index == "" {
		index = elasticDefaultIndex
	}
	return &Elastic{
		spool:     newSpool(queue),
		url:       trimTrailingSlash(url),
		index:     index,
		hc:        &http.Client{Timeout: elasticPostTimeout},
		backoff:   400 * time.Millisecond,
		flushEver: elasticFlushEvery,
		maxBatch:  elasticMaxBatch,
	}
}

// SetAPIKey configures Elasticsearch API-key auth ("Authorization:
// ApiKey <base64>"), the credential type Elasticsearch 8 recommends.
// Call before Run. An empty key disables the header (an unsecured
// loopback cluster, e.g. a local lab node).
func (e *Elastic) SetAPIKey(key string) { e.apiKey = key }

// APIKeyConfigured reports whether bulk requests carry credentials.
func (e *Elastic) APIKeyConfigured() bool { return e.apiKey != "" }

// Endpoint returns the target cluster URL (diagnostics and logs).
func (e *Elastic) Endpoint() string { return e.url }

// Stats returns the lifetime counters: alerts indexed, alerts that
// exhausted retries or were rejected, and alerts dropped for a full
// queue.
func (e *Elastic) Stats() (sent, failed, dropped uint64) { return e.stats() }

// Handle enqueues one alert without blocking (see spool.handle).
func (e *Elastic) Handle(a alert.Alert) { e.handle(a) }

// Run batches queued alerts and bulk-indexes them until ctx is
// cancelled, then drains the pending queue best-effort (single attempt
// per alert) so a graceful shutdown loses as little as possible.
func (e *Elastic) Run(ctx context.Context) {
	e.worker.Add(1)
	defer e.worker.Done()
	ticker := time.NewTicker(e.flushEver)
	defer ticker.Stop()
	var batch []alert.Alert
	flush := func() {
		if len(batch) == 0 {
			return
		}
		e.deliverBatch(ctx, batch)
		batch = batch[:0]
	}
	for {
		select {
		case <-ctx.Done():
			// Everything still queued gets one best-effort attempt,
			// newest-first in queue order, under the drain deadline.
			e.drain(func(a alert.Alert) { e.deliverBatch(ctx, []alert.Alert{a}) })
			flush()
			return
		case a := <-e.queue:
			batch = append(batch, a)
			if len(batch) >= e.maxBatch {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

// Wait blocks until the worker goroutine (started by Run) has finished.
func (e *Elastic) Wait() { e.worker.Wait() }

// deliverBatch indexes one batch with up to maxAttempts tries. The
// pending slice shrinks across attempts: only the items the cluster
// did not accept (transport failure, 429/5xx HTTP, or retryable item
// status) come back for the next try.
func (e *Elastic) deliverBatch(ctx context.Context, batch []alert.Alert) {
	pending := batch
	for attempt := 1; attempt <= maxAttempts && len(pending) > 0; attempt++ {
		accepted, retryable, rejected, perr := e.postBatch(pending)
		e.sent.Add(uint64(accepted))
		e.failed.Add(uint64(rejected))
		if perr == nil && len(retryable) == 0 {
			return
		}
		if perr != nil {
			log.Printf("[ELASTIC] bulk to %s failed (attempt %d/%d): %v",
				EndpointLabel(e.url), attempt, maxAttempts, redactedErr(perr))
		}
		pending = retryable
		if len(pending) == 0 {
			return // nothing retryable: skip the backoff sleep the loop would waste
		}
		if attempt == maxAttempts {
			break
		}
		if !waitFor(ctx, retryAfter(e.backoff, attempt)) {
			e.failed.Add(uint64(len(pending)))
			return
		}
	}
	e.failed.Add(uint64(len(pending)))
}

// postBatch performs one bulk attempt. It returns how many alerts the
// cluster accepted, how many were rejected permanently (counted as
// failed, never retried), and the subset that may be retried
// (transport failure: the whole batch; item-level failure: only those
// items).
func (e *Elastic) postBatch(batch []alert.Alert) (accepted int, retryable []alert.Alert, rejected int, err error) {
	var buf bytes.Buffer
	wire := batch[:0:0] // fresh slice, same element type
	for _, a := range batch {
		meta, merr := json.Marshal(map[string]any{
			"index": map[string]string{
				"_index": e.indexName(a),
				"_id":    a.ID,
			},
		})
		doc, derr := json.Marshal(a)
		if merr != nil || derr != nil {
			// An unencodable alert must not desync the batch (the
			// bulk answer has one item per WIRE line); it counts as
			// failed before the request leaves.
			rejected++
			continue
		}
		buf.Write(meta)
		buf.WriteByte('\n')
		buf.Write(doc)
		buf.WriteByte('\n')
		wire = append(wire, a)
	}
	if len(wire) == 0 {
		return 0, nil, rejected, fmt.Errorf("no encodable alerts in batch of %d", len(batch))
	}
	batch = wire

	req, rerr := http.NewRequest(http.MethodPost, e.url+"/_bulk", bytes.NewReader(buf.Bytes()))
	if rerr != nil {
		return 0, nil, len(batch), rerr // build error: permanent (notify parity), never retried
	}
	req.Header.Set("Content-Type", "application/x-ndjson")
	req.Header.Set("User-Agent", userAgent)
	if e.apiKey != "" {
		req.Header.Set("Authorization", "ApiKey "+e.apiKey)
	}
	resp, herr := e.hc.Do(req)
	if herr != nil {
		return 0, batch, rejected, herr // transport error: the cluster may recover
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusTooManyRequests, resp.StatusCode >= 500:
		return 0, batch, rejected, fmt.Errorf("cluster answered %d", resp.StatusCode)
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return e.parseBulkResponse(resp, batch)
	default:
		// non-429 4xx is a permanent rejection (bad API key, mapping,
		// index template): the declared contract is 4xx failed-for-good
		// and the Splunk sink treats them the same way. The whole batch
		// counts as failed in ONE pass - no retry budget burned on a
		// misconfiguration.
		return 0, nil, len(batch), fmt.Errorf("cluster answered %d", resp.StatusCode)
	}
}

// bulkResponse models the subset of the _bulk answer the sink needs.
type bulkResponse struct {
	Errors bool `json:"errors"`
	Items  []struct {
		Index struct {
			Status int `json:"status"`
			Error  *struct {
				Type   string `json:"type"`
				Reason string `json:"reason"`
			} `json:"error"`
		} `json:"index"`
	} `json:"items"`
}

// parseBulkResponse splits a 200 answer into accepted and retryable
// alerts. A missing/malformed body is treated conservatively: the
// whole batch comes back as retryable, because the cluster state is
// unknown and re-indexing by _id is idempotent.
func (e *Elastic) parseBulkResponse(resp *http.Response, batch []alert.Alert) (accepted int, retryable []alert.Alert, rejected int, err error) {
	var parsed bulkResponse
	if derr := json.NewDecoder(resp.Body).Decode(&parsed); derr != nil {
		return 0, batch, 0, fmt.Errorf("unreadable bulk answer: %w", derr)
	}
	if len(parsed.Items) != len(batch) {
		return 0, batch, 0, fmt.Errorf("bulk answer reports %d items for a batch of %d", len(parsed.Items), len(batch))
	}
	if !parsed.Errors {
		return len(batch), nil, 0, nil
	}
	retried := 0
	for i, item := range parsed.Items {
		switch {
		case item.Index.Status >= 200 && item.Index.Status < 300:
			accepted++
		case item.Index.Status == http.StatusTooManyRequests || item.Index.Status >= 500:
			retryable = append(retryable, batch[i])
			retried++
		default:
			rejected++
			reason := "rejected"
			if item.Index.Error != nil {
				reason = fmt.Sprintf("%s: %s", item.Index.Error.Type, item.Index.Error.Reason)
			}
			log.Printf("[ELASTIC] alert %s not indexed (status %d, %s)", batch[i].ID, item.Index.Status, reason)
		}
	}
	if retried > 0 {
		log.Printf("[ELASTIC] %d of %d alerts in the last bulk are retryable", retried, len(batch))
	}
	return accepted, retryable, rejected, nil
}

// indexName resolves the daily index an alert belongs to
// (<prefix>-YYYY.MM.DD, UTC). An unparsable timestamp falls back to
// today: an alert must never be dropped by the indexer over metadata.
func (e *Elastic) indexName(a alert.Alert) string {
	day := time.Now().UTC()
	if t, perr := time.Parse(time.RFC3339Nano, a.Timestamp); perr == nil {
		day = t.UTC()
	}
	return fmt.Sprintf("%s-%s", e.index, day.Format("2006.01.02"))
}

func trimTrailingSlash(url string) string {
	for len(url) > 0 && url[len(url)-1] == '/' {
		url = url[:len(url)-1]
	}
	return url
}
