package alert

// Integración del scrubber (sesión 100agentes-3, agente 49): el
// summary viaja enmascarado a TODOS los consumidores y el EVENTO CRUDO
// queda byte-idéntico (la evidencia de SQLite events no se reescribe).

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func scrubEvent() *model.Event {
	return &model.Event{
		ID:        "ev-sec",
		Timestamp: time.Now().UTC(),
		Type:      model.TypeProcessCreate,
		Host:      "LAB-SEC",
		User:      "alice",
		Process:   &model.Process{PID: 7, Name: "powershell.exe", CommandLine: "powershell -c password=Hunter2!NombreLargo"},
		Attributes: map[string]string{
			"observer_host": "lab-sec",
			"column_cmd":    "connstring=Server=db;Password=S3cretPassword123;",
		},
	}
}

func scrubHit() rules.Hit {
	return rules.Hit{Rule: &rules.Rule{ID: "r-sec", Name: "n", Severity: rules.SevLow, EventType: model.TypeProcessCreate}}
}

func TestRaiseScrubsSummaryAndKeepsRawEventIntact(t *testing.T) {
	var jsonBuf bytes.Buffer
	var raised []Alert
	m := New(&jsonBuf, func(a Alert) { raised = append(raised, a) })
	m.SetSecretScrubber(func(a *Alert) { ScrubWith(redact.ModeTail4, a) })

	ev := scrubEvent()
	raw, _ := json.Marshal(ev)
	var snapshot model.Event
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatal(err)
	}

	m.Raise(ev, scrubHit())
	if len(raised) != 1 {
		t.Fatalf("raised=%d", len(raised))
	}
	s := raised[0].Summary
	if !strings.Contains(s, "password=[REDACTED#kv_secret#") {
		t.Fatalf("summary without tail4 mask: %q", s)
	}
	if strings.Contains(s, "Hunter2!NombreLargo") {
		t.Fatalf("secret leaked in summary: %q", s)
	}
	if line := jsonBuf.String(); strings.Contains(line, "Hunter2!NombreLargo") || !strings.Contains(line, "[REDACTED#kv_secret#") {
		t.Fatalf("json log leaked or unmasked: %s", line)
	}
	// el atributo del EVENTO con forma de secreto se clona y enmascara
	// en la ALERTA, y el mapa ORIGINAL del evento queda intacto
	if raised[0].Attributes["column_cmd"] == ev.Attributes["column_cmd"] {
		t.Fatalf("alert attribute was not scrubbed: %q", raised[0].Attributes["column_cmd"])
	}
	if !strings.Contains(ev.Attributes["column_cmd"], "S3cretPassword123") {
		t.Fatalf("raw event attribute mutated: %q", ev.Attributes["column_cmd"])
	}
	// ANTI-MUTACIÓN: el evento de entrada NO cambia (mapas incluidos)
	if !reflect.DeepEqual(ev, &snapshot) {
		t.Fatalf("raw event mutated:\n got %+v\n want %+v", ev, &snapshot)
	}
	if !strings.Contains(string(raw), "Hunter2!NombreLargo") {
		t.Fatal("degenerate fixture: the raw event never carried the secret")
	}
}

func TestRaiseWithoutScrubberKeepsRawSummary(t *testing.T) {
	var jsonBuf bytes.Buffer
	var raised []Alert
	m := New(&jsonBuf, func(a Alert) { raised = append(raised, a) })
	m.Raise(scrubEvent(), scrubHit())
	if len(raised) != 1 || !strings.Contains(raised[0].Summary, "password=Hunter2!NombreLargo") {
		t.Fatalf("nil scrubber must keep raw evidence (documented laboratory mode): %q", raised[0].Summary)
	}
}

func TestEmitIsScrubbedToo(t *testing.T) {
	var jsonBuf bytes.Buffer
	var raised []Alert
	m := New(&jsonBuf, func(a Alert) { raised = append(raised, a) })
	m.SetSecretScrubber(func(a *Alert) { ScrubWith(redact.ModeTail4, a) })
	m.Emit(Alert{Summary: "token ghp_16C7e42F292c6912E7710c838347Ae178B4a", RuleID: "agg", RuleName: "agg", Severity: "high"})
	if len(raised) != 1 {
		t.Fatal("no alert emitted")
	}
	if strings.Contains(raised[0].Summary, "16C7e42F") {
		t.Fatalf("Emit path leaked the token: %q", raised[0].Summary)
	}
	if !strings.Contains(raised[0].Summary, "[REDACTED#github_token#8B4a]") {
		t.Fatalf("Emit summary without mask: %q", raised[0].Summary)
	}
}
