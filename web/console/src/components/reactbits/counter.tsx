'use client'

// Counter — adaptado de React Bits (reactbits.dev). Cada dígito es una
// columna 0-9 que rueda hasta su valor con un muelle: el cambio de la
// cifra principal se ve llegar. Los lectores de pantalla leen el número
// real (texto oculto); las columnas son decorativas. Bajo
// prefers-reduced-motion los dígitos se colocan sin transición.

import { motion, useReducedMotion } from 'motion/react'

type CounterProps = {
  value: number
  /** alto de un dígito en px (debe coincidir con el line-height) */
  height: number
  className?: string
}

export function Counter({ value, height, className }: CounterProps) {
  const reduce = useReducedMotion()
  const digits = String(Math.max(0, Math.round(value))).split('')
  return (
    <span className={className} style={{ display: 'inline-flex', height, lineHeight: `${height}px` }}>
      <span className="sr-only">{value}</span>
      <span aria-hidden style={{ display: 'inline-flex', overflow: 'hidden', height }}>
        {digits.map((d, i) => (
          <span key={digits.length - i} style={{ position: 'relative', display: 'inline-block', width: '0.62em', height }}>
            <motion.span
              style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
              initial={false}
              animate={{ y: -Number(d) * height }}
              transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 140, damping: 20 }}
            >
              {Array.from({ length: 10 }, (_, n) => (
                <span key={n} style={{ height, lineHeight: `${height}px` }}>{n}</span>
              ))}
            </motion.span>
          </span>
        ))}
      </span>
    </span>
  )
}
