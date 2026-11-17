import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// Server-rendered title (Spanish, like the rest of the server render); the
// page switches it to the operator's language.
export const metadata: Metadata = { title: 'Respuesta · bluetardigrade' }

export default function RespondLayout({ children }: { children: ReactNode }) {
  return children
}
