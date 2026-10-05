```markdown
### Documentation accuracy (Pulimiento A, round 4)

- `docs/ARCHITECTURE.md` feature inventory, Console row: the
  parenthetical "(no provider token streaming)" became stale when
  Implementación B landed native provider streaming for the AI
  analyst (`web/console-service/analyst.ts` `chatCompletionStream`,
  commit `4257127`). IMP-B updated the analyst-panel comment and
  their own feature doc, but not the architecture inventory (that
  is Pulimiento A's area). Updated to "(native provider streaming:
  the answer renders as the model writes it; providers without
  streaming deliver it in one piece)", matching the wording IMP-B
  used in their changelog fragment and the panel comment.
- Completed the row-by-row audit of the feature inventory against
  the code. Storage (Prune at `internal/store/store.go:415`,
  QueryEvents/QueryAlerts used by the API lists/exports), Auth
  (constant-time compare in `internal/ingest/identity.go:196`,
  prevToken rotation in `internal/ingest/ingest.go:115`, Bearer on
  outbound webhooks in `internal/webhook/webhook.go`) and Ops (six
  PATH commands, Dockerfile, CI on every push) all verified
  accurate. No other rows drifted.
```
