'use client'

// Ajustes -> Avisos externos (F3): the engine's notification channels
// (lib/notify-settings.ts) edited as a draft — add, edit, remove, a
// minimum severity per channel, the console address that puts the alert
// link in every message — saved in one PUT that the engine applies
// without a restart, and «Enviar prueba» per channel or for all.
// Secrets are write-only: a stored one shows as «guardado» and an empty
// field keeps it. Honest states as in the Active Directory panel: 501
// (no -notify), 403 (no -api-write), 409 (the file was edited on disk).

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, Megaphone, PaperPlaneTilt, Plus, Trash, WarningCircle } from '@phosphor-icons/react'
import { PanelHeading } from './ui-bits'
import { useI18n } from './i18n-provider'
import {
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

const inputCls =
  'h-8 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const hintCls = 'mt-1 block text-[10px] leading-relaxed text-zinc-500'
const quietBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

type Phase = 'loading' | 'ready' | 'unarmed' | 'forbidden' | 'error'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-zinc-400">
      {label}
      <span className="mt-1 block">{children}</span>
      {hint && <span className={hintCls}>{hint}</span>}
    </label>
  )
}

export function NotifySettingsPanel() {
  const { dict } = useI18n()
  const t = dict.settings.avisos
  const [phase, setPhase] = useState<Phase>('loading')
  const [saved, setSaved] = useState<NotifySettings | null>(null)
  const [consoleURL, setConsoleURL] = useState('')
  const [channels, setChannels] = useState<NotifyChannel[]>([])
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, NotifyTestResult>>({})
  const [showProblems, setShowProblems] = useState(false)

  const adopt = (s: NotifySettings) => {
    setSaved(s)
    setConsoleURL(s.console_url)
    setChannels(s.channels.map((c) => ({ ...c, to: c.to ?? [] })))
  }

  useEffect(() => {
    void (async () => {
      const res = await fetchNotifySettings()
      if (res.ok) {
        adopt(res.data)
        setPhase('ready')
      } else if (res.status === 501) setPhase('unarmed')
      else {
        setPhase(res.status === 403 ? 'forbidden' : 'error')
        setMessage({ tone: 'error', text: res.error })
      }
    })()
  }, [])

  const problems = useMemo(() => channelProblems(channels), [channels])
  const invalid = problems.filter(Boolean).length
  const dirty = notifyDirty(saved, consoleURL, channels)

  const edit = (i: number, patch: Partial<NotifyChannel>) => setChannels((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const add = (type: NotifyType) => setChannels((cs) => [...cs, emptyChannel(type, cs.map((c) => c.name))])
  const remove = (i: number) => setChannels((cs) => cs.filter((_, j) => j !== i))

  const save = async () => {
    setMessage(null)
    if (invalid > 0) {
      setShowProblems(true)
      return
    }
    setSaving(true)
    const res = await updateNotifySettings(consoleURL, channels)
    setSaving(false)
    if (!res.ok) {
      setMessage({ tone: 'error', text: res.status === 409 ? t.conflict : res.error })
      return
    }
    adopt(res.data)
    setShowProblems(false)
    setResults({})
    setMessage({ tone: 'ok', text: t.saved })
  }

  const runTest = async (name: string) => {
    setTesting(name || '*')
    setMessage(null)
    const res = await testNotify(name)
    setTesting(null)
    if (!res.ok) {
      setMessage({ tone: 'error', text: res.error })
      return
    }
    setResults((prev) => {
      const next = { ...prev }
      for (const r of res.data.results) next[r.name] = r
      return next
    })
  }

  const heading = <PanelHeading icon={Megaphone} className="mb-2">{t.heading}</PanelHeading>
  if (phase !== 'ready') {
    return (
      <div data-area="connect" className="panel px-5 py-4">
        {heading}
        {phase === 'loading' && <p className="text-xs text-zinc-500">{t.loading}</p>}
        {phase === 'unarmed' && <p className="text-xs leading-relaxed text-zinc-400">{t.unarmed}</p>}
        {(phase === 'forbidden' || phase === 'error') && message && <p role="alert" className="text-xs text-red-300">{message.text}</p>}
      </div>
    )
  }

  return (
    <div data-area="connect" className="panel px-5 py-4">
      {heading}
      <p className="mb-4 text-xs leading-relaxed text-zinc-500">{t.prose}</p>

      <div className="max-w-xl">
        <Field label={t.consoleUrl} hint={t.consoleUrlHint}>
          <input className={inputCls} value={consoleURL} onChange={(e) => setConsoleURL(e.target.value)} placeholder="https://soc.empresa.local" inputMode="url" spellCheck={false} />
        </Field>
      </div>

      <ul className="mt-4 space-y-3" aria-label={t.heading}>
        {channels.length === 0 && <li className="rounded-lg border border-dashed border-zinc-800 px-4 py-5 text-center text-xs text-zinc-500">{t.empty}</li>}
        {channels.map((ch, i) => {
          const problem = showProblems ? problems[i] : null
          const st = saved ? statsFor(saved.stats, ch) : null
          const result = results[ch.name]
          const running = !!st
          return (
            <li key={i} className={`rounded-xl border px-4 py-3 ${problem ? 'border-amber-400/40' : 'border-zinc-800'} bg-zinc-950/40`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-primary/30 bg-primary-tint/10 px-1.5 py-0.5 text-[11px] font-medium text-primary-soft">{t.types[ch.type]}</span>
                <span className="text-[11px] tabular-nums text-zinc-500">{st ? t.stats(st.sent, st.failed, st.filtered) : t.notRunning}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <button type="button" className={quietBtn} disabled={!running || dirty || testing !== null} title={dirty ? t.saveFirst : undefined} aria-label={t.testAria(ch.name)} onClick={() => void runTest(ch.name)}>
                    <PaperPlaneTilt size={13} aria-hidden /> {testing === ch.name ? t.testing : t.test}
                  </button>
                  <button type="button" className={quietBtn} aria-label={t.removeAria(ch.name)} onClick={() => remove(i)}>
                    <Trash size={13} aria-hidden /> {t.remove}
                  </button>
                </span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label={t.name}>
                  <input className={inputCls} value={ch.name} onChange={(e) => edit(i, { name: e.target.value })} maxLength={64} />
                </Field>
                <Field label={t.minSeverity}>
                  <select className={inputCls} value={ch.min_severity} onChange={(e) => edit(i, { min_severity: e.target.value as NotifyChannel['min_severity'] })}>
                    {NOTIFY_SEVERITIES.map((s) => (
                      <option key={s} value={s}>{t.severities[s]}</option>
                    ))}
                  </select>
                </Field>
                <ChannelFields ch={ch} onEdit={(patch) => edit(i, patch)} />
              </div>

              {problem && <p role="alert" className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-300"><WarningCircle size={13} aria-hidden /> {t.problems[problem]}</p>}
              {result && (
                <p role="status" className={`mt-2 flex items-center gap-1.5 text-[11px] ${result.ok ? 'text-emerald-300' : 'text-red-300'}`}>
                  {result.ok ? <CheckCircle size={13} aria-hidden /> : <WarningCircle size={13} aria-hidden />}
                  {result.ok ? t.testOk : t.testFailed(result.error ?? '')}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] text-zinc-500">{t.add}:</span>
        {NOTIFY_TYPES.map((type) => (
          <button key={type} type="button" className={quietBtn} disabled={channels.length >= MAX_NOTIFY_CHANNELS} onClick={() => add(type)}>
            <Plus size={12} aria-hidden /> {t.types[type]}
          </button>
        ))}
        {channels.length >= MAX_NOTIFY_CHANNELS && <span className="text-[11px] text-zinc-500">{t.maxReached(MAX_NOTIFY_CHANNELS)}</span>}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
        <button type="button" onClick={() => void save()} disabled={!dirty || saving} className="inline-flex items-center gap-1.5 rounded-md bg-primary-strong px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-tint disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {saving ? t.saving : t.save}
        </button>
        {dirty && (
          <button type="button" className={quietBtn} onClick={() => saved && adopt(saved)}>
            {t.discard}
          </button>
        )}
        <button type="button" className={quietBtn} disabled={dirty || testing !== null || !(saved?.stats.length)} onClick={() => void runTest('')}>
          <PaperPlaneTilt size={13} aria-hidden /> {testing === '*' ? t.testing : t.testAll}
        </button>
        {dirty && <span className="text-[11px] text-zinc-500">{t.saveFirst}</span>}
        {showProblems && invalid > 0 && <span role="alert" className="text-[11px] text-amber-300">{t.invalid(invalid)}</span>}
        {message && (
          <span role={message.tone === 'error' ? 'alert' : 'status'} className={`text-[11px] ${message.tone === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  )
}

// The secret input of a channel: empty with «guardado» when the engine
// holds one, and the button that drops it.
function SecretField({ label, ch, value, onChange, onClear }: { label: string; ch: NotifyChannel; value: string; onChange: (v: string) => void; onClear?: () => void }) {
  const { dict } = useI18n()
  const t = dict.settings.avisos
  const stored = secretStored(ch)
  return (
    <Field label={label}>
      <input className={inputCls} type="password" autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} placeholder={stored ? t.secretKept : ''} spellCheck={false} />
      {stored && onClear && (
        <button type="button" onClick={onClear} className="mt-1 text-[10px] text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline">
          {t.clearSecret}
        </button>
      )}
    </Field>
  )
}

function ChannelFields({ ch, onEdit }: { ch: NotifyChannel; onEdit: (patch: Partial<NotifyChannel>) => void }) {
  const { dict } = useI18n()
  const f = dict.settings.avisos.fields
  const text = (key: keyof NotifyChannel, label: string, opts: { hint?: string; placeholder?: string; mono?: boolean } = {}) => (
    <Field label={label} hint={opts.hint}>
      <input className={`${inputCls} ${opts.mono ? 'font-mono' : ''}`} value={(ch[key] as string | undefined) ?? ''} onChange={(e) => onEdit({ [key]: e.target.value })} placeholder={opts.placeholder} spellCheck={false} />
    </Field>
  )
  switch (ch.type) {
    case 'slack':
      return ch.url_set ? (
        // the hook URL is required: a new one replaces it, empty keeps it
        <SecretField label={f.slackUrl} ch={ch} value={ch.url ?? ''} onChange={(v) => onEdit({ url: v })} />
      ) : (
        text('url', f.slackUrl, { placeholder: 'https://hooks.slack.com/services/…', mono: true })
      )
    case 'ntfy':
      return (
        <>
          {text('url', f.ntfyUrl, { hint: f.ntfyUrlHint, placeholder: 'https://ntfy.sh', mono: true })}
          {text('topic', f.topic, { hint: f.topicHint, placeholder: 'soc-alertas', mono: true })}
          <SecretField label={f.token} ch={ch} value={ch.token ?? ''} onChange={(v) => onEdit({ token: v, clear_secret: false })} onClear={() => onEdit({ token: '', token_set: false, clear_secret: true })} />
          {text('token_env', f.tokenEnv, { placeholder: 'SF_NTFY_TOKEN', mono: true })}
        </>
      )
    case 'telegram':
      return (
        <>
          <SecretField label={f.botToken} ch={ch} value={ch.token ?? ''} onChange={(v) => onEdit({ token: v, clear_secret: false })} onClear={() => onEdit({ token: '', token_set: false, clear_secret: true })} />
          {text('token_env', f.tokenEnv, { placeholder: 'SF_TELEGRAM_TOKEN', mono: true })}
          {text('chat_id', f.chatId, { placeholder: '-1001234567890', mono: true })}
          {text('api_url', f.apiUrl, { placeholder: 'https://api.telegram.org', mono: true })}
        </>
      )
    case 'email':
      return (
        <>
          {text('server', f.server, { placeholder: 'smtp.empresa.local:587', mono: true })}
          {text('from', f.from, { placeholder: 'bluetardigrade@empresa.local' })}
          <RecipientsField label={f.to} hint={f.toHint} value={ch.to ?? []} onChange={(to) => onEdit({ to })} />
          {text('username', f.username)}
          <SecretField label={f.password} ch={ch} value={ch.password ?? ''} onChange={(v) => onEdit({ password: v, clear_secret: false })} onClear={() => onEdit({ password: '', password_set: false, clear_secret: true })} />
          {text('password_env', f.passwordEnv, { placeholder: 'SF_SMTP_PASSWORD', mono: true })}
          <label className="flex items-center gap-2 self-end pb-1.5 text-xs text-zinc-400">
            <input type="checkbox" checked={ch.starttls ?? true} onChange={(e) => onEdit({ starttls: e.target.checked })} className="accent-[var(--primary)]" />
            {f.starttls}
          </label>
        </>
      )
  }
}

// Recipients are typed as free text (commas and all) and parsed on the
// way out, so a half-typed «a@b, » is not rewritten under the cursor.
function RecipientsField({ label, hint, value, onChange }: { label: string; hint: string; value: string[]; onChange: (to: string[]) => void }) {
  const [text, setText] = useState(value.join(', '))
  return (
    <Field label={label} hint={hint}>
      <input
        className={inputCls}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(parseRecipients(e.target.value))
        }}
        placeholder="soc@empresa.local, guardia@empresa.local"
        spellCheck={false}
      />
    </Field>
  )
}
