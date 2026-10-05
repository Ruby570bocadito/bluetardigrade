```markdown
### Documentation accuracy (Pulimiento A)

- `docs/ARCHITECTURE.md` repository layout now lists all 29 `internal/`
  packages instead of 21: `baseline`, `fleet`, `forensic`, `incident`,
  `intel`, `reputation`, `tlsutil` and `yamlcheck` were missing even
  though each ships code and tests. A reader of the layout no longer
  has to `ls internal/` to discover the evidence recorder, the
  threat-intel matcher or the TLS hot-rotation loader.
- `docs/OPERATIONS.md` kill-chain correlation section now documents the
  `sequences/campaigns.yaml` pack (7 critical campaign sequences:
  archive-and-upload exfiltration, cloud-sync exfiltration, ransomware
  preparation, webshell reconnaissance, credential-to-lateral
  movement, escalation-to-credential-dump, and malicious-document
  delivery) with the same ID/severity/window/steps table format the
  `kill-chains.yaml` and `lateral.yaml` packs already had. The intro
  sentence was updated to name all three shipped packs.
```
