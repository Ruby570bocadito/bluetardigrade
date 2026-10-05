'use client'

// DecryptedText — adaptado de React Bits (reactbits.dev). El texto entra
// como una descodificación: los caracteres aún no revelados ciclan glifos
// aleatorios y se asientan de izquierda a derecha. En una consola de
// detección el gesto es temático (telemetría que se descodifica), y se
// usa con moderación: la etiqueta de marca del sidebar, una sola vez al
// montar. Respeta prefers-reduced-motion (texto plano).
//
// Hidratación: el primer render (servidor Y cliente) es el texto plano —
// coinciden y Next no warning-a; el efecto arranca el ciclo justo después.

import { useEffect, useState } from 'react'

type DecryptedTextProps = {
  text: string
  /** caracteres de ofuscación durante el revelado */
  glyphs?: string
  /** ms entre tic de ciclado */
  speed?: number
  /** caracteres revelados por tic (velocidad de avance) */
  step?: number
  className?: string
}

const DEFAULT_GLYPHS = '!<>-_\\/[]{}=+*^?#01'

export function DecryptedText({
  text,
  glyphs = DEFAULT_GLYPHS,
  speed = 34,
  step = 2,
  className = '',
}: DecryptedTextProps) {
  const [display, setDisplay] = useState(text)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(text)
      return
    }
    let revealed = 0
    const id = window.setInterval(() => {
      revealed += step
      if (revealed >= text.length) {
        setDisplay(text)
        window.clearInterval(id)
        return
      }
      let out = text.slice(0, revealed)
      for (let i = revealed; i < text.length; i++) {
        out += text[i] === ' ' ? ' ' : glyphs[Math.floor(Math.random() * glyphs.length)]
      }
      setDisplay(out)
    }, speed)
    return () => window.clearInterval(id)
  }, [text, glyphs, speed, step])

  return (
    <span className={className}>
      {/* screen readers get the real text once; the animated span is
          decoration. aria-label needs a role, so the label lives as a
          visually-hidden text node instead (axe: aria-prohibited-attr) */}
      <span className="sr-only">{text}</span>
      <span aria-hidden>{display}</span>
    </span>
  )
}
