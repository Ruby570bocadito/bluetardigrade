package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

const alertSearchScanCap = 5000

type alertSearchPage struct {
	Items       []alertView `json:"items"`
	Source      string      `json:"source"`
	HasMore     bool        `json:"has_more"`
	NextCursor  string      `json:"next_cursor"`
	PageCursor  string      `json:"page_cursor"`
	Scanned     int         `json:"scanned"`
	ScanLimited bool        `json:"scan_limited"`
}

// Cursors are read-only positions, not credentials. They pin a source,
// engine lifetime, query and upper sequence. Changing filters starts a
// new search, and relative time bounds are frozen at the first page.
type alertSearchCursor struct {
	Version int       `json:"v"`
	Epoch   int64     `json:"e"`
	Source  string    `json:"s"`
	Query   string    `json:"q"`
	Fence   int64     `json:"f"`
	Before  int64     `json:"b"`
	Since   time.Time `json:"since"`
	Until   time.Time `json:"until"`
}

func searchFingerprint(r *http.Request) string {
	values := r.URL.Query()
	values.Del("cursor")
	values.Del("limit")
	sum := sha256.Sum256([]byte(values.Encode()))
	return hex.EncodeToString(sum[:])
}

func searchStatusMatches(status, filter string) bool {
	return filter == "" || filter == "all" || status == filter || (filter == "open" && status != "closed")
}

func (h *Hub) handleAlertSearch(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	fail := func(err error) {
		if ctx.Err() == context.DeadlineExceeded {
			writeErr(w, http.StatusGatewayTimeout, "search exceeded its time budget: narrow the filters and retry")
		} else if ctx.Err() == nil {
			h.storeQueryError(w, err)
		}
	}
	values := r.URL.Query()
	filterRequest := r
	var previous *alertSearchCursor
	if raw := values.Get("cursor"); raw != "" {
		if len(raw) > 1024 {
			writeErr(w, http.StatusBadRequest, "cursor exceeds its length limit")
			return
		}
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		previous = &alertSearchCursor{}
		if err != nil || json.Unmarshal(decoded, previous) != nil {
			writeErr(w, http.StatusBadRequest, "invalid cursor")
			return
		}
		// Resolve relative windows once, before validating the range again.
		// Otherwise a later page can move since beyond a fixed until.
		filterRequest = r.Clone(r.Context())
		urlCopy := *r.URL
		params := r.URL.Query()
		params.Del("since")
		params.Del("until")
		if !previous.Since.IsZero() {
			params.Set("since", previous.Since.Format(time.RFC3339Nano))
		}
		if !previous.Until.IsZero() {
			params.Set("until", previous.Until.Format(time.RFC3339Nano))
		}
		urlCopy.RawQuery = params.Encode()
		filterRequest.URL = &urlCopy
	}
	f, ok := parseRecordFilter(w, filterRequest)
	if !ok {
		return
	}
	limit := 25
	if raw := values.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			writeErr(w, http.StatusBadRequest, "limit must be an integer between 1 and 100")
			return
		}
		limit = n
	}
	state := values.Get("status")
	switch state {
	case "", "all", "open", "new", "acknowledged", "closed":
	default:
		writeErr(w, http.StatusBadRequest, "status must be all, open, new, acknowledged or closed")
		return
	}
	if utf8.RuneCountInString(f.q) > 120 || len(f.host) > 256 || len(f.ruleID) > 256 {
		writeErr(w, http.StatusBadRequest, "search text exceeds its limit (q: 120 characters; host/rule_id: 256 bytes)")
		return
	}
	h.mu.Lock()
	st := h.store
	ring := append([]alert.Alert(nil), h.alerts...)
	total := int64(h.alertsTotal)
	h.mu.Unlock()
	source := "memory"
	if st != nil {
		source = "sqlite"
	}
	cursor := alertSearchCursor{Version: 1, Epoch: h.started.UnixNano(), Source: source, Query: searchFingerprint(r), Since: f.since, Until: f.until}
	if previous != nil {
		if previous.Version != 1 || previous.Epoch != cursor.Epoch || previous.Source != source || previous.Query != cursor.Query ||
			previous.Fence < 0 || previous.Before < 0 || previous.Before > previous.Fence {
			writeErr(w, http.StatusBadRequest, "invalid or expired cursor: restart the search after changing filters or restarting the engine")
			return
		}
		cursor = *previous
	} else {
		cursor.Fence = total
		if st != nil {
			var err error
			cursor.Fence, err = st.MaxAlertSequence(r.Context())
			if err != nil {
				fail(err)
				return
			}
		}
	}
	load := func(before int64, size int) ([]store.AlertRecord, error) {
		if st != nil {
			return st.QueryAlertPage(r.Context(), store.AlertQuery{
				Host: f.host, Severities: f.sevs, RuleID: f.ruleID, Q: f.q,
				Since: f.since, Until: f.until, Limit: size,
			}, before, cursor.Fence)
		}
		rows := []store.AlertRecord{}
		for i := len(ring) - 1; i >= 0 && len(rows) < size; i-- {
			seq := total - int64(len(ring)) + int64(i) + 1
			a := ring[i]
			if seq > cursor.Fence || (before > 0 && seq >= before) {
				continue
			}
			if ts, valid := f.alertTime(a); valid && f.matchAlert(a, ts) {
				rows = append(rows, store.AlertRecord{Seq: seq, Alert: a})
			}
		}
		return rows, nil
	}
	page := alertSearchPage{Items: []alertView{}, Source: source}
	current, _ := json.Marshal(cursor)
	page.PageCursor = base64.RawURLEncoding.EncodeToString(current)
	before, lastResult := cursor.Before, int64(0)
	for {
		if r.Context().Err() != nil {
			fail(r.Context().Err())
			return
		}
		size := min(256, alertSearchScanCap-page.Scanned+1)
		rows, err := load(before, size)
		if err != nil {
			fail(err)
			return
		}
		for _, row := range rows {
			if page.Scanned == alertSearchScanCap {
				page.HasMore, page.ScanLimited = true, true
				break
			}
			page.Scanned++
			view := h.withLifecycle(row.Alert)
			if searchStatusMatches(view.Status, state) {
				if len(page.Items) == limit {
					page.HasMore = true
					before = lastResult // preserve the lookahead for the next page
					break
				}
				page.Items = append(page.Items, view)
				lastResult = row.Seq
			}
			before = row.Seq
		}
		if page.HasMore || len(rows) < size {
			break
		}
	}
	if page.HasMore {
		cursor.Before = before
		encoded, _ := json.Marshal(cursor)
		page.NextCursor = base64.RawURLEncoding.EncodeToString(encoded)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, page)
}
