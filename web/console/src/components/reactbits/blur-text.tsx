'use client'

// BlurText — adaptado de React Bits (reactbits.dev) al tema de la consola.
// Revela un titular palabra a palabra (subida + desenfoque + aparición).
// Usado en el título de vista del topbar: la animación comunica el cambio
// de sección, no decora. Respeta prefers-reduced-motion (texto plano).

import { motion, useReducedMotion } from 'motion/react'

type BlurTextProps = {
  text: string
  /** seconds between words */
  stagger?: number
  /** seconds before the first word */
  delay?: number
  className?: string
}

export function BlurText({ text, stagger = 0.035, delay = 0, className = '' }: BlurTextProps) {
  const reduce = useReducedMotion()
  const words = text.split(' ')

  if (reduce) {
    return <span className={className}>{text}</span>
  }

  return (
    <span className={className} aria-label={text} role="text">
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          // span + inline-block: blur() no anima bien en inline puro
          className="inline-block will-change-[filter,transform,opacity]"
          initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{
            duration: 0.4,
            delay: delay + i * stagger,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {word}
          {i < words.length - 1 ? '\u00A0' : ''}
        </motion.span>
      ))}
    </span>
  )
}
