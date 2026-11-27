import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// Server-rendered title of the command center (Spanish, like the rest of
// the server render); the page switches it to the operator's language.
export const metadata: Metadata = { title: 'Centro de mando · bluetardigrade' }

export default function CommandCenterLayout({ children }: { children: ReactNode }) {
  return children
}
