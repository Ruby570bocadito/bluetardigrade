// Fetches are bounded and linked to the provider lifetime. A stalled
// connection must not leave the console live forever or pile up polls.
export const ENGINE_REQUEST_TIMEOUT_MS = 5000

// Promise.all rejects early. Wait for sibling requests too so a failed
// required endpoint cannot leave work overlapping the next poll.
export async function settledBatch<T extends readonly unknown[] | []>(
  jobs: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  try {
    return await Promise.all(jobs)
  } catch (error) {
    await Promise.allSettled(jobs)
    throw error
  }
}

export async function readEngineJson<T>(base: string, path: string, lifetime: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort(lifetime.reason)
  if (lifetime.aborted) abort()
  else lifetime.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(), ENGINE_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(base + path, { signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new EngineHttpError(path, response.status)
    return (await response.json()) as T
  } finally {
    clearTimeout(timer)
    lifetime.removeEventListener('abort', abort)
  }
}

export class EngineHttpError extends Error {
  constructor(path: string, public readonly status: number) {
    super(path + ' -> ' + status)
  }
}

// A real missing optional surface clears its previous state; transient
// transport errors preserve the last successful snapshot.
export async function readOptionalEngineJson<T>(
  base: string, path: string, lifetime: AbortSignal,
): Promise<T | null | undefined> {
  try {
    return await readEngineJson<T>(base, path, lifetime)
  } catch (error) {
    return error instanceof EngineHttpError && error.status === 404 ? null : undefined
  }
}

export function mergeNewest<T extends { timestamp: string }>(
  preferred: readonly T[], snapshot: readonly T[], key: (item: T) => string, limit: number,
): T[] {
  const unique = new Map<string, T>()
  for (const item of [...preferred, ...snapshot]) {
    const id = key(item)
    if (!unique.has(id)) unique.set(id, item)
  }
  return [...unique.values()]
    .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0))
    .slice(0, limit)
}

export function alertKey(a: { id?: string; event_id: string; rule_id: string; timestamp: string }): string {
  return a.id || [a.timestamp, a.event_id, a.rule_id].join('\x1f')
}

// Replayed SSE frames must not overwrite a triage decision already
// applied to the same alert or count the same event twice.
export function prependLive<T extends { timestamp: string }>(
  item: T, previous: T[], key: (item: T) => string, limit: number,
): T[] {
  return previous.some((existing) => key(existing) === key(item))
    ? previous
    : mergeNewest([item], previous, key, limit)
}

export function engineDisplayEndpoint(base: string): string {
  if (base.startsWith('/')) return 'proxy local · ' + base
  try {
    return new URL(base).origin
  } catch {
    return 'API del motor'
  }
}
