'use client'

// ShinyText — adaptado de React Bits (reactbits.dev). Barrido de brillo
// sobre texto mediante background-clip: text (CSS puro, cero JS por frame).
// Semántica en esta consola: marca el estado "En vivo" del feed — el
// brillo viaja solo mientras el socket está conectado. El CSS global
// desactiva la animación bajo prefers-reduced-motion.

type ShinyTextProps = {
  children: React.ReactNode
  /** desactiva el barrido manteniendo el color base */
  disabled?: boolean
  /** duración del ciclo en segundos */
  speed?: number
  className?: string
}

export function ShinyText({ children, disabled = false, speed = 4, className = '' }: ShinyTextProps) {
  return (
    <span
      className={`shiny-text ${disabled ? 'shiny-text--paused' : ''} ${className}`}
      style={disabled ? undefined : ({ '--shiny-speed': `${speed}s` } as React.CSSProperties)}
    >
      {children}
    </span>
  )
}
