package store

import (
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestImportedObservationSearchAndRawRoundTrip(t *testing.T) {
	s := openTestStore(t)
	event := &model.Event{ID: "observation", Timestamp: time.Now().UTC(), Type: model.TypeNetworkAlert, Source: "suricata", Host: "LAB", Attributes: map[string]string{"ids_signature": "Señal observada", "ids_verdict": "drop"}, Network: &model.Network{Protocol: "TCP", SourceIP: "10.1.2.3", DestinationIP: "8.8.8.8", DestinationPort: 443}}
	if err := s.InsertEvent(event); err != nil {
		t.Fatal(err)
	}
	a := alert.Alert{ID: "0123456789abcdef", Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Source: event.Source, Attributes: event.Attributes, Network: event.Network}
	if err := s.InsertAlert(a); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{"Señal", "ids_verdict", "10.1.2.3", "443", "suricata"} {
		events, err := s.QueryEvents(EventQuery{Q: q, Limit: 10})
		if err != nil || len(events) != 1 || events[0].Attributes["ids_verdict"] != "drop" {
			t.Fatal("event observation search lost", q, err)
		}
		alerts, err := s.QueryAlerts(AlertQuery{Q: q, Limit: 10})
		if err != nil || len(alerts) != 1 || alerts[0].Source != "suricata" {
			t.Fatal("alert observation search lost", q, err)
		}
	}
	if alerts, err := s.QueryAlerts(AlertQuery{Q: "ids_verdict drop", Limit: 10}); err != nil || len(alerts) != 0 {
		t.Fatal("query matched across key/value boundary")
	}
}
