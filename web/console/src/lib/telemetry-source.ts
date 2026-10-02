import type { SfEvent } from './console-types'

// Source is declared by the sender, not attested by the engine. Describe
// the received window without promoting the newest event into proof that
// every other event is genuine sensor telemetry.
export const SOURCE_LABELS: Record<string, string> = { sysmon: 'Sysmon', etw: 'ETW', simulate: 'demo simulada', suricata: 'Suricata', zeek: 'Zeek', osquery: 'osquery', cowrie: 'Cowrie', 'windows-firewall': 'Windows Firewall', eml: 'EML' }

export function describeTelemetrySources(events: Pick<SfEvent, 'source'>[]): { label: string; hasDemo: boolean } {
  if (events.length === 0) return { label: 'sin eventos recibidos', hasDemo: false }
  const sources = new Set<string>(events.map((event) => Object.hasOwn(SOURCE_LABELS, event.source) ? SOURCE_LABELS[event.source] : 'otra/no declarada'))
  const labels = [...Object.values(SOURCE_LABELS), 'otra/no declarada'].filter((label) => sources.has(label))
  return { label: `fuentes declaradas: ${labels.join(' + ')}`, hasDemo: sources.has('demo simulada') }
}
