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

export function pipelineIssues(stats: EngineStats | null): string[] {
  if (!stats) return []
  const issues: string[] = []
  const ingest = stats.dropped + stats.ingest_rejected
  const webhook = stats.webhook_failed + stats.webhook_dropped
  if (ingest) issues.push(ingest + ' eventos descartados o rechazados')
  if (webhook) issues.push(webhook + ' entregas de webhook con fallo')
  if ((stats.store_write_failures ?? 0) > 0) {
    issues.push(stats.store_write_failures + ' escrituras SQLite fallidas desde el arranque; revisa la evidencia persistida')
  }
  if ((stats.store_id_conflicts ?? 0) > 0) {
    issues.push(
      stats.store_id_conflicts +
        ' eventos reenviados con un id ya guardado y contenido distinto; se conservó la copia original (posible falsificación)',
    )
  }
  if (stats.correlator_cap > 0 && stats.correlator_states >= stats.correlator_cap) {
    issues.push('Correlador al límite de capacidad')
  }
  if ((stats.beacons_cap ?? 0) > 0 && (stats.beacons_tracked ?? 0) >= stats.beacons_cap!) {
    issues.push('Detector de beaconing al límite de capacidad')
  }
  return issues
}
