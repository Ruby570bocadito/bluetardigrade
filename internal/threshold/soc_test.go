package threshold

import (
	"fmt"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestSOCBurstGroupsKeepFinalObservedContext(t *testing.T) {
	d, err := LoadFile("../../thresholds.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var emitted []alert.Alert
	d.SetEmit(func(a alert.Alert) { emitted = append(emitted, a) })
	for i := 0; i < 20; i++ {
		for _, ip := range []string{"10.0.0.1", "10.0.0.2"} {
			ts := t0.Add(time.Duration(i) * time.Second)
			d.Observe(&model.Event{ID: fmt.Sprintf("%s-%d", ip, i), Timestamp: ts, Type: model.TypeHoneypotLogin, Source: "cowrie", Host: "HONEY", Network: &model.Network{SourceIP: ip}, Attributes: map[string]string{"honeypot_event": "cowrie.login.failed", "observer_host": "HONEY", "honeypot_session": fmt.Sprint(i)}}, ts)
		}
	}
	if len(emitted) != 2 || emitted[0].Network.SourceIP == emitted[1].Network.SourceIP || emitted[0].Source != "cowrie" || emitted[0].Attributes["honeypot_session"] != "19" {
		t.Fatalf("burst context/grouping lost: %+v", emitted)
	}
}
