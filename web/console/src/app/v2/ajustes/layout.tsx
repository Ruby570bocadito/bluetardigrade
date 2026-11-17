import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// Server-rendered title (Spanish, like the rest of the server render); the
// page switches it to the operator's language.
export const metadata: Metadata = { title: 'Ajustes · bluetardigrade' }

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return children
}
