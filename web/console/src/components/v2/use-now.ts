'use client'

import { useEffect, useState } from 'react'

/** Wall clock that ticks every `every` ms; null until mounted, so the
 * server render and the first client render agree. */
export function useNow(every = 1000): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), every)
    return () => window.clearInterval(id)
  }, [every])
  return now
}
