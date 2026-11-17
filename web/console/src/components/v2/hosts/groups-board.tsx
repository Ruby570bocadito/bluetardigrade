'use client'

// Host groups (boceto 7): one column per group with its machines and one
// for those in none. An administrator moves a machine by dragging it (or
// with its "Mover a" menu, which also works by keyboard); the move is
// saved to the engine at once, as the whole list its settings take.
import { useState, type DragEvent } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { saveHostGroups, type HostGroupsPayload } from '@/lib/host-groups'
import { groupColumns, moveHost, plainGroups, type HostRow } from '@/lib/v2/hosts-model'
import { Empty } from '../home/parts'

export function GroupsBoard({
  payload,
  rows,
  onSaved,
  onNotice,
  onOpen,
}: {
  payload: HostGroupsPayload | null
  rows: HostRow[]
  onSaved: (p: HostGroupsPayload) => void
  onNotice: (message: string) => void
  onOpen: (host: string) => void
}) {
  const { dict } = useI18n()
  const t = dict.v2.hostsView
  const me = useConsoleUser()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ host: string; from: string | null } | null>(null)

  if (!payload || !payload.enabled) return <Empty title={t.groupsOff}>{t.groupsOffHint}</Empty>
  const canEdit = payload.writable && !me.pending && me.role === 'admin'
  const statusOf = new Map(rows.map((r) => [r.host.toLowerCase(), r.status]))
  const cols = groupColumns(payload, rows, t.groupNone)
  const labelOf = (name: string | null) => (name === null ? t.groupNone : cols.find((c) => c.name === name)?.label ?? name)

  const move = async (host: string, from: string | null, to: string | null) => {
    if (from === to || busy) return
    setBusy(true)
    setError(null)
    const { groups, stillIn } = moveHost(plainGroups(payload), host, from, to)
    const res = await saveHostGroups(groups)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onSaved(res.data)
    onNotice(stillIn.length ? t.stillIn(host, stillIn.map((g) => labelOf(g)).join(', ')) : t.moved(host, labelOf(to)))
  }

  const key = (name: string | null) => name ?? '_none'

  return (
    <div className="v2-groups">
      <p className="v2-dim v2-small">{canEdit ? t.groupsDrag : t.groupsReadOnly}</p>
      {error && <p className="v2-error">{error}</p>}
      <div className="v2-groups-cols" data-busy={busy}>
        {cols.map((c) => (
          <section
            key={key(c.name)}
            className="v2-groups-col"
            data-over={over === key(c.name)}
            onDragOver={(e: DragEvent) => {
              if (!canEdit || !dragging) return
              e.preventDefault()
              setOver(key(c.name))
            }}
            onDragLeave={() => setOver((o) => (o === key(c.name) ? null : o))}
            onDrop={(e: DragEvent) => {
              e.preventDefault()
              setOver(null)
              if (dragging) void move(dragging.host, dragging.from, c.name)
              setDragging(null)
            }}
          >
            <h3>
              {c.label} <span className="v2-dim v2-mono">{c.members.length}</span>
            </h3>
            <ul>
              {c.members.map((m) => (
                <li
                  key={m}
                  className="v2-group-chip"
                  draggable={canEdit}
                  data-dragging={dragging?.host === m && dragging.from === c.name}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', m)
                    e.dataTransfer.effectAllowed = 'move'
                    setDragging({ host: m, from: c.name })
                  }}
                  onDragEnd={() => {
                    setDragging(null)
                    setOver(null)
                  }}
                >
                  <i className="v2-group-dot" data-status={statusOf.get(m.toLowerCase()) ?? 'unknown'} aria-hidden="true" />
                  <button type="button" className="v2-link v2-mono" onClick={() => onOpen(m)}>
                    {m}
                  </button>
                  {canEdit && (
                    <label className="v2-group-move">
                      <span className="v2-sr-only">{t.moveAria(m)}</span>
                      <select
                        value=""
                        disabled={busy}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v) void move(m, c.name, v === '_none' ? null : v)
                        }}
                      >
                        <option value="">{t.moveTo}</option>
                        {cols
                          .filter((o) => o.name !== c.name)
                          .map((o) => (
                            <option key={key(o.name)} value={key(o.name)}>
                              {o.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {busy && (
        <p className="v2-dim v2-small" role="status">
          {t.saving}
        </p>
      )}
    </div>
  )
}
