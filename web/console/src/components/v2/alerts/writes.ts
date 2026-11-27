'use client'

// Triage writes shared by every view of the queue (bulk bar, board, focus
// mode, swipe): one engine call per alert through lib/lifecycle, the
// live ring patched with the engine's own answer, and what each alert
// was before, so the toast can put it back.
import { useEngine } from '@/components/console/engine-provider'
import { postAlertStatus } from '@/lib/lifecycle'
import type { SfAlertStatus } from '@/lib/console-types'
import type { BulkChange } from '@/lib/v2/alerts-model'

export type WriteResult = { ok: number; failed: number; firstError: string; done: BulkChange[] }

export function useStatusWriter() {
  const { applyTriage } = useEngine()
  return async function write(changes: readonly BulkChange[], to: SfAlertStatus, note = ''): Promise<WriteResult> {
    const out: WriteResult = { ok: 0, failed: 0, firstError: '', done: [] }
    for (const change of changes) {
      const ack = await postAlertStatus({ alert_id: change.id, status: to, note, by: 'consola' })
      if (ack.ok) {
        out.ok++
        out.done.push(change)
        if (ack.entry) applyTriage(ack.entry)
      } else {
        out.failed++
        if (!out.firstError) out.firstError = ack.error
      }
    }
    return out
  }
}

/** Puts every alert of a write back where it was (the engine records both decisions). */
export async function undoWrite(write: ReturnType<typeof useStatusWriter>, done: readonly BulkChange[]): Promise<void> {
  for (const status of ['new', 'acknowledged', 'closed'] as const) {
    const back = done.filter((c) => c.from === status)
    if (back.length) await write(back, status)
  }
}
