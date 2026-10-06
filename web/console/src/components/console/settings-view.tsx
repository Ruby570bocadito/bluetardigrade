'use client'

// Settings (SET-1): the sections the TODO names on one page — General,
// Ingesta, Active Directory (AD-6), Integraciones, Notificaciones, Cuentas
// and Apariencia. The AD section is the only one with a write API today
// (GET/PUT /api/settings/ad + POST /api/ad/test): the form edits a draft,
// only the changed fields travel, the password is write-only and the
// honest states mirror the directory view (501 not armed -> candidate can
// be probed but not saved; 403 -> the family is closed; 409 -> the -ad
// file drifted on disk). Every other section shows the real signal the
// console already has (engine stats, enrollment, session) and declares
// that its configuration has no write API yet — nothing is invented.

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, Globe, Monitor, Moon, Sun, Warning } from '@phosphor-icons/react'
import { Switch } from '@/components/ui/switch'
import { useEngine } from './engine-provider'
import { useFleet } from './fleet-provider'
import { useI18n } from './i18n-provider'
import type { Lang } from '@/lib/i18n'
import { currentPermission, playNotifyTone, readNotifyPrefs, writeNotifyPrefs, type NotifyPermission, type NotifyPrefs } from '@/lib/alert-notify'
import { fetchMe, type ConsoleMe } from '@/lib/console-user'
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
import { applyTheme, resolveTheme, THEME_STORAGE_KEY, type ThemeChoice } from '@/lib/theme'
import type { ConsoleView } from './dashboard'

const inputCls =
  'h-8 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const hintCls = 'mt-1 block text-[10px] leading-relaxed text-zinc-500'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-zinc-400">
      {label}
      {children}
      {hint && <span className={hintCls}>{hint}</span>}
    </label>
  )
}

function Panel({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="panel px-5 py-4">
      <h3 className="mb-3 text-sm font-medium text-zinc-100">{heading}</h3>
      {children}
    </div>
  )
}

const chipCls = 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium'

