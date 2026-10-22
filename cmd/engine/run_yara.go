package main

// loadYara points the engine at its YARA rule pack (M-3): the directory
// the operator curates with -yara-rules, served to the sensors through
// the API and verified against their heartbeat sha (contract S-2<->M-3).
// Like the intel lists, a directory that cannot be read is logged and
// the engine continues without the pack; the API reports it as disabled.

import (
	"fmt"
	"log"

	"github.com/Ruby570bocadito/bluetardigrade/internal/yara"
)

func loadYara(o *options) *yara.Store {
	if o.yaraDir == "" {
		return nil
	}
	path := resolveDataDir(o.yaraDir, "yara-rules")
	store, err := yara.Load(path)
	if err != nil {
		log.Printf("[ENGINE] yara rule pack from %s NOT loaded: %v", path, err)
		return nil
	}
	store.Refresh()
	if snap := store.Snapshot(); len(snap.Files) > 0 {
		fmt.Printf("[ENGINE] yara rule pack: %d files (%d bytes) from %s (sha16 %s)\n",
			len(snap.Files), snap.TotalBytes, path, snap.Sha16)
	}
	return store
}
