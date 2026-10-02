import type { SfEvent } from './console-types'

// Source declarations are untrusted observations, independent of enrichment.
export function stringMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === 'string'))
}

export function observedNetwork(raw: unknown): SfEvent['network'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const result: NonNullable<SfEvent['network']> = {}
  for (const key of ['protocol', 'source_ip', 'destination_ip', 'domain'] as const) {
    if (typeof value[key] === 'string') result[key] = value[key]
  }
  for (const key of ['source_port', 'destination_port'] as const) {
    if (Number.isInteger(value[key]) && (value[key] as number) >= 0 && (value[key] as number) <= 65535) result[key] = value[key] as number
  }
  return result
}

export function observationSearch(attributes?: Record<string, string>, network?: SfEvent['network']): string[] {
  return [...Object.entries(attributes ?? {}).flat(), ...Object.values(network ?? {}).map(String)]
}
