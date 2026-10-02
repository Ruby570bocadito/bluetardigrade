'use client'

// DotGrid — adaptado de React Bits (reactbits.dev). Rejilla de puntos en
// canvas que reacciona al puntero: los puntos cercanos ganan tamaño y un
// tinte azul que decae al reposo. Es el fondo de toda la consola,
// sustituye a la rejilla estática .ambient-dots del sidebar.
//
// Presupuesto de rendimiento (una consola SOC vive abierta horas):
// - La capa base (puntos en reposo) se pre-renderiza UNA vez por resize
//   en un canvas offscreen; cada frame es un blit + los puntos activos.
//   Coste O(puntos energizados), no O(puntos totales).
// - El puntero se escucha en window y la capa es pointer-events:none:
//   la interacción no roba eventos a la UI.
// - Sin rAF mientras no hay energía ni con la pestaña oculta; bajo
//   prefers-reduced-motion queda la rejilla estática, sin listeners.

import { useEffect, useRef } from 'react'

type DotGridProps = {
  /** separación entre puntos en px */
  gap?: number
  /** radio de influencia del puntero en px */
  radius?: number
  className?: string
}

const BASE_ALPHA = 0.05
const BASE_RADIUS = 1
const ENERGY_DECAY = 2.6 // por segundo, exponencial

export function DotGridLayer({ gap = 22, radius = 150, className = '' }: DotGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let running = false
    let dots = new Float32Array(0) // [x, y, energía] * n
    let count = 0
    let last = 0
    const pointer = { x: -1e4, y: -1e4 }
    let pointerInside = false
    const base = document.createElement('canvas')

    const buildGrid = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = window.innerWidth
      const h = window.innerHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const cols = Math.ceil(w / gap) + 1
      const rows = Math.ceil(h / gap) + 1
      count = cols * rows
      dots = new Float32Array(count * 3)
      let i = 0
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          dots[i * 3] = c * gap
          dots[i * 3 + 1] = r * gap
          dots[i * 3 + 2] = 0
          i++
        }
      }

      // capa base pre-renderizada: la rejilla en reposo, un solo blit por frame
      base.width = canvas.width
      base.height = canvas.height
      const bctx = base.getContext('2d')
      if (!bctx) return
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      bctx.clearRect(0, 0, w, h)
      bctx.fillStyle = `rgba(255, 255, 255, ${BASE_ALPHA})`
      for (let d = 0; d < count; d++) {
        bctx.beginPath()
        bctx.arc(dots[d * 3], dots[d * 3 + 1], BASE_RADIUS, 0, Math.PI * 2)
        bctx.fill()
      }
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(base, 0, 0, w, h)
    }

    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
      pointerInside = true
      // re-entry after pointerleave: the loop stopped itself (no energy,
      // no pointer inside) and pointermove is the only signal that it
      // may light dots again — without this wake the layer stays dead
      // until a resize or tab switch. wake() is a no-op while running.
      wake()
    }
    const onLeave = () => {
      pointer.x = -1e4
      pointer.y = -1e4
      pointerInside = false
    }

    const frame = (t: number) => {
      const dt = last ? Math.min((t - last) / 1000, 0.1) : 0.016
      last = t
      const decay = Math.exp(-ENERGY_DECAY * dt)
      const w = window.innerWidth
      const h = window.innerHeight

      let active = 0
      for (let d = 0; d < count; d++) {
        const dx = dots[d * 3] - pointer.x
        const dy = dots[d * 3 + 1] - pointer.y
        const dist2 = dx * dx + dy * dy
        if (dist2 < radius * radius) {
          // caída cuadrática: el punto bajo el cursor se enciende, el
          // borde del halo apenas se insinúa
          const falloff = 1 - Math.sqrt(dist2) / radius
          const target = falloff * falloff
          if (target > dots[d * 3 + 2]) dots[d * 3 + 2] = target
        }
        let e = dots[d * 3 + 2] * decay
        if (e < 0.004) e = 0
        dots[d * 3 + 2] = e
        if (e > 0) active++
      }

      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(base, 0, 0, w, h)
      if (active > 0) {
        for (let d = 0; d < count; d++) {
          const e = dots[d * 3 + 2]
          if (e === 0) continue
          const x = dots[d * 3]
          const y = dots[d * 3 + 1]
          // halo azul + punto central: dos arcs por punto activo
          ctx.fillStyle = `rgba(96, 165, 250, ${(e * 0.22).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(x, y, BASE_RADIUS + e * 4.2, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = `rgba(147, 197, 253, ${(BASE_ALPHA + e * 0.5).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(x, y, BASE_RADIUS + e * 0.9, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // el bucle vive mientras haya energía que decaer o el puntero esté
      // dentro (puede encender puntos en el siguiente movimiento)
      if (active > 0 || pointerInside) {
        raf = requestAnimationFrame(frame)
      } else {
        running = false
        last = 0
      }
    }

    const wake = () => {
      if (!running && !reduce) {
        running = true
        last = 0
        raf = requestAnimationFrame(frame)
      }
    }

    const onVisibility = () => {
      if (document.hidden && running) {
        cancelAnimationFrame(raf)
        running = false
        last = 0
      } else if (!document.hidden) {
        wake()
      }
    }

    buildGrid()
    if (reduce) return () => window.removeEventListener('resize', onResize)

    window.addEventListener('resize', onResize)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', onVisibility)
    wake()

    function onResize() {
      buildGrid()
      wake()
    }

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [gap, radius])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none fixed inset-0 z-0 ${className}`}
    />
  )
}
