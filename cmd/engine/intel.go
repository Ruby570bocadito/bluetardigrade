package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/baseline"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// noveltyRuleID identifies the baseline's own detection, so it can be
// suppressed per host or process like any rule.
const noveltyRuleID = "baseline-new-process"

// intelRulePrefix + list name identifies a threat-intel hit, so a noisy
// list can be suppressed on its own.
const intelRulePrefix = "intel-match-"

var intelKindTags = map[string][]string{
	intel.KindIP:     {"attack.command-and-control"},
	intel.KindNet:    {"attack.command-and-control"},
	intel.KindDomain: {"attack.command-and-control", "attack.t1071"},
	intel.KindHash:   {"attack.execution"},
}

var intelKindLabel = map[string]string{
	intel.KindIP:     "IP",
	intel.KindNet:    "Rango",
	intel.KindDomain: "Dominio",
	intel.KindHash:   "Hash",
}

// intelAlert describes an event that carries an indicator listed in one
// of the operator's offline intel files.
func intelAlert(ev *model.Event, hit intel.Hit, now time.Time) alert.Alert {
	tags := append([]string{}, intelKindTags[hit.Kind]...)
	tags = append(tags, "intel")
	label := intelKindLabel[hit.Kind]
	if label == "" {
		label = "Indicador"
	}
	what := ev.Type
	if ev.Process != nil && ev.Process.Name != "" {
		what = ev.Process.Name
	}
	where := hit.Field
	if ev.Network != nil && strings.EqualFold(ev.Network.Protocol, "dns") {
		// on a DNS event the address is an answer and the domain the
		// question, not a connection
		switch hit.Field {
		case "network.destination_ip":
			where = "respuesta DNS"
		case "network.domain":
			where = "consulta DNS"
		}
	}
	a := alert.Alert{
		Timestamp:  now.UTC().Format(time.RFC3339Nano),
		RuleID:     intelRulePrefix + hit.List,
		RuleName:   "Indicador de amenaza conocido",
		Severity:   "high",
		Host:       ev.Host,
		User:       ev.User,
		EventID:    ev.ID,
		EventType:  ev.Type,
		Source:     ev.Source,
		Attributes: ev.Attributes,
		Network:    ev.Network,
		Summary: fmt.Sprintf("%s %s de la lista «%s» en %s (%s, %s)",
			label, hit.Value, hit.List, ev.Host, where, what),
		MatchedOn: []string{hit.Field},
		Tags:      tags,
		Enrich:    ev.Enrichment,
	}
	if alert.EventIsSimulated(ev) {
		alert.MarkSimulated(&a)
	}
	return a
}

// noveltyAlert describes a process a host never ran during or since its
// baseline learning period.
func noveltyAlert(ev *model.Event, n *baseline.Novelty, now time.Time) alert.Alert {
	where := ""
	enrich := ev.Enrichment
	if ev.Process != nil && ev.Process.Image != "" {
		where = " (" + ev.Process.Image + ")"
	}
	if ev.Process != nil {
		if sum := ev.Process.Hashes["sha256"]; sum != "" {
			// a copy: the event's own map is shared with the rings
			enrich = make(map[string]string, len(ev.Enrichment)+1)
			for k, v := range ev.Enrichment {
				enrich[k] = v
			}
			enrich["image_sha256"] = strings.ToLower(sum)
		}
	}
	a := alert.Alert{
		Timestamp:  now.UTC().Format(time.RFC3339Nano),
		RuleID:     noveltyRuleID,
		RuleName:   "Proceso nunca visto en este equipo",
		Severity:   "low",
		Host:       ev.Host,
		User:       ev.User,
		EventID:    ev.ID,
		EventType:  ev.Type,
		Source:     ev.Source,
		Attributes: ev.Attributes,
		Summary: fmt.Sprintf("%s ejecuta %s%s por primera vez: no está en su línea base, aprendida desde %s",
			ev.Host, n.Value, where, n.LearnedOn.UTC().Format("2006-01-02 15:04 UTC")),
		MatchedOn: []string{"process.name"},
		Tags:      []string{"attack.execution", "baseline"},
		Enrich:    enrich,
	}
	if alert.EventIsSimulated(ev) {
		alert.MarkSimulated(&a)
	}
	return a
}
