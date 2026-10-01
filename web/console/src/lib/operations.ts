import type { EngineStats, SfAlert } from './console-types'

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
  if (stats.correlator_cap > 0 && stats.correlator_states >= stats.correlator_cap) {
    issues.push('Correlador al límite de capacidad')
  }
  if ((stats.beacons_cap ?? 0) > 0 && (stats.beacons_tracked ?? 0) >= stats.beacons_cap!) {
    issues.push('Detector de beaconing al límite de capacidad')
  }
  return issues
}
