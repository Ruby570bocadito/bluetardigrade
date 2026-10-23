package main

// run_outbound.go starts the outbound delivery connectors: the SIEM/
// SOAR webhook, the external notification channels (C2) and the
// Elasticsearch/Splunk sinks. All of them are async, bounded and
// never stall the detection loop. Extracted from runEngine (POL-1);
// bodies are the original ones, behavior unchanged — the notify error
// path keeps its "cancel the webhook worker, then stop the engine"
// contract at the caller.

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/Ruby570bocadito/bluetardigrade/internal/api"
	"github.com/Ruby570bocadito/bluetardigrade/internal/notify"
	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
	"github.com/Ruby570bocadito/bluetardigrade/internal/siem"
	"github.com/Ruby570bocadito/bluetardigrade/internal/webhook"
)

// startWebhook launches the outbound alert connector (alerts POSTed
// as JSON) when -webhook is set; nil otherwise.
func startWebhook(o *options, whCtx context.Context, hub *api.Hub) *webhook.Client {
	// outbound connector: alerts POSTed as JSON to a SIEM/SOAR
	// endpoint; delivery is async, bounded and never blocks the loop
	var wh *webhook.Client
	if o.webhookURL != "" {
		wh = webhook.New(o.webhookURL)
		// outbound auth: flag wins over the env var, mirroring the
		// ingest token resolution order
		whToken := o.webhookToken
		if whToken == "" {
			whToken = os.Getenv("SF_WEBHOOK_TOKEN")
		}
		wh.SetToken(whToken)
		go wh.Run(whCtx)
		if hub != nil {
			hub.SetWebhookStats(wh.Stats)
		}
		if wh.TokenConfigured() {
			fmt.Printf("[ENGINE] webhook on %s (alerts POSTed as JSON, Authorization: Bearer enabled)\n", redact.EndpointLabel(o.webhookURL))
		} else {
			fmt.Printf("[ENGINE] webhook on %s (alerts POSTed as JSON, no auth header - set -webhook-token or SF_WEBHOOK_TOKEN)\n", redact.EndpointLabel(o.webhookURL))
		}
	}
	return wh
}

// startNotify launches the external notification channels (chat,
// mail and ntfy push) when -notify is set. A file that does not exist
// yet is no channels: the console creates it from Ajustes ->
// Notificaciones and the engine swaps the channels in without a
// restart (notify.Live). An existing file that cannot be honored
// exactly still stops the engine here, because a channel that silently
// never fires is a silent control. The returned error must make the
// caller cancel the webhook worker and stop the engine.
func startNotify(o *options, whCtx context.Context, hub *api.Hub) (*notify.Live, error) {
	if o.notifyPath == "" {
		return nil, nil
	}
	svc, err := notify.LoadOptional(o.notifyPath)
	if err != nil {
		// Same contract as every config surface: name the problem in
		// the log (legacyMain exits 1 silently), then stop the engine.
		log.Printf("[ENGINE] notify config rejected: %v", err)
		return nil, err
	}
	nt := notify.NewLive(whCtx, svc)
	if hub != nil {
		hub.SetNotifyStats(nt.Stats)
		hub.SetNotifySettings(o.notifyPath, nt)
	}
	if len(nt.Summary()) == 0 {
		fmt.Printf("[ENGINE] notify: no channels yet in %s (Ajustes -> Avisos externos creates them)\n", o.notifyPath)
	} else {
		fmt.Printf("[ENGINE] notify: %d channel(s): %s\n", len(nt.Summary()), strings.Join(nt.Summary(), ", "))
	}
	return nt, nil
}

// startElastic launches the Elasticsearch sink (alerts bulk-indexed,
// daily index, deterministic _id) when -elastic is set; nil otherwise.
func startElastic(o *options, sinkCtx context.Context, hub *api.Hub) *siem.Elastic {
	var elasticSink *siem.Elastic
	if o.elasticURL != "" {
		elasticSink, err := siem.NewElastic(o.elasticURL, o.elasticIndex)
		if err != nil {
			log.Fatalf("[ENGINE] %v", err)
		}
		// credential resolution: flag wins over the environment,
		// mirroring the ingest and webhook token order
		elasticKey := o.elasticAPIKey
		if elasticKey == "" {
			elasticKey = os.Getenv("SF_ELASTIC_API_KEY")
		}
		elasticSink.SetAPIKey(elasticKey)
		go elasticSink.Run(sinkCtx)
		if hub != nil {
			hub.SetElasticStats(elasticSink.Stats)
		}
		if elasticSink.APIKeyConfigured() {
			fmt.Printf("[ENGINE] elasticsearch on %s (alerts bulk-indexed as %s-YYYY.MM.DD, ApiKey auth enabled)\n", redact.EndpointLabel(o.elasticURL), o.elasticIndex)
		} else {
			fmt.Printf("[ENGINE] elasticsearch on %s (alerts bulk-indexed as %s-YYYY.MM.DD, no auth header - set -elastic-api-key or SF_ELASTIC_API_KEY)\n", redact.EndpointLabel(o.elasticURL), o.elasticIndex)
		}
	}
	return elasticSink
}

// startSplunk launches the Splunk HEC sink when -splunk is set; nil
// otherwise. Same delivery discipline as the webhook: async, bounded,
// never stalls the loop.
func startSplunk(o *options, sinkCtx context.Context, hub *api.Hub) *siem.Splunk {
	var splunkSink *siem.Splunk
	if o.splunkURL != "" {
		splunkSink, err := siem.NewSplunk(o.splunkURL)
		if err != nil {
			log.Fatalf("[ENGINE] %v", err)
		}
		splunkTok := o.splunkToken
		if splunkTok == "" {
			splunkTok = os.Getenv("SF_SPLUNK_TOKEN")
		}
		splunkSink.SetToken(splunkTok)
		go splunkSink.Run(sinkCtx)
		if hub != nil {
			hub.SetSplunkStats(splunkSink.Stats)
		}
		if splunkSink.TokenConfigured() {
			fmt.Printf("[ENGINE] splunk hec on %s (alerts POSTed as events, Splunk token enabled)\n", redact.EndpointLabel(o.splunkURL))
		} else {
			fmt.Printf("[ENGINE] splunk hec on %s (alerts POSTed as events, no token - set -splunk-token or SF_SPLUNK_TOKEN)\n", redact.EndpointLabel(o.splunkURL))
		}
	}
	return splunkSink
}
