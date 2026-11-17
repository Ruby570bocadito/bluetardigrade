'use client'

// Ajustes · Grupos de equipos: the groups the engine uses to scope
// accounts and to group the fleet, edited as drafts — a label, name
// patterns (SRV-*, WS-0??), Active Directory OUs and ingest identities —
// with a live preview of the known machines each group's patterns take
// now, and the machines no group takes. Saved in one write the engine
// applies at once (the OU and identity criteria resolve there).
import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { useFleet } from '@/components/console/fleet-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { draftOf, fetchHostGroups, groupOf, nameFromLabel, parseLines, saveHostGroups, type GroupDraft, type HostGroupsPayload } from '@/lib/host-groups'
import { previewGroups } from '@/lib/v2/settings-model'
import { Empty } from '../home/parts'
import { Notice } from './parts'

export function HostGroups({ onNotice }: { onNotice: (message: string) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.settingsView
  const g = dict.settings.grupos
  const me = useConsoleUser()
  const { events, alerts } = useEngine()
  const { fleet } = useFleet()
  const [payload, setPayload] = useState<HostGroupsPayload | null>(null)
  const [drafts, setDrafts] = useState<GroupDraft[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [arming, setArming] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    void fetchHostGroups().then((r) => {
      if (!alive) return
      if (r.ok) {
        setPayload(r.data)
        setDrafts(r.data.groups.map(draftOf))
      } else setLoadError(r.error)
    })
    return () => {
      alive = false
    }
  }, [])

  const hosts = useMemo(
    () => [...new Set([...(fleet?.hosts ?? []).map((h) => h.host), ...events.map((e) => e.host), ...alerts.map((a) => a.host)].filter(Boolean))],
    [fleet, events, alerts],
  )
  const preview = useMemo(() => previewGroups(drafts.map((d) => parseLines(d.hosts)), hosts), [drafts, hosts])

  if (loadError) return <Notice tone="error">{loadError}</Notice>
  if (!payload) return <p className="v2-small v2-dim">{g.loading}</p>
  if (!payload.enabled) return <Empty title={t.states.off}>{g.notArmed}</Empty>
  const canWrite = payload.writable && !me.pending && me.role === 'admin'
  const savedJson = JSON.stringify(payload.groups.map((x) => groupOf(draftOf(x))))
  const dirty = JSON.stringify(drafts.map(groupOf)) !== savedJson
  const set = (i: number, patch: Partial<GroupDraft>) => setDrafts((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  async function save() {
    setBusy(true)
    setError('')
    const r = await saveHostGroups(drafts.map(groupOf))
    setBusy(false)
    if (!r.ok) return setError(r.status === 403 ? t.readOnly : r.error)
    setPayload(r.data)
    setDrafts(r.data.groups.map(draftOf))
    onNotice(g.saved)
  }

  return (
    <div className="v2-set-stack">
      <div className="v2-set-head">
        <h2>{t.grTitle}</h2>
        <p className="v2-small v2-dim">{g.prose}</p>
      </div>
      {!payload.writable && <Notice tone="warn">{g.readOnly}</Notice>}
      {payload.writable && me.role !== 'admin' && <Notice>{g.notAdmin}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {drafts.length === 0 && <p className="v2-small v2-dim">{g.empty}</p>}

      <ul className="v2-gr-list">
        {drafts.map((d, i) => {
          const saved = payload.groups.find((x) => x.name === d.name)
          return (
            <li key={i} className="v2-gr-row">
              <div className="v2-gr-form">
                <div className="v2-gr-top">
                  <label className="v2-field">
                    <span>{g.fieldLabel}</span>
                    <input
                      className="v2-input"
                      value={d.label}
                      disabled={!canWrite}
                      onChange={(e) => set(i, { label: e.target.value, ...(saved ? {} : { name: nameFromLabel(e.target.value) }) })}
                    />
                  </label>
                  <label className="v2-field">
                    <span>{g.fieldName}</span>
                    <input className="v2-input v2-mono" value={d.name} disabled={!canWrite || !!saved} onChange={(e) => set(i, { name: e.target.value })} />
                    <small className="v2-dim">{g.fieldNameHint}</small>
                  </label>
                  {canWrite && (
                    <button
                      type="button"
                      className="v2-link v2-small v2-gr-del"
                      data-armed={arming === i}
                      onClick={() => {
                        if (arming !== i) return setArming(i)
                        setArming(null)
                        setDrafts((list) => list.filter((_, j) => j !== i))
                      }}
                    >
                      <Trash aria-hidden="true" />
                      {arming === i ? g.confirmYes : g.remove}
                    </button>
                  )}
                </div>
                <label className="v2-field">
                  <span>{g.fieldHosts}</span>
                  <textarea className="v2-input v2-textarea v2-mono" rows={2} value={d.hosts} disabled={!canWrite} onChange={(e) => set(i, { hosts: e.target.value })} placeholder="SRV-*" />
                  <small className="v2-dim">{g.fieldHostsHint}</small>
                </label>
                <div className="v2-gr-two">
                  <label className="v2-field">
                    <span>{g.fieldOUs}</span>
                    <textarea className="v2-input v2-textarea v2-mono" rows={2} value={d.ad_ou} disabled={!canWrite} onChange={(e) => set(i, { ad_ou: e.target.value })} />
                    <small className="v2-dim">{payload.ad ? g.fieldOUsHint : g.noAD}</small>
                  </label>
                  <label className="v2-field">
                    <span>{g.fieldIdentities}</span>
                    <textarea className="v2-input v2-textarea v2-mono" rows={2} value={d.identities} disabled={!canWrite} onChange={(e) => set(i, { identities: e.target.value })} />
                    <small className="v2-dim">{g.fieldIdentitiesHint}</small>
                  </label>
                </div>
              </div>
              <aside className="v2-gr-preview" aria-label={t.grPreview}>
                <span className="v2-eyebrow">{t.grPreview}</span>
                {preview.perGroup[i].length === 0 ? (
                  <p className="v2-small v2-dim">{t.grNoHosts}</p>
                ) : (
                  <ul className="v2-gr-hosts">
                    {preview.perGroup[i].map((h) => (
                      <li key={h} className="v2-mono">
                        {h}
                      </li>
                    ))}
                  </ul>
                )}
                {saved && <p className="v2-small v2-dim">{g.members(saved.members.length)}</p>}
                <p className="v2-small v2-dim">{t.grPreviewDraft}</p>
              </aside>
            </li>
          )
        })}
      </ul>

      <section className="v2-rep-block" aria-labelledby="v2-gr-none">
        <h3 id="v2-gr-none" className="v2-eyebrow">
          {g.ungrouped(preview.ungrouped.length)}
        </h3>
        <p className="v2-small v2-dim">{t.grUngroupedHint}</p>
        {preview.ungrouped.length > 0 && (
          <ul className="v2-gr-hosts">
            {preview.ungrouped.map((h) => (
              <li key={h} className="v2-mono">
                {h}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWrite && (
        <div className="v2-actions">
          <button type="button" className="v2-btn" onClick={() => setDrafts((list) => [...list, { name: '', label: '', hosts: '', ad_ou: '', identities: '' }])}>
            <Plus aria-hidden="true" />
            {g.add}
          </button>
          <button type="button" className="v2-btn v2-btn-primary" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? g.saving : g.save}
          </button>
          {dirty && (
            <button type="button" className="v2-btn" onClick={() => setDrafts(payload.groups.map(draftOf))}>
              {g.cancel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
