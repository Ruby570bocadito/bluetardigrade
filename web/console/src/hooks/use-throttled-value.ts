'use client'

// useThrottledValue passes the first value through at once, then at
// most one new value per `ms`, always ending on the latest one. Views
// that re-lay out on every change (the entity graph) follow the live
// buffer at a pace a reader can follow instead of at the event rate.
// ms <= 0 disables the throttle (the value passes straight through).
import { useEffect, useRef, useState } from 'react'

export function useThrottledValue<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value)
  const last = useRef(0)
  useEffect(() => {
    if (ms <= 0 || Object.is(value, shown)) return
    const wait = last.current + ms - Date.now()
    if (wait <= 0) {
      last.current = Date.now()
      setShown(value)
      return
    }
    const timer = setTimeout(() => {
      last.current = Date.now()
      setShown(value)
    }, wait)
    return () => clearTimeout(timer)
  }, [value, shown, ms])
  return ms <= 0 ? value : shown
}
