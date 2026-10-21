import type { EngineStats, SfAlert } from './console-types'
import { writeAlertLens, writeViewToSearch } from './url-state'

export type TriageTarget = 'critical' | 'new' | 'acknowledged' | 'closed'

/** Open the same live alert window counted by the dashboard, with a fresh lens. */
export function writeTriageDestination(search: string, target: TriageTarget): string {
  const lens = target === 'critical'
    ? writeAlertLens(search, 'critical', '', 'open', 'live')
    : writeAlertLens(search, 'all', '', target, 'live')
  return writeViewToSearch(lens, 'alertas')
}

export function triageSummary(alerts: readonly SfAlert[]) {
  return {
    pending: alerts.filter((a) => !a.status || a.status === 'new').length,
    acknowledged: alerts.filter((a) => a.status === 'acknowledged').length,
    closed: alerts.filter((a) => a.status === 'closed').length,
    critical: alerts.filter((a) => a.severity === 'critical' && a.status !== 'closed').length,
  }
}

export type PipelineIssueId =
  | 'ingestDropped'
  | 'webhookFailing'
  | 'storeFailures'
  | 'identityViolations'
  | 'idConflicts'
  | 'correlatorCap'
  | 'beaconsCap'

/** One noticed pipeline problem: the id keys the dictionary copy
 * (dict.operations.issues) and `count` is the number the copy cites.
 * The saturation ids carry no count (their copy is a fixed sentence). */
export type PipelineIssue = { id: PipelineIssueId; count: number }

export function pipelineIssues(stats: EngineStats | null): PipelineIssue[] {
  if (!stats) return []
  const issues: PipelineIssue[] = []
  const ingest = stats.dropped + stats.ingest_rejected
  const webhook = stats.webhook_failed + stats.webhook_dropped
  if (ingest) issues.push({ id: 'ingestDropped', count: ingest })
  if (webhook) issues.push({ id: 'webhookFailing', count: webhook })
  if ((stats.store_write_failures ?? 0) > 0) {
    issues.push({ id: 'storeFailures', count: stats.store_write_failures ?? 0 })
  }
  if ((stats.ingest_identity_violations ?? 0) > 0) {
    issues.push({ id: 'identityViolations', count: stats.ingest_identity_violations ?? 0 })
  }
  if ((stats.store_id_conflicts ?? 0) > 0) {
    issues.push({ id: 'idConflicts', count: stats.store_id_conflicts ?? 0 })
  }
  if (stats.correlator_cap > 0 && stats.correlator_states >= stats.correlator_cap) {
    issues.push({ id: 'correlatorCap', count: 0 })
  }
  if ((stats.beacons_cap ?? 0) > 0 && (stats.beacons_tracked ?? 0) >= stats.beacons_cap!) {
    issues.push({ id: 'beaconsCap', count: 0 })
  }
  return issues
}
