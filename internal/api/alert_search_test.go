package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

func searchAlert(n int) alert.Alert {
	a := alertAt("historical", "high", "LAB", time.Now().UTC())
	a.ID = fmt.Sprintf("%016x", n)
	return a
}

func TestAlertSearchPagesStayPinned(t *testing.T) {
	for _, persisted := range []bool{false, true} {
		t.Run(fmt.Sprintf("sqlite=%t", persisted), func(t *testing.T) {
			h, addr := newTestHub(t)
			if persisted {
				st, err := store.Open(t.TempDir() + "/history.db")
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = st.Close() })
				h.SetStore(st)
			}
			for i := 1; i <= 5; i++ {
				a := searchAlert(i)
				a.Timestamp = "2026-09-01T00:00:00Z" // ties are not page boundaries
				h.RecordAlert(a)
			}
			base := "http://" + addr + "/api/alerts/search?limit=2"
			var first, second, previous, last alertSearchPage
			getJSON(t, base, &first)
			if len(first.Items) != 2 || first.Items[0].ID != searchAlert(5).ID || !first.HasMore || first.PageCursor == "" {
				t.Fatalf("first page: %+v", first)
			}
			late := searchAlert(6)
			late.Timestamp = "2020-01-01T00:00:00Z"
			h.RecordAlert(late)
			getJSON(t, base+"&cursor="+url.QueryEscape(first.NextCursor), &second)
			getJSON(t, base+"&cursor="+url.QueryEscape(first.PageCursor), &previous)
			getJSON(t, base+"&cursor="+url.QueryEscape(second.NextCursor), &last)
			if len(second.Items) != 2 || second.Items[0].ID != searchAlert(3).ID || second.Items[1].ID != searchAlert(2).ID {
				t.Fatalf("second shifted: %+v", second)
			}
			if previous.Items[0].ID != first.Items[0].ID || len(last.Items) != 1 || last.Items[0].ID != searchAlert(1).ID || last.HasMore {
				t.Fatalf("pinned/back/last: previous=%+v last=%+v", previous, last)
			}
			var fresh alertSearchPage
			getJSON(t, base, &fresh)
			if fresh.Items[0].ID != late.ID {
				t.Fatal("new search must include late arrival")
			}
		})
	}
}

