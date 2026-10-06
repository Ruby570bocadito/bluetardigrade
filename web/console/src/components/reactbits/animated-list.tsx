'use client'

// AnimatedList — adaptado de React Bits (reactbits.dev). Lista cuyas filas
// entran escalonadas (aparición + subida corta). El retardo depende del
// índice de MONTAJE: las filas ya visibles no se re-animan cuando llega un
// evento nuevo (las keys son estables); solo las nuevas entran. Respeta
// prefers-reduced-motion.

import { motion, useReducedMotion } from 'motion/react'

type AnimatedItemProps = {
  index: number
  children: React.ReactNode
  className?: string
}

export function AnimatedItem({ index, children, className = '' }: AnimatedItemProps) {
  const reduce = useReducedMotion()
  const delay = Math.min(index * 0.04, 0.32)
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      // Con initial=false no hay animación que cortar; el duration:0
      // explícito cierra el caso raro de la preferencia llegando a mitad
      // de la entrada escalonada (MOTION 3: reactiva, no solo al montar).
      transition={reduce ? { duration: 0 } : { duration: 0.32, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