function StateChip({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return (
    <span className={`${chipCls} ${ok ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 bg-zinc-800/40 text-zinc-400'}`}>
      <CheckCircle size={11} aria-hidden /> {ok ? on : off}
    </span>
  )
}

// ---------------------------------------------------------------------------
// General: organization/timezone have no API (declared), the language is a
// real local preference.

function GeneralPanel() {
  const { dict, lang, setLang } = useI18n()
  const options: { id: Lang; label: string }[] = [
    { id: 'es', label: dict.settings.general.langEs },
    { id: 'en', label: dict.settings.general.langEn },
  ]
  return (
    <Panel heading={dict.settings.general.heading}>
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">{dict.settings.general.prose}</p>
      <div className="max-w-md">
        <p className="text-xs text-zinc-400">{dict.settings.general.langLabel}</p>
        <div role="group" aria-label={dict.settings.general.langLabel} className="mt-1.5 flex gap-1.5">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={lang === o.id}
              onClick={() => setLang(o.id)}
              className={`rounded-md border px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                lang === o.id ? 'border-primary/40 bg-primary-tint/15 text-primary-soft' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className={hintCls}>{dict.settings.general.langProse}</p>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Ingesta: the real enrollment/store signal plus honest no-write-API prose.

function IngestPanel({ onNavigate }: { onNavigate: (view: ConsoleView) => void }) {
  const { dict } = useI18n()
  const { stats } = useEngine()
  const { enroll } = useFleet()
  return (
    <Panel heading={dict.settings.ingesta.heading}>
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">{dict.settings.ingesta.prose}</p>
      <ul className="mb-3 space-y-1.5 text-xs text-zinc-300">
        <li className="flex items-center gap-2">
          {enroll?.enabled ? <CheckCircle size={13} aria-hidden className="text-emerald-400" /> : <Warning size={13} aria-hidden className="text-zinc-500" />}
          {enroll ? (enroll.enabled ? dict.settings.ingesta.enrollOn : dict.settings.ingesta.enrollOff) : dict.settings.ingesta.enrollOff}
        </li>
        {enroll && (
          <>
            <li className="pl-5 text-zinc-500">{dict.settings.ingesta.usableTokens(enroll.usable_tokens)}</li>
            <li className="pl-5 text-zinc-500">{dict.settings.ingesta.pendingHosts(enroll.pending)}</li>
            <li className="pl-5 text-zinc-500">{dict.settings.ingesta.activeHosts(enroll.active)}</li>
          </>
        )}
        <li className="flex items-center gap-2">
          {stats?.store_enabled ? <CheckCircle size={13} aria-hidden className="text-emerald-400" /> : <Warning size={13} aria-hidden className="text-zinc-500" />}
          {stats?.store_enabled ? dict.settings.ingesta.storeOn : dict.settings.ingesta.storeOff}
        </li>
      </ul>
      <div className="flex gap-2">
        <button type="button" onClick={() => onNavigate('equipos')} className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {dict.settings.ingesta.openHosts}
        </button>
        <button type="button" onClick={() => onNavigate('estado')} className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {dict.settings.ingesta.openEstado}
        </button>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Integraciones: delivery counters the engine already publishes; the
// configuration of every channel has no write API yet.

function CounterRow({ label, sent, failed, dropped, filtered }: { label: string; sent?: number; failed?: number; dropped?: number; filtered?: number }) {
  const { dict } = useI18n()
  const any = (sent ?? 0) + (failed ?? 0) + (dropped ?? 0) + (filtered ?? 0) > 0
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-xs font-medium text-zinc-200">{label}</span>
      {any ? (
        <span className="flex flex-wrap gap-x-3 text-[11px] tabular-nums text-zinc-500">
          {dict.settings.integraciones.delivered(sent ?? 0)}
          {dict.settings.integraciones.failed(failed ?? 0)}
          {dict.settings.integraciones.dropped(dropped ?? 0)}
          {filtered !== undefined && dict.settings.integraciones.filtered(filtered)}
        </span>
      ) : (
        <span className="text-[11px] text-zinc-500">{dict.settings.integraciones.quiet}</span>
      )}
    </li>
  )
}

function IntegrationsPanel() {
  const { dict } = useI18n()
  const { stats } = useEngine()
  return (
    <Panel heading={dict.settings.integraciones.heading}>
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">{dict.settings.integraciones.prose}</p>
      <ul className="space-y-2">
        <CounterRow label={dict.settings.integraciones.webhook} sent={stats?.webhook_sent} failed={stats?.webhook_failed} dropped={stats?.webhook_dropped} />
        <CounterRow label={dict.settings.integraciones.elastic} sent={stats?.elastic_sent} failed={stats?.elastic_failed} dropped={stats?.elastic_dropped} />
        <CounterRow label={dict.settings.integraciones.splunk} sent={stats?.splunk_sent} failed={stats?.splunk_failed} dropped={stats?.splunk_dropped} />
        {(stats?.notify_channels ?? []).map((ch) => (
          <CounterRow key={`${ch.type}:${ch.name}`} label={`${ch.name} (${ch.type})`} sent={ch.sent} failed={ch.failed} dropped={ch.dropped} filtered={ch.filtered} />
        ))}
      </ul>
      {(stats?.notify_channels?.length ?? 0) > 0 && <p className={`mt-2 ${hintCls}`}>{dict.settings.integraciones.channelsHeading}</p>}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Notificaciones: the same browser preference the header bell owns, edited
// in place (shared storage keys, shared dictionary strings).

function NotificationsPanel() {
  const { dict } = useI18n()
  const [prefs, setPrefs] = useState<NotifyPrefs>({ enabled: false, sound: false })
  const [permission, setPermission] = useState<NotifyPermission>('default')
  const [storageError, setStorageError] = useState(false)

  useEffect(() => {
    setPrefs(readNotifyPrefs(window.localStorage))
    setPermission(currentPermission())
  }, [])

  const update = async (next: NotifyPrefs) => {
    if (next.enabled && !prefs.enabled && currentPermission() === 'default') {
      setPermission(await Notification.requestPermission())
    }
    setPrefs(next)
    setStorageError(!writeNotifyPrefs(window.localStorage, next))
  }

  return (
    <Panel heading={dict.settings.notificaciones.heading}>
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">{dict.notify.prose}</p>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-zinc-300">{dict.notify.browserToggle}</span>
          <Switch checked={prefs.enabled} onCheckedChange={(v) => void update({ ...prefs, enabled: v })} aria-label={dict.notify.browserToggleAria} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-zinc-300">{dict.notify.soundToggle}</span>
          <Switch checked={prefs.sound} onCheckedChange={(v) => void update({ ...prefs, sound: v })} aria-label={dict.notify.soundToggleAria} />
        </div>
      </div>
      {permission === 'denied' && <p role="alert" className="mt-2.5 text-[11px] text-amber-300">{dict.notify.denied}</p>}
      {permission === 'unsupported' && <p className="mt-2.5 text-[11px] text-zinc-500">{dict.notify.unsupported}</p>}
      {storageError && <p role="alert" className="mt-2.5 text-[11px] text-amber-300">{dict.notify.storageError}</p>}
      <button type="button" onClick={playNotifyTone} className="mt-3 text-[11px] text-primary-link underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {dict.notify.testSound}
      </button>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Cuentas: who the console service says the operator is; management
// (TEAM-2) has no API and the page says so.

function AccountsPanel({ onOpenOnboarding }: { onOpenOnboarding: () => void }) {
  const { dict } = useI18n()
  const [me, setMe] = useState<ConsoleMe | null>(null)
  useEffect(() => {
    const alive = { current: true }
    void fetchMe().then((next) => {
      if (alive.current && next) setMe(next)
    })
    return () => {
      alive.current = false
    }
  }, [])
  const modeText = me ? (me.mode === 'users' ? dict.settings.cuentas.modeUsers : me.mode === 'token' ? dict.settings.cuentas.modeToken : dict.settings.cuentas.modeOpen) : null
  return (
    <Panel heading={dict.settings.cuentas.heading}>
      {me ? (
        <dl className="mb-3 grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">{dict.settings.cuentas.accountLabel}</dt>
            <dd className="mt-0.5 font-medium text-zinc-100">{me.name}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">{dict.settings.cuentas.roleLabel}</dt>
            <dd className="mt-0.5 font-medium text-zinc-100">
              {dict.settings.cuentas.roles[me.role]} <span className="ml-1 font-normal text-zinc-500">· {modeText}</span>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mb-3 text-xs text-zinc-500">{dict.settings.cuentas.accountLabel}: …</p>
      )}
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">{dict.settings.cuentas.manageProse}</p>
      <button type="button" onClick={onOpenOnboarding} className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {dict.settings.cuentas.openOnboarding}
      </button>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Apariencia: the theme choice, same storage key and event as the header
// toggle, offered as an explicit three-way pick.

const THEME_OPTIONS: readonly ThemeChoice[] = ['system', 'light', 'dark']
const THEME_ICONS: Record<ThemeChoice, React.ElementType> = { system: Monitor, light: Sun, dark: Moon }

function AppearancePanel() {
  const { dict } = useI18n()
  const [choice, setChoice] = useState<ThemeChoice>('system')
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      setChoice(resolveTheme(stored, typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches) === stored ? (stored as ThemeChoice) : 'system')
    } catch {
      setChoice('system')
    }
  }, [])
  const pick = (next: ThemeChoice) => {
    setChoice(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Private mode or full storage: the theme still flips for this session.
    }
    applyTheme(resolveTheme(next, typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches))
  }
  return (
    <Panel heading={dict.settings.apariencia.heading}>
      <div className="max-w-md">
        <p className="text-xs text-zinc-400">{dict.settings.apariencia.themeLabel}</p>
        <div role="group" aria-label={dict.settings.apariencia.themeLabel} className="mt-1.5 flex gap-1.5">
          {THEME_OPTIONS.map((option) => {
            const Icon = THEME_ICONS[option]
            const active = choice === option
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => pick(option)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? 'border-primary/40 bg-primary-tint/15 text-primary-soft' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100'
                }`}
              >
                <Icon size={13} aria-hidden /> {dict.settings.apariencia.themes[option]}
              </button>
            )
          })}
        </div>
        <p className={hintCls}>{dict.settings.apariencia.themeProse}</p>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Active Directory (AD-6): the only write surface of the page.

