package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
)

func TestQueryAlertPageStableInsertionOrderAndCancellation(t *testing.T) {
	s := openTestStore(t)
	for _, a := range []alert.Alert{
		{ID: "old", Host: "LAB", Severity: "high", Timestamp: time.Now().Format(time.RFC3339Nano)},
		{ID: "late", Host: "LAB", Severity: "high", Timestamp: "2020-01-01T00:00:00Z"},
	} {
		if err := s.InsertAlert(a); err != nil {
			t.Fatal(err)
		}
	}
	fence, err := s.MaxAlertSequence(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.InsertAlert(alert.Alert{ID: "new", Host: "LAB", Timestamp: time.Now().Format(time.RFC3339Nano)}); err != nil {
		t.Fatal(err)
	}
	rows, err := s.QueryAlertPage(context.Background(), AlertQuery{Host: "lab", Limit: 1}, 0, fence)
	if err != nil || len(rows) != 1 || rows[0].Alert.ID != "late" {
		t.Fatalf("page: %+v %v", rows, err)
	}
	rows, err = s.QueryAlertPage(context.Background(), AlertQuery{Limit: 1}, rows[0].Seq, fence)
	if err != nil || len(rows) != 1 || rows[0].Alert.ID != "old" {
		t.Fatalf("next: %+v %v", rows, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = s.QueryAlertPage(ctx, AlertQuery{Limit: 1}, 0, fence)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled request retained connection: %v", err)
	}
}
