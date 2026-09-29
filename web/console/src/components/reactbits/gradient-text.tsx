'use client'

// GradientText — adaptado de React Bits (reactbits.dev). Degradado animado
// sobre texto (background-clip: text, CSS puro — cero JS por frame). Aquí
// tiene un único uso semántico: el contador de alertas critical cuando
// existe al menos una — el color de severidad latiendo comunica urgencia
// que un número estático no transmite. El CSS global congela el degradado
// bajo prefers-reduced-motion (se queda el primer color).

type GradientTextProps = {
  children: React.ReactNode
  /** parada de color del degradado (el texto hereda el tono de severidad) */
  colors?: string[]
  /** duración del ciclo en segundos */
  speed?: number
  className?: string
}

const FALLBACK = ['#fca5a5', '#fb923c', '#fca5a5']

export function GradientText({ children, colors = FALLBACK, speed = 5, className = '' }: GradientTextProps) {
  const gradient = `linear-gradient(90deg, ${colors.join(', ')}, ${colors[0]})`
  return (
    <span
      className={`gradient-text ${className}`}
      style={
        {
          backgroundImage: gradient,
          '--gt-speed': `${speed}s`,
        } as React.CSSProperties
      }
    >
      {children}
    </span>
  )
}
