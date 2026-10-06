'use client'

// BlurText — adaptado de React Bits (reactbits.dev) al tema de la consola.
// Revela un titular palabra a palabra (subida + desenfoque + aparición).
// Usado en el título de vista del topbar: la animación comunica el cambio
// de sección, no decora. Respeta prefers-reduced-motion (texto plano).

type BlurTextProps = {
  text: string
  /** seconds between words */
  stagger?: number
  /** seconds before the first word */
  delay?: number
  className?: string
}

export function BlurText({ text, stagger = 0.035, delay = 0, className = '' }: BlurTextProps) {
  const words = text.split(' ')

  return (
    <span className={className}>
      {/* screen readers get the title as plain text; the animated words
          are decoration. role="text" is not a valid ARIA role, so the
          label lives in a visually-hidden node (axe:
          aria-prohibited-attr) */}
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((word, i) => (
          <span
            key={`${word}-${i}`}
            // Identical SSR/client markup; CSS applies the motion preference.
            className="blur-text-word inline-block"
            style={{ animationDelay: `${delay + i * stagger}s` }}
          >
            {word}
            {i < words.length - 1 ? '\u00A0' : ''}
          </span>
        ))}
      </span>
    </span>
  )
}
