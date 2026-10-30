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
// El texto mostrado se deriva del estado: un texto nuevo se ve plano hasta
// que el ciclo lo toma, y con movimiento reducido no hay ciclo, así que el
// efecto nunca llama a setState de forma síncrona.

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
  // frame.shown belongs to frame.text; any other text is shown plain
  const [frame, setFrame] = useState({ text, shown: text })
  const display = frame.text === text ? frame.shown : text

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let revealed = 0
    const id = window.setInterval(() => {
      revealed += step
      if (revealed >= text.length) {
        setFrame({ text, shown: text })
        window.clearInterval(id)
        return
      }
      let out = text.slice(0, revealed)
      for (let i = revealed; i < text.length; i++) {
        out += text[i] === ' ' ? ' ' : glyphs[Math.floor(Math.random() * glyphs.length)]
      }
      setFrame({ text, shown: out })
    }, speed)
    return () => window.clearInterval(id)
  }, [text, glyphs, speed, step])

  return (
    <span className={className} aria-label={text}>
      {/* aria-hidden: el lector escucha la etiqueta completa, no el ruido
          de glifos; el span interno solo existe para el efecto visual */}
      <span aria-hidden>{display}</span>
    </span>
  )
}
