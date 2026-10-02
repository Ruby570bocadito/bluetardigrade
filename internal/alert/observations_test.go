package alert

import (
	"io"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestImportedObservationsDeduplicateReplaysWithoutCollapsingDistinctMail(t *testing.T) {
	var alerts []Alert
	manager := New(io.Discard, func(a Alert) { alerts = append(alerts, a) })
	ev := &model.Event{ID: "mail-1", Timestamp: time.Now(), Type: model.TypeEmailMessage, Source: "eml", Host: "MAIL", Attributes: map[string]string{"observer_host": "MAIL", "mail_subject": "Observed"}}
	hit := rules.Hit{Rule: &rules.Rule{ID: "soc-mail-ip-url", Name: "Mail", Severity: "medium"}}
	manager.Raise(ev, hit)
	manager.Raise(ev, hit)
	ev.ID = "mail-2"
	manager.Raise(ev, hit)
	if len(alerts) != 2 || alerts[0].Source != "eml" || alerts[0].Attributes["mail_subject"] != "Observed" {
		t.Fatal("replay/different mail identity was lost")
	}
}
