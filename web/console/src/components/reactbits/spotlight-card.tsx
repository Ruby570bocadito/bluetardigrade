'use client'

// SpotlightCard — adaptado de React Bits (reactbits.dev). Tarjeta con un
// halo radial que sigue al puntero (CSS custom properties actualizadas en
// pointermove: cero re-renders de React por movimiento). Aquí da profundidad
// a los KPI y paneles sin romper la densidad de cabina: la tarjeta es
// transparente hasta que el ratón entra.

import { useRef } from 'react'

type SpotlightCardProps = {
  children: React.ReactNode
  /** radio del halo en px */
  radius?: number
  /** rgba del halo (por defecto, el acento del tema) */
  color?: string
  className?: string
}

export function SpotlightCard({
  children,
  radius = 200,
  color = 'var(--accent-halo, rgba(212, 212, 216, 0.1))',
  className = '',
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null)

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`)
    el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`)
  }

  return (
    <div ref={ref} onPointerMove={onPointerMove} className={`spotlight-card ${className}`}>
      <span
        aria-hidden
        className="spotlight-card__halo"
        style={{
          background: `radial-gradient(${radius}px circle at var(--spot-x, 50%) var(--spot-y, 50%), ${color}, transparent 70%)`,
        }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}
