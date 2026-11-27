'use client'

// Ajustes · Directorio activo: the Active Directory connector as a form
// grouped by what it sets (connection, service account, sync, thresholds
// and working hours) next to the connection test, which saves nothing:
// it opens the connector's own TLS connection, binds and samples what the
// account can read. Only the changed fields travel; the password is
// write-only. Not armed (501): nothing to edit or test, as in the classic
// console — the probe and the save both need the armed surface.
import { useEffect, useMemo, useState } from 'react'
import { PlugsConnected } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { fetchADStatus, type ADStatus } from '@/lib/directory'
import { useConsoleUser } from '@/components/console/user-session'
import {
  adDirtyFields,
  draftFromSettings,
  draftPayload,
  emptyDraft,
  fetchADSettings,
  testADConnection,
  updateADSettings,
  WORK_DAYS,
  type ADSettings,
  type ADSettingsDraft,
  type ADTestResult,
} from '@/lib/settings'
import { Empty } from '../home/parts'
import { Group, Notice } from './parts'

type Phase = 'loading' | 'ready' | 'unarmed' | 'forbidden' | 'error'

export function Directory({ onNotice }: { onNotice: (message: string) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.settingsView
  const d = dict.settings.ad
  const me = useConsoleUser()
  const canWrite = !me.pending && me.role === 'admin'
  const [phase, setPhase] = useState<Phase>('loading')
  const [current, setCurrent] = useState<ADSettings | null>(null)
  const [sync, setSync] = useState<ADStatus | null>(null)
  const [draft, setDraft] = useState<ADSettingsDraft>(emptyDraft())
  const [password, setPassword] = useState('')
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState(0)
  const [probe, setProbe] = useState<ADTestResult | null>(null)
  const [probing, setProbing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void fetchADSettings().then((res) => {
      if (!alive) return
      if (res.ok) {
        setCurrent(res.data)
        setDraft(draftFromSettings(res.data))
        setPhase('ready')
        void fetchADStatus().then((st) => alive && st.ok && setSync(st.data))
      } else if (res.status === 501) setPhase('unarmed')
      else {
        setLoadError(res.error)
        setPhase(res.status === 403 ? 'forbidden' : 'error')
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const dirty = useMemo(() => adDirtyFields(current, draft), [current, draft])
  const set = <K extends keyof ADSettingsDraft>(key: K, value: ADSettingsDraft[K]) => setDraft((x) => ({ ...x, [key]: value }))

  if (phase === 'loading') return <p className="v2-small v2-dim">{d.loading}</p>
  if (phase === 'forbidden') return <Empty title={t.states.restricted}>{t.restrictedHint}</Empty>
  if (phase === 'error') return <Notice tone="error">{loadError}</Notice>
  if (phase === 'unarmed') return <Empty title={d.notArmed}>{d.notArmedProse}</Empty>

  async function runProbe() {
    setError('')
    setProbe(null)
    const { update, invalid: bad } = draftPayload(current, draft, password)
    setInvalid(bad.length)
    if (bad.length) return
    setProbing(true)
    const res = await testADConnection(update)
    setProbing(false)
    if (res.ok) setProbe(res.data)
    else setError(res.error)
  }
  async function runSave() {
    setError('')
    setProbe(null)
    const { update, invalid: bad } = draftPayload(current, draft, password)
    setInvalid(bad.length)
    if (bad.length) return
    setSaving(true)
    const res = await updateADSettings(update)
    setSaving(false)
    if (!res.ok) return setError(res.status === 409 ? d.reloadError : res.error)
    setPassword('')
    setCurrent(res.data)
    setDraft(draftFromSettings(res.data))
    onNotice(t.saved)
  }

  const disabled = !canWrite
  const c = dict.directory.connector
  const fmt = new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' })
  const when = (iso: string | null) => (iso ? fmt.format(new Date(iso)) : c.noneYet)
  const field = (key: keyof ADSettingsDraft, label: string, hint?: string, props: { type?: string; inputMode?: 'numeric' } = {}) => (
    <label className="v2-field">
      <span>{label}</span>
      <input className="v2-input" value={draft[key] as string} disabled={disabled} onChange={(e) => set(key, e.target.value as never)} autoComplete="off" {...props} />
      {hint && <small className="v2-dim">{hint}</small>}
    </label>
  )
  const area = (key: 'include_ous' | 'exclude_ous', label: string) => (
    <label className="v2-field v2-ad-wide">
      <span>{label}</span>
      <textarea className="v2-input v2-textarea v2-mono" rows={3} value={draft[key]} disabled={disabled} onChange={(e) => set(key, e.target.value)} />
      <small className="v2-dim">{d.ousHint}</small>
    </label>
  )

  return (
    <div className="v2-set-two v2-ad">
      <form
        className="v2-set-col"
        aria-label={d.formAria}
        onSubmit={(e) => {
          e.preventDefault()
          void runSave()
        }}
      >
        <div className="v2-set-head">
          <h2>{t.adTitle}</h2>
          {!canWrite && <Notice>{t.notAdmin}</Notice>}
          {current?.reload_pending && <Notice>{d.reloadPending}</Notice>}
          {current?.last_reload_error && <Notice tone="warn">{d.reloadError}</Notice>}
        </div>
        <Group id="v2-ad-conn" title={d.connHeading}>
          <div className="v2-ad-grid">
            {field('server', d.server, d.serverHint)}
            {field('port', d.port, d.portHint, { inputMode: 'numeric' })}
            <label className="v2-check v2-ad-wide">
              <input type="checkbox" checked={draft.start_tls} disabled={disabled} onChange={(e) => set('start_tls', e.target.checked)} />
              {d.startTls}
            </label>
            {field('base_dn', d.baseDn, d.baseDnHint)}
            <label className="v2-field">
              <span>{d.caFile}</span>
              <input className="v2-input v2-mono" value={draft.ca_file} readOnly aria-readonly="true" />
              <small className="v2-dim">
                {current ? (current.ca_file_present ? d.caPresent : d.caMissing) : d.caFileHint}. {d.pathFixed}
              </small>
            </label>
          </div>
        </Group>
        <Group id="v2-ad-cred" title={d.credHeading}>
          <div className="v2-ad-grid">
            {field('bind_dn', d.bindDn)}
            <label className="v2-field">
              <span>{d.password}</span>
              <input className="v2-input" type="password" autoComplete="new-password" value={password} disabled={disabled} onChange={(e) => setPassword(e.target.value)} />
              <small className="v2-dim">{current?.password_stored ? d.passwordStored : d.passwordMissing}. {d.passwordHint}</small>
            </label>
            {current && (
              <label className="v2-field v2-ad-wide">
                <span>{d.passwordFile}</span>
                <input className="v2-input v2-mono" value={draft.password_file} readOnly aria-readonly="true" />
                <small className="v2-dim">{d.pathFixed}</small>
              </label>
            )}
          </div>
        </Group>
        <Group id="v2-ad-sync" title={d.syncHeading}>
          <div className="v2-ad-grid">
            {field('interval_seconds', d.interval, d.intervalHint, { inputMode: 'numeric' })}
            {field('max_objects', d.maxObjects, undefined, { inputMode: 'numeric' })}
            {field('page_size', d.pageSize, undefined, { inputMode: 'numeric' })}
            {area('include_ous', d.includeOus)}
            {area('exclude_ous', d.excludeOus)}
          </div>
        </Group>
        <Group id="v2-ad-thr" title={d.thrHeading} hint={d.workHeadingNote}>
          <div className="v2-ad-grid">
            {field('inactive_days', d.inactiveDays, undefined, { inputMode: 'numeric' })}
            {field('krbtgt_max_age_days', d.krbtgtDays, undefined, { inputMode: 'numeric' })}
            {field('work_start', d.workStart, undefined, { type: 'time' })}
            {field('work_end', d.workEnd, undefined, { type: 'time' })}
            <fieldset className="v2-ad-days v2-ad-wide">
              <legend className="v2-small">{d.workDays}</legend>
              {WORK_DAYS.map((day) => (
                <label key={day} className="v2-check">
                  <input
                    type="checkbox"
                    checked={draft.work_days[day]}
                    disabled={disabled}
                    onChange={(e) => set('work_days', draft.work_days.map((v, i) => (i === day ? e.target.checked : v)))}
                  />
                  {d.dayNames[day]}
                </label>
              ))}
            </fieldset>
          </div>
        </Group>
        {invalid > 0 && <Notice tone="warn">{d.invalidFields(invalid)}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="v2-ad-actions">
          <span className="v2-ad-chip" data-dirty={dirty.length > 0 || password !== ''}>
            {dirty.length > 0 || password !== '' ? d.dirtyChip : d.cleanChip}
          </span>
          <button type="button" className="v2-btn" aria-label={d.testButtonAria} disabled={probing || !canWrite} onClick={() => void runProbe()}>
            <PlugsConnected aria-hidden="true" />
            {probing ? d.probing : d.probe}
          </button>
          <button
            type="submit"
            className="v2-btn v2-btn-primary"
            aria-label={d.saveButtonAria}
            disabled={!canWrite || saving || (dirty.length === 0 && password === '')}
          >
            {saving ? d.saving : d.save}
          </button>
        </div>
      </form>

      <aside className="v2-set-col v2-ad-probe" aria-live="polite">
        {sync && (
          <Group id="v2-ad-sync-state" title={c.title}>
            <p className="v2-small">
              <strong>{sync.connected ? c.connected : c.disconnected}</strong>
            </p>
            <dl className="v2-fields">
              <div>
                <dt>{c.lastAttempt}</dt>
                <dd>{when(sync.last_sync_at)}</dd>
              </div>
              <div>
                <dt>{c.lastSuccess}</dt>
                <dd>{when(sync.last_success_at)}</dd>
              </div>
              <div>
                <dt>{c.next}</dt>
                <dd>{sync.next_sync_at ? when(sync.next_sync_at) : c.stopped}</dd>
              </div>
            </dl>
            {sync.last_error && (
              <p className="v2-small v2-warn">
                {c.lastError}
                <span className="v2-mono">{sync.last_error}</span>
              </p>
            )}
          </Group>
        )}
        <Group id="v2-ad-probe" title={d.probe} hint={d.probeNote}>
          {!probe ? (
            <p className="v2-small v2-dim">{probing ? d.probing : t.adNoProbe}</p>
          ) : (
            <div className="v2-ad-result" data-ok={probe.ok}>
              <strong>{probe.ok ? d.probeOk : d.probeBad}</strong>
              {probe.error && (
                <p className="v2-small">
                  {d.probeErrorLabel}: <span className="v2-mono">{probe.error}</span>
                </p>
              )}
              <p className="v2-small v2-dim">
                {probe.tls_version ? `${d.probeTls(probe.tls_version, probe.cipher_suite)} · ` : probe.ok ? `${d.probeStartTls} · ` : ''}
                {d.probeDuration(String(probe.duration_ms))}
              </p>
              {probe.kinds.length > 0 && (
                <>
                  <h4 className="v2-eyebrow">{d.probeKindsHeading}</h4>
                  <ul className="v2-ad-kinds">
                    {probe.kinds.map((k) => (
                      <li key={k.kind}>
                        <span>{d.probeKinds[k.kind]}</span>
                        <b className="v2-mono">{k.truncated ? d.probeAtLeast(k.count) : d.probeRead(k.count)}</b>
                      </li>
                    ))}
                  </ul>
                  <h4 className="v2-eyebrow">{d.probeSampleHeading}</h4>
                  <ul className="v2-ad-samples">
                    {probe.kinds
                      .flatMap((k) => k.sample_dns.slice(0, 2))
                      .slice(0, 8)
                      .map((dn) => (
                        <li key={dn} className="v2-mono v2-small">
                          {dn}
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </Group>
      </aside>
    </div>
  )
}
