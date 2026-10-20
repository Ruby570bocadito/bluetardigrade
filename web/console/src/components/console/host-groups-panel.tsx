'use client'

// Ajustes -> Grupos de equipos: the host groups of the engine (GET
// /api/groups) with the machines each one holds, and for administrators
// an editor that saves the whole list (PUT /api/settings/groups). The
// engine validates every save and answers in Spanish naming the group
// and the field; this panel shows that message as it comes.

import { useCallback, useEffect, useId, useState } from 'react'
import { PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { useI18n } from './i18n-provider'
import { useConsoleUser } from './user-session'
import {
  draftOf, fetchHostGroups, groupOf, nameFromLabel, saveHostGroups,
  type GroupDraft, type HostGroup, type HostGroupsPayload,
} from '@/lib/host-groups'

const FIELD = 'mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const QUIET = 'inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:text-zinc-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const PRIMARY = 'rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
// red, not rose: the light theme remaps the red text steps (globals.css)
const DANGER = 'rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const plain = (g: HostGroup): HostGroup => ({ name: g.name, label: g.label, hosts: g.hosts, ad_ou: g.ad_ou, identities: g.identities })

function Editor({ draft, isNew, ad, busy, onChange, onSave, onCancel }: {
  draft: GroupDraft
  isNew: boolean
  ad: boolean
  busy: boolean
  onChange: (d: GroupDraft) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { dict } = useI18n()
  const t = dict.settings.grupos
  const id = useId()
  // a new group's name follows its label until the operator edits it
  const [nameTouched, setNameTouched] = useState(!isNew)
  // the hint describes the field (aria-describedby), it is not its name
  const field = (key: keyof GroupDraft, label: string, hint: string, rows?: number) => (
    <div className="text-xs text-zinc-400">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      {rows ? (
        <textarea id={`${id}-${key}`} rows={rows} value={draft[key]} spellCheck={false} aria-describedby={`${id}-${key}-hint`} onChange={(e) => onChange({ ...draft, [key]: e.target.value })} className={`${FIELD} font-mono`} />
      ) : (
        <input
          id={`${id}-${key}`}
          value={draft[key]}
          spellCheck={false}
          maxLength={key === 'name' ? 32 : 64}
          aria-describedby={`${id}-${key}-hint`}
          onChange={(e) => {
            if (key === 'name') setNameTouched(true)
            const next = { ...draft, [key]: e.target.value }
            if (key === 'label' && !nameTouched) next.name = nameFromLabel(e.target.value)
            onChange(next)
          }}
          className={`${FIELD} ${key === 'name' ? 'font-mono' : ''}`}
        />
      )}
      <span id={`${id}-${key}-hint`} className="mt-1 block text-[10px] leading-relaxed text-zinc-500">{hint}</span>
    </div>
  )
  return (
    <form
      className="space-y-3 rounded-lg border border-white/[0.08] px-3 py-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {field('label', t.fieldLabel, t.fieldLabelHint)}
        {field('name', t.fieldName, t.fieldNameHint)}
      </div>
      {field('hosts', t.fieldHosts, t.fieldHostsHint, 3)}
      {field('ad_ou', t.fieldOUs, ad ? t.fieldOUsHint : `${t.fieldOUsHint} ${t.noAD}`, 2)}
      {field('identities', t.fieldIdentities, t.fieldIdentitiesHint, 2)}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !draft.name.trim()} className={PRIMARY}>{busy ? t.saving : t.save}</button>
        <button type="button" onClick={onCancel} className={QUIET}>{t.cancel}</button>
      </div>
    </form>
  )
}

export function HostGroupsPanel() {
  const { dict } = useI18n()
  const t = dict.settings.grupos
  const me = useConsoleUser()
  const [data, setData] = useState<HostGroupsPayload | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // index being edited (-1 = a new group), and its draft
  const [editing, setEditing] = useState<{ index: number; draft: GroupDraft } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetchHostGroups()
    if (res.ok) {
      setData(res.data)
      setError('')
    } else {
      setError(res.error)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const canEdit = me.role === 'admin' && Boolean(data?.enabled && data.writable)

  async function save(groups: HostGroup[]) {
    setBusy(true)
    setNotice('')
    setError('')
    const res = await saveHostGroups(groups)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return false
    }
    setData(res.data)
    setNotice(t.saved)
    return true
  }

  async function saveDraft() {
    if (!data || !editing) return
    const list = data.groups.map(plain)
    const next = groupOf(editing.draft)
    if (editing.index < 0) list.push(next)
    else list[editing.index] = next
    if (await save(list)) setEditing(null)
  }

  async function remove(name: string) {
    if (!data) return
    if (await save(data.groups.filter((g) => g.name !== name).map(plain))) setRemoving(null)
  }

  return (
    <div className="panel px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-zinc-100">{t.heading}</h3>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing({ index: -1, draft: { name: '', label: '', hosts: '', ad_ou: '', identities: '' } })} className={QUIET}>
            <Plus size={12} aria-hidden /> {t.add}
          </button>
        )}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">{t.prose}</p>
      {data && !data.enabled && <p className="mb-3 text-xs text-amber-300">{t.notArmed}</p>}
      {data?.enabled && !data.writable && <p className="mb-3 text-xs text-zinc-400">{t.readOnly}</p>}
      {data?.enabled && data.writable && me.role !== 'admin' && <p className="mb-3 text-xs text-zinc-500">{t.notAdmin}</p>}
      {notice && <p role="status" className="mb-3 text-xs text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="mb-3 text-xs text-amber-300">{error}</p>}
      {!data && !error && <p className="text-xs text-zinc-500">{t.loading}</p>}

      {editing?.index === -1 && data && (
        <div className="mb-3">
          <Editor draft={editing.draft} isNew ad={data.ad} busy={busy} onChange={(draft) => setEditing({ index: -1, draft })} onSave={() => void saveDraft()} onCancel={() => { setEditing(null); setError('') }} />
        </div>
      )}

      {data && data.groups.length === 0 && !editing && <p className="text-xs text-zinc-500">{t.empty}</p>}
      {data && data.groups.length > 0 && (
        <ul className="space-y-2">
          {data.groups.map((g, i) =>
            editing?.index === i ? (
              <li key={g.name}>
                <Editor draft={editing.draft} isNew={false} ad={data.ad} busy={busy} onChange={(draft) => setEditing({ index: i, draft })} onSave={() => void saveDraft()} onCancel={() => { setEditing(null); setError('') }} />
              </li>
            ) : (
              <li key={g.name} className="rounded-lg border border-white/[0.06] px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-zinc-100">
                      {g.label || g.name} <span className="ml-1 font-mono text-[11px] font-normal text-zinc-500">{g.name}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {t.criteria(g.hosts.length, g.ad_ou.length, g.identities.length)} · {t.members(g.members.length)}
                    </p>
                  </div>
                  {canEdit && !editing && (
                    removing === g.name ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-zinc-300">{t.confirmRemove(g.label || g.name)}</span>
                        <button type="button" disabled={busy} onClick={() => void remove(g.name)} className={DANGER}>{t.confirmYes}</button>
                        <button type="button" onClick={() => setRemoving(null)} className={QUIET}>{t.cancel}</button>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => { setEditing({ index: i, draft: draftOf(g) }); setError(''); setNotice('') }} className={QUIET}>
                          <PencilSimple size={12} aria-hidden /> {t.edit}
                        </button>
                        <button type="button" onClick={() => setRemoving(g.name)} className={DANGER}>
                          <Trash size={12} aria-hidden className="inline align-[-2px]" /> {t.remove}
                        </button>
                      </div>
                    )
                  )}
                </div>
                {g.members.length > 0 ? (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[11px] text-zinc-400 hover:text-zinc-100">{t.membersToggle}</summary>
                    <p className="mt-1 break-words font-mono text-[11px] text-zinc-400">{g.members.join(' · ')}</p>
                  </details>
                ) : (
                  <p className="mt-1 text-[11px] text-zinc-600">{t.noMembers}</p>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {data && data.ungrouped.length > 0 && <p className="mt-3 text-[11px] text-zinc-500">{t.ungrouped(data.ungrouped.length)}</p>}
    </div>
  )
}
