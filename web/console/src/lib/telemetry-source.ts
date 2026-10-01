import type { SfEvent } from './console-types'

// Source is declared by the sender, not attested by the engine. Describe
// the received window without promoting the newest event into proof that
// every other event is genuine sensor telemetry.
export function describeTelemetrySources(events: Pick<SfEvent, 'source'>[]): { label: string; hasDemo: boolean } {
  if (events.length === 0) return { label: 'sin eventos recibidos', hasDemo: false }
  const sources = new Set<string>(events.map((event) =>
    event.source === 'sysmon' ? 'Sysmon' : event.source === 'etw' ? 'ETW' : event.source === 'simulate' ? 'demo simulada' : 'otra/no declarada'))
  const labels = ['Sysmon', 'ETW', 'demo simulada', 'otra/no declarada'].filter((label) => sources.has(label))
  return { label: `fuentes declaradas: ${labels.join(' + ')}`, hasDemo: sources.has('demo simulada') }
}
