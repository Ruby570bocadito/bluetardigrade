'use client'

// AnimatedContent — adaptado de React Bits (reactbits.dev). Entrada de un
// bloque al montar la vista: sube unos píxeles y aparece, con un retardo
// por posición para que el panel se componga en cascada. Solo en el
// montaje (las actualizaciones en vivo no re-animan nada). Bajo
// prefers-reduced-motion el bloque aparece directamente.

import { motion, useReducedMotion } from 'motion/react'

type AnimatedContentProps = {
  children: React.ReactNode
  /** posición en la cascada (0, 1, 2...) */
  order?: number
  /** desplazamiento inicial en px */
  distance?: number
  className?: string
}

export function AnimatedContent({ children, order = 0, distance = 14, className }: AnimatedContentProps) {
  const reduce = useReducedMotion()
  // Always a motion element: the server renders the hidden initial
  // state (it cannot know the preference), and only motion rewrites
  // that inline style on the client. A plain <div> for reduced motion
  // would hydrate over the server's opacity:0 and stay invisible.
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: distance, filter: 'blur(3px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={reduce ? { duration: 0 } : { duration: 0.5, delay: Math.min(order * 0.06, 0.48), ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}
