package main

// run_respond.go arms the active-response surface (C3): the
// destructive kill_process route. Opt-in by layers — flag AND bearer
// token AND an open audit file — and its state is announced at
// startup, never guessed. Extracted from runEngine (POL-1); body is
// the original one, behavior unchanged — including the defer
// semantics: the audit file's Close that the inline original released
// with `defer` now travels back as a cleanup the caller defers at the
// same point of the startup flow, so the shutdown order is unchanged.

import (
	"fmt"
	"log"
	"os"

	"github.com/Ruby570bocadito/bluetardigrade/internal/api"
	"github.com/Ruby570bocadito/bluetardigrade/internal/respond"
)

// armActiveResponse enables kill_process when every layer is armed
// and prints the resulting state. It returns the manager (nil =
// surface off), the resolved operators and protected paths (the
// hot-reload loop re-reads them) and the audit cleanup (non-nil only
// when the surface came up; the caller MUST defer it).
func armActiveResponse(o *options, hub *api.Hub, apiTok string) (*respond.Manager, string, string, func()) {
	var respMgr *respond.Manager
	respOpsPath := ""
	respProtPath := ""
	var cleanup func()
	if o.allowKill || os.Getenv("SF_ALLOW_KILL") == "1" {
		switch {
		case hub == nil:
			fmt.Println("[ENGINE] active response: kill_process disabled (-allow-kill set but the API is disabled)")
		case apiTok == "":
			fmt.Println("[ENGINE] active response: kill_process disabled (-allow-kill requires -api-token/SF_API_TOKEN: the token is mandatory even on loopback)")
		default:
			auditPath := resolveDataFile(o.respondAudit, "respond-audit.jsonl")
			audit, aerr := respond.OpenAudit(auditPath)
			if aerr != nil {
				fmt.Printf("[ENGINE] active response: kill_process disabled (the audit file could not be opened: %v)\n", aerr)
			} else {
				// the inline original closed the audit with a deferred
				// Close; the caller defers this cleanup at the same
				// point of the startup flow.
				cleanup = func() { audit.Close() }
				hostName := ""
				if hn, herr := os.Hostname(); herr == nil {
					hostName = hn
				}
				respMgr = respond.NewManager(hostName, audit)
				respOpsPath = resolveDataFile(o.respondOperators, "respond-operators.yaml")
				if fileExists(respOpsPath) {
					if err := respMgr.LoadOperators(respOpsPath); err != nil {
						log.Fatalf("[ENGINE] %v", err)
					}
				} else {
					fmt.Printf("[ENGINE] active response: WARNING -respond-operators %s not found: the allowlist is EMPTY and every action will be denied until the file lists operators\n", respOpsPath)
				}
				if o.respondProtected != "" {
					respProtPath = resolveDataFile(o.respondProtected, "respond-protected.yaml")
					if fileExists(respProtPath) {
						if err := respMgr.LoadProtected(respProtPath); err != nil {
							log.Fatalf("[ENGINE] %v", err)
						}
					}
				}
				hub.EnableRespondKill(respMgr)
				hub.SetRespondPaths(respOpsPath, respProtPath, auditPath)
				if audit.Size() >= respond.MaxAuditBytes {
					fmt.Println("[ENGINE] active response: WARNING the audit file is already at its 64 MiB ceiling: every action will deny with audit_unavailable until the file is rotated")
				}
				fmt.Printf("[ENGINE] active response: kill_process ENABLED (operators: %d, protected: %d, audit: %s, signal: SIGKILL fixed)\n",
					respMgr.OperatorsCount(), respMgr.ProtectedCount(), auditPath)
				if n := respMgr.OperatorsCount(); n > 0 && respMgr.CredentialedOperators() == 0 {
					fmt.Println("[ENGINE] active response: WARNING operators are listed by name only (version 1): anyone holding the API token can act as any of them; move to version 2 with per-operator credentials ('engine operator-credential --name <op>')")
				}
			}
		}
	} else {
		fmt.Println("[ENGINE] active response: kill_process disabled (-allow-kill not set)")
	}
	return respMgr, respOpsPath, respProtPath, cleanup
}