type AdPhase = 'loading' | 'forbidden' | 'unarmed' | 'error' | 'ready'

function AdSettingsPanel() {
  const { dict } = useI18n()
  const [phase, setPhase] = useState<AdPhase>('loading')
  const [current, setCurrent] = useState<ADSettings | null>(null)
  const [draft, setDraft] = useState<ADSettingsDraft>(emptyDraft)
  const [loadError, setLoadError] = useState('')
  const [password, setPassword] = useState('')
  const [actionError, setActionError] = useState('')
  const [invalidCount, setInvalidCount] = useState(0)
  const [probing, setProbing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [probe, setProbe] = useState<ADTestResult | null>(null)

  const reload = async () => {
    setPhase('loading')
    setLoadError('')
    setActionError('')
    setProbe(null)
    const res = await fetchADSettings()
    if (res.ok) {
      setCurrent(res.data)
      setDraft(draftFromSettings(res.data))
      setPhase('ready')
      return
    }
    setCurrent(null)
    setDraft(emptyDraft())
    setPassword('')
    if (res.status === 501) {
      setPhase('unarmed')
      return
    }
    if (res.status === 403) {
      setPhase('forbidden')
      setLoadError(res.error)
      return
    }
    setPhase('error')
    setLoadError(res.error)
  }

  useEffect(() => {
    void reload()
  }, [])

  const dirty = useMemo(() => adDirtyFields(current, draft), [current, draft])
  const set = <K extends keyof ADSettingsDraft>(key: K, value: ADSettingsDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const runProbe = async () => {
    setActionError('')
    setProbe(null)
    const { update, invalid } = draftPayload(current, draft, password)
    if (invalid.length > 0) {
      setInvalidCount(invalid.length)
      return
    }
    setInvalidCount(0)
    setProbing(true)
    const res = await testADConnection(update)
    setProbing(false)
    if (!res.ok) {
      setActionError(res.error)
      return
    }
    setProbe(res.data)
  }

  const runSave = async () => {
    setActionError('')
    setProbe(null)
    const { update, invalid } = draftPayload(current, draft, password)
    if (invalid.length > 0) {
      setInvalidCount(invalid.length)
      return
    }
    setInvalidCount(0)
    setSaving(true)
    const res = await updateADSettings(update)
    setSaving(false)
    if (!res.ok) {
      setActionError(res.error)
      return
    }
    setPassword('')
    setCurrent(res.data)
    setDraft(draftFromSettings(res.data))
  }

  if (phase === 'loading') {
    return (
      <Panel heading={dict.settings.ad.heading}>
        <p className="text-xs text-zinc-500">{dict.settings.ad.loading}</p>
      </Panel>
    )
  }
  if (phase === 'forbidden' || phase === 'error') {
    return (
      <Panel heading={dict.settings.ad.heading}>
        <p role="alert" className="text-xs text-red-300">{loadError}</p>
      </Panel>
    )
  }
  const unarmed = phase === 'unarmed'

  return (
    <div className="panel px-5 py-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-zinc-100">{dict.settings.ad.heading}</h3>
        {current && (
          <>
            <StateChip ok={current.password_stored} on={dict.settings.ad.passwordStored} off={dict.settings.ad.passwordMissing} />
            <StateChip ok={current.ca_file_present} on={dict.settings.ad.caPresent} off={dict.settings.ad.caMissing} />
          </>
        )}
        <span className={`ml-auto ${chipCls} ${dirty.length > 0 ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-zinc-700 bg-zinc-800/40 text-zinc-400'}`}>
          {dirty.length > 0 ? dict.settings.ad.dirtyChip : dict.settings.ad.cleanChip}
        </span>
      </div>
      {unarmed && (
        <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2 text-xs text-amber-200/90">
          <p className="font-medium">{dict.settings.ad.notArmed}</p>
          <p className="mt-1 leading-relaxed">{dict.settings.ad.notArmedProse}</p>
          <p className="mt-1 leading-relaxed">{dict.settings.ad.probeOnly}</p>
        </div>
      )}
      {current?.reload_pending && (
        <p role="status" className="mb-3 rounded-lg border border-primary/20 bg-primary-tint/[0.06] px-3 py-2 text-xs text-primary-soft">
          {dict.settings.ad.reloadPending}
        </p>
      )}
      {current?.last_reload_error && (
        <p role="alert" className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2 text-xs text-amber-200/90">
          {dict.settings.ad.reloadError}
        </p>
      )}

      <form
        aria-label={unarmed ? dict.settings.ad.candidateAria : dict.settings.ad.formAria}
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          void runSave()
        }}
      >
        <fieldset className="space-y-3">
          <legend className="mb-1 text-xs font-medium text-zinc-300">{dict.settings.ad.connHeading}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label={dict.settings.ad.server} hint={dict.settings.ad.serverHint}>
                <input value={draft.server} onChange={(e) => set('server', e.target.value)} maxLength={255} autoComplete="off" className={`mt-1 ${inputCls}`} />
              </Field>
            </div>
            <Field label={dict.settings.ad.port} hint={dict.settings.ad.portHint}>
              <input value={draft.port} onChange={(e) => set('port', e.target.value)} inputMode="numeric" maxLength={5} autoComplete="off" className={`mt-1 ${inputCls}`} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={draft.start_tls} onChange={(e) => set('start_tls', e.target.checked)} className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 accent-zinc-400" />
            {dict.settings.ad.startTls}
          </label>
          <Field label={dict.settings.ad.baseDn} hint={dict.settings.ad.baseDnHint}>
            <input value={draft.base_dn} onChange={(e) => set('base_dn', e.target.value)} maxLength={255} autoComplete="off" className={`mt-1 ${inputCls}`} />
          </Field>
          <Field label={dict.settings.ad.caFile} hint={dict.settings.ad.caFileHint}>
            <input value={draft.ca_file} onChange={(e) => set('ca_file', e.target.value)} maxLength={500} autoComplete="off" className={`mt-1 ${inputCls}`} />
          </Field>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-xs font-medium text-zinc-300">{dict.settings.ad.credHeading}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={dict.settings.ad.bindDn}>
              <input value={draft.bind_dn} onChange={(e) => set('bind_dn', e.target.value)} maxLength={255} autoComplete="off" className={`mt-1 ${inputCls}`} />
            </Field>
            <Field label={dict.settings.ad.passwordFile}>
              <input value={draft.password_file} onChange={(e) => set('password_file', e.target.value)} maxLength={500} autoComplete="off" className={`mt-1 ${inputCls}`} />
            </Field>
          </div>
          <Field label={dict.settings.ad.password} hint={dict.settings.ad.passwordHint}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={500}
              autoComplete="new-password"
              className={`mt-1 ${inputCls}`}
            />
          </Field>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-xs font-medium text-zinc-300">{dict.settings.ad.syncHeading}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={dict.settings.ad.interval} hint={dict.settings.ad.intervalHint}>
              <input value={draft.interval_seconds} onChange={(e) => set('interval_seconds', e.target.value)} inputMode="numeric" maxLength={6} className={`mt-1 ${inputCls}`} />
            </Field>
            <Field label={dict.settings.ad.maxObjects}>
              <input value={draft.max_objects} onChange={(e) => set('max_objects', e.target.value)} inputMode="numeric" maxLength={9} className={`mt-1 ${inputCls}`} />
            </Field>
            <Field label={dict.settings.ad.pageSize}>
              <input value={draft.page_size} onChange={(e) => set('page_size', e.target.value)} inputMode="numeric" maxLength={4} className={`mt-1 ${inputCls}`} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={dict.settings.ad.includeOus} hint={dict.settings.ad.ousHint}>
              <textarea value={draft.include_ous} onChange={(e) => set('include_ous', e.target.value)} rows={2} maxLength={8000} className="block w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </Field>
            <Field label={dict.settings.ad.excludeOus} hint={dict.settings.ad.ousHint}>
              <textarea value={draft.exclude_ous} onChange={(e) => set('exclude_ous', e.target.value)} rows={2} maxLength={8000} className="block w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-xs font-medium text-zinc-300">{dict.settings.ad.thrHeading}</legend>
          <p className={`${hintCls} mb-1`}>{dict.settings.ad.workHeadingNote}</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={dict.settings.ad.inactiveDays}>
              <input value={draft.inactive_days} onChange={(e) => set('inactive_days', e.target.value)} inputMode="numeric" maxLength={5} className={`mt-1 ${inputCls}`} />
            </Field>
            <Field label={dict.settings.ad.krbtgtDays}>
              <input value={draft.krbtgt_max_age_days} onChange={(e) => set('krbtgt_max_age_days', e.target.value)} inputMode="numeric" maxLength={5} className={`mt-1 ${inputCls}`} />
            </Field>
            <Field label={dict.settings.ad.workStart}>
              <input type="time" value={draft.work_start} onChange={(e) => set('work_start', e.target.value)} className={`mt-1 ${inputCls}`} />
            </Field>
            <Field label={dict.settings.ad.workEnd}>
              <input type="time" value={draft.work_end} onChange={(e) => set('work_end', e.target.value)} className={`mt-1 ${inputCls}`} />
            </Field>
          </div>
          <div>
            <p className="text-xs text-zinc-400">{dict.settings.ad.workDays}</p>
            <div role="group" aria-label={dict.settings.ad.workDays} className="mt-1.5 flex flex-wrap gap-1.5">
              {WORK_DAYS.map((day) => {
                const active = draft.work_days[day]
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={active}
                    onClick={() => set('work_days', draft.work_days.map((v, i) => (i === day ? !v : v)))}
                    className={`rounded-md border px-2 py-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active ? 'border-primary/40 bg-primary-tint/15 text-primary-soft' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    {dict.settings.ad.dayNames[day]}
                  </button>
                )
              })}
            </div>
          </div>
        </fieldset>

        {invalidCount > 0 && (
          <p role="alert" className="text-xs text-amber-300">{dict.settings.ad.invalidFields(invalidCount)}</p>
        )}
        {actionError && (
          <p role="alert" className="text-xs text-red-300">{actionError}</p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
          <button
            type="button"
            onClick={() => void runProbe()}
            disabled={probing}
            aria-label={dict.settings.ad.testButtonAria}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary-tint/10 px-2.5 py-1.5 text-xs font-medium text-primary-soft hover:bg-primary-tint/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Globe size={13} aria-hidden /> {probing ? dict.settings.ad.probing : dict.settings.ad.probe}
          </button>
          {!unarmed && (
            <button
              type="submit"
              disabled={saving || (dirty.length === 0 && !password.trim())}
              aria-label={dict.settings.ad.saveButtonAria}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary-strong px-3 py-1.5 text-xs font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {saving ? dict.settings.ad.saving : dict.settings.ad.save}
            </button>
          )}
          <p className="ml-auto max-w-md text-[10px] leading-relaxed text-zinc-500">{dict.settings.ad.probeNote}</p>
        </div>
      </form>

      {probe && (
        <div className="mt-4 rounded-lg border border-white/[0.06] bg-zinc-950/40 p-3">
          <p className={`flex items-center gap-2 text-xs font-medium ${probe.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
            {probe.ok ? <CheckCircle size={14} aria-hidden /> : <Warning size={14} aria-hidden />}
            {probe.ok ? dict.settings.ad.probeOk : dict.settings.ad.probeBad}
            <span className="ml-auto font-normal tabular-nums text-zinc-500">{dict.settings.ad.probeDuration(String(probe.duration_ms))}</span>
          </p>
          {!probe.ok && probe.error && (
            <p className="mt-1.5 text-xs text-zinc-400">
              <span className="text-zinc-500">{dict.settings.ad.probeErrorLabel}: </span>
              {probe.error}
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-zinc-500">
            {probe.tls_version ? dict.settings.ad.probeTls(probe.tls_version, probe.cipher_suite) : dict.settings.ad.probeStartTls}
          </p>
          <p className="mt-1 font-mono text-[11px] text-zinc-400">
            {probe.bind_dn} → {probe.base_dn}
          </p>
          <ul className="mt-2 space-y-1">
            {probe.kinds.map((k) => (
              <li key={k.kind} className="text-[11px] text-zinc-300">
                <span className="font-medium">{dict.settings.ad.probeKinds[k.kind]}</span>
                <span className="ml-2 tabular-nums text-zinc-500">
                  {dict.settings.ad.probeRead(k.count)}
                  {k.truncated ? ` · ${dict.settings.ad.probeAtLeast(k.count)}` : ''}
                </span>
                {k.sample_dns.length > 0 && (
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-600">
                    {dict.settings.ad.probeSampleHeading}: {k.sample_dns.slice(0, 5).join(' · ')}
                    {k.sample_dns.length > 5 ? ' …' : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function SettingsView({ onNavigate, onOpenOnboarding }: { onNavigate: (view: ConsoleView) => void; onOpenOnboarding: () => void }) {
  const { dict } = useI18n()
  return (
    <section aria-label={dict.settings.sectionAria} className="space-y-4">
      <p className="text-xs text-zinc-500">{dict.settings.noWriteApi}</p>
      <GeneralPanel />
      <IngestPanel onNavigate={onNavigate} />
      <AdSettingsPanel />
      <IntegrationsPanel />
      <NotificationsPanel />
      <AccountsPanel onOpenOnboarding={onOpenOnboarding} />
      <AppearancePanel />
      <p className="text-xs text-zinc-500">{dict.settings.adminNote}</p>
    </section>
  )
}
