'use client'

// GlareHover — adaptado de React Bits (reactbits.dev). Un reflejo
// diagonal cruza la tarjeta al pasar el puntero o al recibir el foco.
// CSS puro (sin JS por frame); desactivado bajo prefers-reduced-motion.

type GlareHoverProps = {
  children: React.ReactNode
  className?: string
}

export function GlareHover({ children, className = '' }: GlareHoverProps) {
  return (
    <div className={`glare-hover ${className}`}>
      {children}
      <span aria-hidden className="glare-hover__shine" />
    </div>
  )
}
