// POST /api/db/query — read-only SQL console over the -store SQLite
// database (M-4, TODO.md F3). The evidence is append-only; this surface
// only reads it, with hard row and time budgets per query and an audit
// row for every attempt (ok, rejected or error) written through the
// store's writer handle.
//
// Arming and gates: the surface exists for administrators, and the
// engine has no role model yet — arming IS the admin gate, so it stays
// off unless the operator starts the engine with -api-db-query (or
// SF_API_DB_QUERY=1), it requires -store (no database, no console) and
// the same no-token-beyond-loopback rule as the write surface applies
// at startup. Behind it, the request passes the guardSQL scanner and
// runs on the store's dedicated mode=ro handle: two software layers
// plus one that is SQLite itself must all agree before a row moves.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

const (
	dbQueryDefaultRows = 500
	dbQueryMaxRows     = 5000
	// time budget per query: the default is generous for an indexed
	// scan of the evidence tables and the ceiling keeps a runaway
	// query from pinning a reader connection for minutes
	dbQueryDefaultTimeoutMS = 10_000
	dbQueryMinTimeoutMS     = 100
	dbQueryMaxTimeoutMS     = 30_000
	// body cap: the statement itself is capped by the guard at 32 KiB,
	// the JSON envelope has room for nothing else
	dbQueryBodyCap = 64 << 10
	// statement text kept per audit row
	dbQueryAuditTextCap = 4096
)

type dbQueryRequest struct {
	SQL       string `json:"sql"`
	MaxRows   int    `json:"max_rows"`
	TimeoutMS int    `json:"timeout_ms"`
}

type dbQueryReply struct {
	Columns    []string `json:"columns"`
	Rows       [][]any  `json:"rows"`
	RowCount   int      `json:"row_count"`
	Truncated  bool     `json:"truncated"`
	DurationMS int64    `json:"duration_ms"`
}

// EnableDBQuery arms POST /api/db/query. Opt-in like the write surface;
// call before Run (only the startup path in cmd/engine arms it).
func (h *Hub) EnableDBQuery() {
	h.mu.Lock()
	h.dbQueryArmed = true
	h.mu.Unlock()
}

func (h *Hub) handleDBQuery(w http.ResponseWriter, r *http.Request) {
	if !h.dbQueryArmed {
		writeErr(w, http.StatusForbidden, "the SQL query surface is disabled: restart the engine with -api-db-query (or SF_API_DB_QUERY=1) to allow database queries")
		return
	}
	if h.store == nil {
		writeErr(w, http.StatusNotImplemented, "the engine runs without -store: there is no database to query")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, dbQueryBodyCap)
	var req dbQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "body must be JSON {\"sql\": string, \"max_rows\"?: int, \"timeout_ms\"?: int}")
		return
	}
	statement, err := guardSQL(req.SQL)
	if err != nil {
		h.auditDBQuery(r, req.SQL, "rejected", 0, 0, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	timeoutMS := req.TimeoutMS
	if timeoutMS <= 0 {
		timeoutMS = dbQueryDefaultTimeoutMS
	} else if timeoutMS < dbQueryMinTimeoutMS {
		timeoutMS = dbQueryMinTimeoutMS
	} else if timeoutMS > dbQueryMaxTimeoutMS {
		timeoutMS = dbQueryMaxTimeoutMS
	}
	maxRows := req.MaxRows
	if maxRows <= 0 {
		maxRows = dbQueryDefaultRows
	} else if maxRows > dbQueryMaxRows {
		maxRows = dbQueryMaxRows
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutMS)*time.Millisecond)
	defer cancel()
	start := time.Now()
	cols, rows, truncated, err := h.store.QueryRO(ctx, statement, maxRows)
	ms := time.Since(start).Milliseconds()
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil {
			h.auditDBQuery(r, statement, "error", 0, ms, "timeout")
			writeErr(w, http.StatusRequestTimeout, "query exceeded its time budget: add filters, narrow the range or raise timeout_ms (max 30000)")
			return
		}
		h.auditDBQuery(r, statement, "error", 0, ms, oneLine(err.Error()))
		writeErr(w, http.StatusBadRequest, "query failed: "+oneLine(err.Error()))
		return
	}
	h.auditDBQuery(r, statement, "ok", len(rows), ms, "")
	writeJSON(w, dbQueryReply{
		Columns:    cols,
		Rows:       rows,
		RowCount:   len(rows),
		Truncated:  truncated,
		DurationMS: ms,
	})
}

// auditDBQuery records one attempt. Rejections and failures are audited
// like successes — the trail answers "who ran what" including attempts.
// The statement text is trimmed to the audit cap; a store that cannot
// take the row is a log line, never a reason to fail a query that
// already ran.
func (h *Hub) auditDBQuery(r *http.Request, statement, status string, rows int, ms int64, failure string) {
	st := h.store
	if st == nil {
		return
	}
	if len(statement) > dbQueryAuditTextCap {
		statement = statement[:dbQueryAuditTextCap]
	}
	err := st.RecordQueryAudit(store.QueryAuditRow{
		TS:         time.Now().UTC(),
		Remote:     remoteIP(r.RemoteAddr),
		SQL:        statement,
		Status:     status,
		Rows:       rows,
		DurationMS: ms,
		Error:      failure,
	})
	if err != nil {
		log.Printf("[API] db query audit write failed: %v", err)
	}
}
