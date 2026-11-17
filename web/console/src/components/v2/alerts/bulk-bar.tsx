'use client'

// What to do with the picked alerts, sliding up from the bottom of the
// queue: acknowledge, close or reopen them all, or take them. Every move
// ends in a notice with the way to undo it. Without triage rights the bar
// only counts and clears the selection.
import { useState } from 'react'
import { X } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { postAlertAssignBatch } from '@/lib/lifecycle'
import { createIncident } from '@/lib/engine-writes'
import { hostsOf, v2IncidentLink, worstSeverity } from '@/lib/v2/incidents-model'
import type { SfAlert, SfAlertStatus } from '@/lib/console-types'
import { bulkChanges } from '@/lib/v2/alerts-model'
import { undoWrite, useStatusWriter } from './writes'

export type Notice = { message: string; undo?: () => Promise<void>; link?: { href: string; label: string } }

export function BulkBar({ alerts, onClear, onNotice }: { alerts: SfAlert[]; onClear: () => void; onNotice: (n: Notice) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.alertsView
  const w = dict.alertActions
  const me = useConsoleUser()
  const { refresh } = useEngine()
  const write = useStatusWriter()
  const [busy, setBusy] = useState(false)
  const canTriage = !me.pending && me.can_triage
  const counts = {
    acknowledged: bulkChanges(alerts, 'acknowledged').length,
    closed: bulkChanges(alerts, 'closed').length,
    new: bulkChanges(alerts, 'new').length,
  }
  const ids = alerts.map((a) => a.id).filter((id): id is string => !!id)

  async function move(to: SfAlertStatus) {
    const changes = bulkChanges(alerts, to)
    if (changes.length === 0 || busy) return
    setBusy(true)
    const result = await write(changes, to)
    setBusy(false)
    const parts = [result.ok ? t.toast.done[to](result.ok) : '', result.failed ? t.toast.failed(result.failed, result.firstError) : '']
    onNotice({ message: parts.filter(Boolean).join(' · '), undo: result.done.length ? () => undoWrite(write, result.done) : undefined })
    onClear()
  }

  async function takeThem() {
    if (ids.length === 0 || busy) return
    setBusy(true)
    const ack = await postAlertAssignBatch(ids, me.name, me.mode === 'users' ? me.name : 'consola')
    setBusy(false)
    if (!ack.ok) {
      onNotice({ message: t.toast.failed(ids.length, ack.error) })
      return
    }
    const failed = ack.result.failed
    onNotice({
      message: [t.toast.assigned(ack.result.assigned.length), failed.length ? t.toast.failed(failed.length, failed[0].error) : '']
        .filter(Boolean)
        .join(' · '),
    })
    refresh()
    onClear()
  }

  // the picked alerts become a case (the other way into Incidentes)
  async function makeCase() {
    if (ids.length === 0 || busy) return
    const withId = alerts.filter((a) => a.id)
    const hosts = hostsOf(withId)
    const title =
      withId.length === 1
        ? w.incidentDefaultOne(withId[0].rule_name, withId[0].host)
        : w.incidentDefaultMany(withId.length, `${hosts.slice(0, 2).join(', ')}${hosts.length > 2 ? '…' : ''}`)
    setBusy(true)
    const res = await createIncident({
      title,
      severity: worstSeverity(withId),
      alert_ids: ids.slice(0, 500),
      hosts,
      by: me.mode === 'users' ? me.name : 'consola',
    })
    setBusy(false)
    if (!res.ok) {
      onNotice({ message: res.status === 404 || res.status === 405 ? w.noIncidents : res.error })
      return
    }
    onNotice({ message: dict.v2.incidentsView.created, link: { href: v2IncidentLink(res.data.id), label: dict.v2.incidentsView.openCase } })
    onClear()
  }

  return (
    <div className="v2-bulk" role="region" aria-label={w.selectionAria}>
      <strong>{w.selected(alerts.length)}</strong>
      {canTriage && (
        <div className="v2-actions">
          <button type="button" className="v2-btn v2-btn-primary" disabled={busy || counts.acknowledged === 0} onClick={() => void move('acknowledged')}>
            {w.acknowledge(counts.acknowledged)}
          </button>
          <button type="button" className="v2-btn" disabled={busy || counts.closed === 0} onClick={() => void move('closed')}>
            {w.close(counts.closed)}
          </button>
          <button type="button" className="v2-btn" disabled={busy || counts.new === 0} onClick={() => void move('new')}>
            {w.reopen(counts.new)}
          </button>
          {me.name && (
            <button type="button" className="v2-btn" disabled={busy || ids.length === 0} onClick={() => void takeThem()}>
              {t.assignMineBulk(ids.length)}
            </button>
          )}
          <button type="button" className="v2-btn" disabled={busy || ids.length === 0} onClick={() => void makeCase()}>
            {t.createCase(ids.length)}
          </button>
        </div>
      )}
      <button type="button" className="v2-icon-btn" aria-label={w.clearSelection} onClick={onClear}>
        <X aria-hidden="true" />
      </button>
    </div>
  )
}