func TestAlertSearchLifecycleFiltersBeforeLimit(t *testing.T) {
	h, addr := newTestHub(t)
	for i := 1; i <= 5; i++ {
		h.RecordAlert(searchAlert(i))
	}
	for _, i := range []int{5, 4, 2} {
		if _, err := h.lifecycle.Set(searchAlert(i).ID, lifecycle.StatusClosed, "", "reviewed", "operator"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.lifecycle.Set(searchAlert(3).ID, lifecycle.StatusAcknowledged, "", "picked up", "operator"); err != nil {
		t.Fatal(err)
	}
	base := "http://" + addr + "/api/alerts/search?limit=1&status=open&severity=high&q=historical"
	var first, second alertSearchPage
	getJSON(t, base, &first)
	getJSON(t, base+"&cursor="+url.QueryEscape(first.NextCursor), &second)
	if len(first.Items) != 1 || first.Items[0].ID != searchAlert(3).ID || first.Items[0].StatusNote != "picked up" || !first.HasMore {
		t.Fatalf("lifecycle filter must precede limit: %+v", first)
	}
	if len(second.Items) != 1 || second.Items[0].ID != searchAlert(1).ID || second.HasMore {
		t.Fatalf("second open: %+v", second)
	}
	var closed alertSearchPage
	getJSON(t, "http://"+addr+"/api/alerts/search?status=closed", &closed)
	if len(closed.Items) != 3 {
		t.Fatalf("closed count: %d", len(closed.Items))
	}
}

func TestAlertSearchRejectsBadAndExpiredQueries(t *testing.T) {
	h, addr := newTestHub(t)
	h.RecordAlert(searchAlert(1))
	base := "http://" + addr + "/api/alerts/search"
	for _, query := range []string{"limit=0", "limit=101", "limit=oops", "status=wrong", "cursor=bad!", "cursor=" + strings.Repeat("x", 1025), "q=" + strings.Repeat("x", 121), "severity=wrong", "since=wrong"} {
		res, _ := fetchBody(t, base+"?"+query)
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: %d", query[:min(60, len(query))], res.StatusCode)
		}
	}
	var first alertSearchPage
	getJSON(t, base, &first)
	res, _ := fetchBody(t, base+"?status=closed&cursor="+url.QueryEscape(first.PageCursor))
	if res.StatusCode != 400 {
		t.Fatal("cursor accepted changed filters")
	}
	_, other := newTestHub(t)
	res, _ = fetchBody(t, "http://"+other+"/api/alerts/search?cursor="+url.QueryEscape(first.PageCursor))
	if res.StatusCode != 400 {
		t.Fatal("cursor accepted another engine lifetime")
	}
}

func TestAlertSearchSQLiteHistoryAndScanContinuation(t *testing.T) {
	st, err := store.Open(t.TempDir() + "/large.db")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	h, addr := newTestHub(t)
	h.SetStore(st)
	for i := 1; i <= alertSearchScanCap+1; i++ {
		h.RecordAlert(searchAlert(i))
	}
	if _, err := h.lifecycle.Set(searchAlert(1).ID, lifecycle.StatusClosed, "", "outside ring", "operator"); err != nil {
		t.Fatal(err)
	}
	base := "http://" + addr + "/api/alerts/search?status=closed"
	var first, continuation alertSearchPage
	getJSON(t, base, &first)
	if len(first.Items) != 0 || !first.ScanLimited || !first.HasMore || first.Scanned != alertSearchScanCap || first.Source != "sqlite" {
		t.Fatalf("bounded scan must have an honest continuation: %+v", first)
	}
	getJSON(t, base+"&cursor="+url.QueryEscape(first.NextCursor), &continuation)
	if len(continuation.Items) != 1 || continuation.Items[0].ID != searchAlert(1).ID || continuation.HasMore {
		t.Fatalf("history outside ring lost: %+v", continuation)
	}
}

func TestAlertSearchRequiresConfiguredToken(t *testing.T) {
	h, err := New("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	h.SetToken("test-secret")
	go func() { _ = h.Run() }()
	t.Cleanup(h.Shutdown)
	res, _ := fetchBody(t, "http://"+h.Addr()+"/api/alerts/search")
	if res.StatusCode != 401 {
		t.Fatalf("search bypassed auth: %d", res.StatusCode)
	}
}

func TestAlertSearchFreezesRelativeTimeBounds(t *testing.T) {
	_, addr := newTestHub(t)
	base := "http://" + addr + "/api/alerts/search?since=2h&until=1h"
	var first, revisited alertSearchPage
	getJSON(t, base, &first)
	getJSON(t, base+"&cursor="+url.QueryEscape(first.PageCursor), &revisited)
	decode := func(raw string) alertSearchCursor {
		t.Helper()
		b, err := base64.RawURLEncoding.DecodeString(raw)
		if err != nil {
			t.Fatal(err)
		}
		var cursor alertSearchCursor
		if err := json.Unmarshal(b, &cursor); err != nil {
			t.Fatal(err)
		}
		return cursor
	}
	a, b := decode(first.PageCursor), decode(revisited.PageCursor)
	if !a.Since.Equal(b.Since) || !a.Until.Equal(b.Until) {
		t.Fatal("relative window moved on revisit")
	}
}

// TestAlertSearchFindsByID pins the free-text axis on the alert id
// itself (symmetric with events): an id pasted from a handoff link
// must find its record whether it lives in the ring or the store. A
// forged field separator in the needle must never cross the id into
// another field.
func TestAlertSearchFindsByID(t *testing.T) {
	for _, persisted := range []bool{false, true} {
		t.Run(fmt.Sprintf("sqlite=%t", persisted), func(t *testing.T) {
			h, addr := newTestHub(t)
			if persisted {
				st, err := store.Open(t.TempDir() + "/history.db")
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = st.Close() })
				h.SetStore(st)
			}
			target := searchAlert(7)
			target.Timestamp = "2026-09-01T00:00:00Z"
			h.RecordAlert(target)
			h.RecordAlert(searchAlert(8))

			var page alertSearchPage
			getJSON(t, "http://"+addr+"/api/alerts/search?q="+target.ID, &page)
			if len(page.Items) != 1 || page.Items[0].ID != target.ID {
				t.Fatalf("id search: got %d items, want exactly %s", len(page.Items), target.ID)
			}
			// partial id: the arnes range shares the leading zeros, so the
			// distinctive half is the piece an operator can actually disambiguate
			getJSON(t, "http://"+addr+"/api/alerts/search?q="+target.ID[8:], &page)
			if len(page.Items) != 1 || page.Items[0].ID != target.ID {
				t.Fatalf("partial id search: got %d items, want exactly %s", len(page.Items), target.ID)
			}
			// a needle carrying a raw field separator cannot forge a
			// crossing between the id and any other field
			getJSON(t, "http://"+addr+"/api/alerts/search?q="+url.QueryEscape(target.ID+"\x1fLAB"), &page)
			if len(page.Items) != 0 {
				t.Fatalf("forged separator matched: %d items", len(page.Items))
			}
		})
	}
}
