package api

import (
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestSourceObservationRingSearch(t *testing.T) {
	event := &model.Event{Source: "suricata", Attributes: map[string]string{"ids_signature": "Señal observada", "ids_verdict": "drop"}, Network: &model.Network{SourceIP: "10.1.2.3", DestinationPort: 443}}
	a := alert.Alert{Source: event.Source, Attributes: event.Attributes, Network: event.Network}
	for _, q := range []string{"señal", "ids_verdict", "10.1.2.3", "443", "suricata"} {
		if !eventHaystack(event, q) || !alertHaystack(a, q) {
			t.Fatal("ring did not search observation", q)
		}
	}
	if alertHaystack(a, "ids_verdict drop") || eventHaystack(event, "ids_verdict drop") {
		t.Fatal("ring crossed key/value boundary")
	}
}
