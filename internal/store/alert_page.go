package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
)

// AlertRecord carries the insertion sequence used for stable pagination.
// Timestamps remain evidence; late arrivals and equal timestamps never
// shift already visited pages. The existing list/export order is unchanged.
type AlertRecord struct {
	Seq   int64
	Alert alert.Alert
}

// MaxAlertSequence pins the first page against later insertions.
func (s *Store) MaxAlertSequence(ctx context.Context) (int64, error) {
	var seq int64
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(seq), 0) FROM alerts`).Scan(&seq)
	return seq, err
}

// QueryAlertPage seeks by sequence instead of skipping an OFFSET that
// changes underneath a live collector. A canceled HTTP request releases
// the database connection; every query and row count stays bounded.
func (s *Store) QueryAlertPage(ctx context.Context, q AlertQuery, before, fence int64) ([]AlertRecord, error) {
	where, args := alertWhere(q)
	if where == "" {
		where = "WHERE "
	} else {
		where += " AND "
	}
	where += `seq <= ?`
	args = append(args, fence)
	if before > 0 {
		where += ` AND seq < ?`
		args = append(args, before)
	}
	args = append(args, clampLimit(q.Limit))
	rows, err := s.db.QueryContext(ctx, `SELECT seq, json FROM alerts `+where+` ORDER BY seq DESC LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("store: query alert page: %w", err)
	}
	defer rows.Close()
	out := []AlertRecord{}
	for rows.Next() {
		var row AlertRecord
		var payload string
		if err := rows.Scan(&row.Seq, &payload); err != nil {
			return nil, fmt.Errorf("store: scan alert page: %w", err)
		}
		if err := json.Unmarshal([]byte(payload), &row.Alert); err != nil {
			return nil, fmt.Errorf("store: decode alert page: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
