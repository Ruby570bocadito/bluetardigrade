'use client'

// security-framework · consola de detección en tiempo real.
// Single-route product console: everything renders under '/'; the live
// channel comes from the console-service mini service over socket.io.

import { ConsoleProvider } from '@/components/console/socket-provider'
import { ConsoleShell } from '@/components/console/shell'

export default function ConsolePage() {
  return (
    <ConsoleProvider>
      <ConsoleShell />
    </ConsoleProvider>
  )
}
