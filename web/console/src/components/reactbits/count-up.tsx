'use client'

// CountUp — adaptado de React Bits (reactbits.dev). La cifra sube desde
// su valor anterior (o desde 0 al montar) con un muelle amortiguado, en
// lugar de saltar. Cifras proporcionales: es un valor suelto, no una
// columna. Bajo prefers-reduced-motion muestra el valor final al instante.

import { useEffect, useLayoutEffect, useRef } from 'react'
import { useMotionValue, useReducedMotion, useSpring } from 'motion/react'

type CountUpProps = {
  to: number
  /** valor inicial en el primer montaje */
  from?: number
  /** decimales a mostrar */
  decimals?: number
  className?: string
}

export function CountUp({ to, from = 0, decimals = 0, className }: CountUpProps) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const value = useMotionValue(reduce ? to : from)
  const spring = useSpring(value, { stiffness: 90, damping: 22, mass: 0.8 })
  const format = (v: number) =>
    v.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

  // Before the first paint, start the visible text at the spring's origin
  // so the count-up does not flash the final value first.
  useLayoutEffect(() => {
    if (!reduce && ref.current) ref.current.textContent = format(spring.get())
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    value.set(to)
  }, [to, value])

  useEffect(() => {
    if (reduce) return
    return spring.on('change', (latest) => {
      if (ref.current) ref.current.textContent = format(latest)
    })
    // format depends only on decimals
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spring, reduce, decimals])

  // React renders the mount-time text once and never touches it again (a
  // changing child would flash the target before the spring catches up);
  // the spring rewrites the text node in place, no React render per frame.
  const mountText = useRef(format(to)).current
  return (
    <span ref={ref} className={className}>
      {reduce ? format(to) : mountText}
    </span>
  )
}
