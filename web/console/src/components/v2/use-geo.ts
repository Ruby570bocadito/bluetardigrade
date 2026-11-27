'use client'

// Where some public IPs are, asked once to the console's own lookup
// (/api/console/geo, DB-IP table on the console server) and remembered for
// the rest of the visit. Undefined while an address has no answer yet;
// null when it has no place.
import { useEffect, useState } from 'react'
import type { Located } from '@/lib/v2/geo-map'

const cache = new Map<string, Located | null>()
const BATCH = 256

export function useGeo(ips: readonly string[]): Record<string, Located | null | undefined> {
  const key = [...ips].sort().join(',')
  const [, setVersion] = useState(0)

  useEffect(() => {
    const missing = key ? key.split(',').filter((ip) => !cache.has(ip)) : []
    if (missing.length === 0) return undefined
    let cancelled = false
    void (async () => {
      for (let i = 0; i < missing.length; i += BATCH) {
        const batch = missing.slice(i, i + BATCH)
        try {
          const res = await fetch(`/api/console/geo?ips=${encodeURIComponent(batch.join(','))}`, { cache: 'no-store' })
          if (!res.ok) return
          const body = (await res.json()) as { results: Record<string, Located | null> }
          for (const ip of batch) cache.set(ip, body.results[ip] ?? null)
        } catch {
          return
        }
      }
      if (!cancelled) setVersion((v) => v + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [key])

  return Object.fromEntries(ips.map((ip) => [ip, cache.get(ip)]))
}
