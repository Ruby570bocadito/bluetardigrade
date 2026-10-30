'use client'

// useEntrance — el `initial` de una animación de entrada que hidrata
// limpio. El servidor no conoce prefers-reduced-motion, así que el primer
// render (el HTML del servidor y su hidratación) muestra el fotograma
// final en los dos lados: React no encuentra atributos distintos que dejar
// sin corregir, y nada queda oculto mientras cargan los scripts. Lo que se
// monta después de hidratar entra con `frame`, salvo que el usuario haya
// pedido menos movimiento.

import { useSyncExternalStore } from 'react'
import { useReducedMotion } from 'motion/react'

const noSubscription = () => () => {}

export function useEntrance<T>(frame: T): T | false {
  const reduce = useReducedMotion()
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false)
  return hydrated && !reduce ? frame : false
}
