'use client'

// Ajustes · Avisos externos: the engine's notification channels — email,
// Telegram, Slack and ntfy — edited as a draft: each with its name, its
// minimum severity and its destination; secrets are write-only (a stored
// one shows as «guardado» and an empty field keeps it). One save the
// engine applies without restarting, and a test message per channel or
// for all. Honest states: no -notify (501), read-only, file changed (409).
import { useCallback, useEffect, useState } from 'react'
import { PaperPlaneTilt, Plus, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useConsoleUser } from '@/components/console/user-session'
import {
  channelPayload,
  channelProblems,
  emptyChannel,
  fetchNotifySettings,
  MAX_NOTIFY_CHANNELS,
  NOTIFY_SEVERITIES,
  NOTIFY_TYPES,
  notifyDirty,
  parseRecipients,
  secretStored,
  statsFor,
  testNotify,
  updateNotifySettings,
  type NotifyChannel,
  type NotifySettings,
  type NotifyTestResult,
  type NotifyType,
} from '@/lib/notify-settings'
import { Empty } from '../home/parts'
import { Group, Notice } from './parts'

type Load = { kind: 'loading' } | { kind: 'ok' } | { kind: 'off' } | { kind: 'restricted' } | { kind: 'error'; error: string }

export function NotifyChannels({ onNotice }: { onNotice: (message: string) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.settingsView
  const a = dict.settings.avisos
  const me = useConsoleUser()
  const canWrite = !me.pending && me.role === 'admin'
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [saved, setSaved] = useState<NotifySettings | null>(null)
  const [consoleURL, setConsoleURL] = useState('')
  const [channels, setChannels] = useState<NotifyChannel[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [results, setResults] = useState<Record<string, NotifyTestResult | 'sending'>>({})

  const apply = useCallback((s: NotifySettings) => {
    setSaved(s)
    setConsoleURL(s.console_url)
    setChannels(s.channels.map((c) => ({ ...c })))
  }, [])

  useEffect(() => {
    let alive = true
    void fetchNotifySettings().then((r) => {
      if (!alive) return
      if (r.ok) {
        apply(r.data)
        setLoad({ kind: 'ok' })
      } else setLoad(r.status === 501 || r.status === 404 ? { kind: 'off' } : r.status === 403 ? { kind: 'restricted' } : { kind: 'error', error: r.error })
    })
    return () => {
      alive = false
    }
  }, [apply])

  if (load.kind === 'loading') return <p className="v2-small v2-dim">{a.loading}</p>
  if (load.kind === 'off') return <Empty title={t.states.off}>{a.unarmed}</Empty>
  if (load.kind === 'restricted') return <Empty title={t.states.restricted}>{t.restrictedHint}</Empty>
  if (load.kind === 'error') return <Notice tone="error">{load.error}</Notice>

  const problems = channelProblems(channels)
  const invalid = problems.filter(Boolean).length
  const dirty = notifyDirty(saved, consoleURL, channels)
  const set = (i: number, patch: Partial<NotifyChannel>) => setChannels((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  async function save() {
    setBusy(true)
    setError('')
    const r = await updateNotifySettings(consoleURL, channels.map(channelPayload))
    setBusy(false)
    if (r.ok) {
      apply(r.data)
      setConflict(false)
      onNotice(a.saved)
    } else if (r.status === 409) setConflict(true)
    else setError(r.status === 403 ? t.readOnly : r.error)
  }

  async function test(name = '') {
    setResults((x) => ({ ...x, ...(name ? { [name]: 'sending' } : Object.fromEntries(channels.map((c) => [c.name, 'sending' as const]))) }))
    const r = await testNotify(name)
    if (r.ok) setResults((x) => ({ ...x, ...Object.fromEntries(r.data.results.map((res) => [res.name, res])) }))
    else {
      setError(r.error)
      setResults((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== 'sending')))
    }
  }

  const secretField = (ch: NotifyChannel, i: number, key: 'token' | 'password' | 'url', label: string) => (
    <label className="v2-field">
      <span>{label}</span>
      <input
        className="v2-input v2-mono"
        type="password"
        autoComplete="new-password"
        value={(ch[key] as string | undefined) ?? ''}
        placeholder={secretStored(ch) ? a.secretKept : ''}
        disabled={!canWrite}
        onChange={(e) => set(i, { [key]: e.target.value, clear_secret: false })}
      />
      {secretStored(ch) && canWrite && (
        <button type="button" className="v2-link v2-small" onClick={() => set(i, { clear_secret: true, [key]: '' })}>
          {a.clearSecret}
        </button>
      )}
    </label>
  )
  const text = (ch: NotifyChannel, i: number, key: keyof NotifyChannel, label: string, hint?: string) => (
    <label className="v2-field">
      <span>{label}</span>
      <input className="v2-input" value={(ch[key] as string | undefined) ?? ''} disabled={!canWrite} onChange={(e) => set(i, { [key]: e.target.value })} />
      {hint && <small className="v2-dim">{hint}</small>}
    </label>
  )

  return (
    <div className="v2-set-stack">
      <div className="v2-set-head">
        <h2>{t.avTitle}</h2>
        <p className="v2-small v2-dim">{a.prose}</p>
      </div>
      {!canWrite && <Notice>{t.notAdmin}</Notice>}
      {conflict && <Notice tone="warn">{a.conflict}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <Group id="v2-nt-url" title={a.consoleUrl} hint={a.consoleUrlHint}>
        <input className="v2-input v2-mono v2-nt-url" value={consoleURL} disabled={!canWrite} onChange={(e) => setConsoleURL(e.target.value)} placeholder="https://soc.empresa.local" aria-label={a.consoleUrl} />
      </Group>

      {channels.length === 0 && <p className="v2-small v2-dim">{a.empty}</p>}
      <ul className="v2-nt-list">
        {channels.map((ch, i) => {
          const st = saved ? statsFor(saved.stats, ch) : null
          const res = results[ch.name]
          return (
            <li key={i} className="v2-nt-card" data-type={ch.type}>
              <header>
                <span className="v2-tag">{a.types[ch.type]}</span>
                {canWrite && (
                  <button type="button" className="v2-icon-btn" aria-label={a.removeAria(ch.name)} title={a.remove} onClick={() => setChannels((list) => list.filter((_, j) => j !== i))}>
                    <Trash aria-hidden="true" />
                  </button>
                )}
              </header>
              <p className="v2-small v2-dim">{st ? a.stats(st.sent, st.failed, st.filtered) : a.notRunning}</p>
              <div className="v2-nt-fields">
                {text(ch, i, 'name', a.name)}
                <label className="v2-field">
                  <span>{a.minSeverity}</span>
                  <select className="v2-input" value={ch.min_severity} disabled={!canWrite} onChange={(e) => set(i, { min_severity: e.target.value as NotifyChannel['min_severity'] })}>
                    {NOTIFY_SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {a.severities[s]}
                      </option>
                    ))}
                  </select>
                </label>
                {ch.type === 'slack' && secretField(ch, i, 'url', a.fields.slackUrl)}
                {ch.type === 'ntfy' && (
                  <>
                    {text(ch, i, 'url', a.fields.ntfyUrl, a.fields.ntfyUrlHint)}
                    {text(ch, i, 'topic', a.fields.topic, a.fields.topicHint)}
                    {secretField(ch, i, 'token', a.fields.token)}
                    {text(ch, i, 'token_env', a.fields.tokenEnv)}
                  </>
                )}
                {ch.type === 'telegram' && (
                  <>
                    {secretField(ch, i, 'token', a.fields.botToken)}
                    {text(ch, i, 'token_env', a.fields.tokenEnv)}
                    {text(ch, i, 'chat_id', a.fields.chatId)}
                    {text(ch, i, 'api_url', a.fields.apiUrl)}
                  </>
                )}
                {ch.type === 'email' && (
                  <>
                    {text(ch, i, 'server', a.fields.server)}
                    {text(ch, i, 'from', a.fields.from)}
                    <label className="v2-field v2-nt-wide">
                      <span>{a.fields.to}</span>
                      <input className="v2-input" value={(ch.to ?? []).join(', ')} disabled={!canWrite} onChange={(e) => set(i, { to: parseRecipients(e.target.value) })} />
                      <small className="v2-dim">{a.fields.toHint}</small>
                    </label>
                    {text(ch, i, 'username', a.fields.username)}
                    {secretField(ch, i, 'password', a.fields.password)}
                    {text(ch, i, 'password_env', a.fields.passwordEnv)}
                    <label className="v2-check">
                      <input type="checkbox" checked={!!ch.starttls} disabled={!canWrite} onChange={(e) => set(i, { starttls: e.target.checked })} />
                      {a.fields.starttls}
                    </label>
                  </>
                )}
              </div>
              {problems[i] && <p className="v2-small v2-warn">{a.problems[problems[i] as keyof typeof a.problems]}</p>}
              <footer>
                {canWrite && (
                  <button type="button" className="v2-btn" aria-label={a.testAria(ch.name)} disabled={dirty || res === 'sending'} onClick={() => void test(ch.name)}>
                    <PaperPlaneTilt aria-hidden="true" />
                    {res === 'sending' ? a.testing : a.test}
                  </button>
                )}
                {res && res !== 'sending' && (
                  <span className="v2-nt-result" data-ok={res.ok}>
                    {res.ok ? a.testOk : a.testFailed(res.error ?? '')}
                  </span>
                )}
              </footer>
            </li>
          )
        })}
      </ul>

      {canWrite && (
        <div className="v2-nt-bar">
          <div className="v2-actions">
            {NOTIFY_TYPES.map((type: NotifyType) => (
              <button
                key={type}
                type="button"
                className="v2-btn"
                disabled={channels.length >= MAX_NOTIFY_CHANNELS}
                onClick={() => setChannels((list) => [...list, emptyChannel(type, list.map((c) => c.name))])}
              >
                <Plus aria-hidden="true" />
                {a.add} · {a.types[type]}
              </button>
            ))}
          </div>
          {channels.length >= MAX_NOTIFY_CHANNELS && <p className="v2-small v2-dim">{a.maxReached(MAX_NOTIFY_CHANNELS)}</p>}
          <div className="v2-actions">
            <button type="button" className="v2-btn v2-btn-primary" disabled={!dirty || invalid > 0 || busy} onClick={() => void save()}>
              {busy ? a.saving : a.save}
            </button>
            {dirty && (
              <button type="button" className="v2-btn" onClick={() => saved && apply(saved)}>
                {a.discard}
              </button>
            )}
            <button type="button" className="v2-btn" disabled={dirty || channels.length === 0} onClick={() => void test()}>
              {a.testAll}
            </button>
            {dirty && <span className="v2-small v2-dim">{a.saveFirst}</span>}
            {invalid > 0 && <span className="v2-small v2-warn">{a.invalid(invalid)}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
