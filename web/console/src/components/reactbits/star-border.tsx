'use client'

// StarBorder — adaptado de React Bits (reactbits.dev). Marco de 1px con un
// degradado en movimiento (truco padding 1px + background animado en el
// contenedor: el hijo enmascara el centro y queda solo el borde vivo).
// Uso semántico en esta consola: rodea la transcripción del Analista IA
// mientras está analizando — el borde en movimiento es el indicador de
// "trabajo en curso" de la IA, se apaga al terminar. CSS puro; el CSS
// global lo congela bajo prefers-reduced-motion.

type StarBorderProps = {
  children: React.ReactNode
  /** activa el borde en movimiento (inactivo: borde estático normal) */
  active?: boolean
  /** color del haz del borde */
  color?: string
  /** duración del ciclo en segundos */
  speed?: number
  className?: string
}

export function StarBorder({
  children,
  active = false,
  color = 'rgba(52, 211, 153, 0.55)',
  speed = 6,
  className = '',
}: StarBorderProps) {
  return (
    <div
      className={`star-border rounded-md ${active ? 'star-border--active' : ''} ${className}`}
      style={{ '--sb-color': color, '--sb-speed': `${speed}s` } as React.CSSProperties}
    >
      {children}
    </div>
  )
}
