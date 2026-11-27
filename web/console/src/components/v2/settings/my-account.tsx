'use client'

// Ajustes · Mi cuenta: who is signed in, how, with which role and over
// which machines, what that role allows, the two-step sign-in, and the
// preferences of this browser — the language and the system notification
// of new critical alerts (with an optional tone), which every v2 page
// honours.
import { useEffect, useState } from 'react'
import { Check, Minus } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { currentPermission, playNotifyTone, readNotifyPrefs, writeNotifyPrefs, type NotifyPermission, type NotifyPrefs } from '@/lib/alert-notify'
import { mfaText, modeText, permissions, roleText, scopeText } from '@/lib/console-user'
import { NOTIFY_PREFS_EVENT } from '../critical-alerts'
import { Group, Notice, Toggle } from './parts'

export function MyAccount() {
  const { dict, lang, setLang } = useI18n()
  const t = dict.v2.settingsView
  const me = useConsoleUser()
  const [prefs, setPrefs] = useState<NotifyPrefs>({ enabled: false, sound: false })
  const [permission, setPermission] = useState<NotifyPermission>('default')
  const [storageError, setStorageError] = useState(false)

  useEffect(() => {
    setPrefs(readNotifyPrefs(window.localStorage))
    setPermission(currentPermission())
  }, [])

  async function update(next: NotifyPrefs) {
    if (next.enabled && !prefs.enabled && currentPermission() === 'default') setPermission(await Notification.requestPermission())
    setPrefs(next)
    setStorageError(!writeNotifyPrefs(window.localStorage, next))
    window.dispatchEvent(new Event(NOTIFY_PREFS_EVENT))
  }

  if (me.pending) return <p className="v2-small v2-dim">{t.states.loading}</p>
  const mfa = me.mfa ? mfaText(me.mfa, lang) : null

  return (
    <div className="v2-set-two">
      <div className="v2-set-col">
        <Group id="v2-me-who" title={t.meTitle}>
          <div className="v2-me-head">
            <span className="v2-me-avatar" aria-hidden="true">
              {(me.name || '?').slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong className="v2-mono">{me.name || '—'}</strong>
              <span className="v2-tag">{roleText(me.role, lang)}</span>
            </div>
          </div>
          <dl className="v2-fields">
            <div>
              <dt>{t.meMode}</dt>
              <dd>{modeText(me, lang)}</dd>
            </div>
            <div>
              <dt>{t.meScope}</dt>
              <dd>{scopeText(me, lang)}</dd>
            </div>
          </dl>
          {me.mode === 'users' && (
            <div className="v2-actions">
              <a className="v2-btn" href="/cuenta/contrasena">
                {dict.settings.cuentas.changePassword}
              </a>
              <form method="post" action="/api/console/logout">
                <button type="submit" className="v2-btn">
                  {t.meSignOut}
                </button>
              </form>
            </div>
          )}
        </Group>
        <Group id="v2-me-perms" title={t.mePerms}>
          <ul className="v2-me-perms">
            {permissions(me, lang).map((p) => (
              <li key={p.label} data-allowed={p.allowed}>
                {p.allowed ? <Check aria-hidden="true" /> : <Minus aria-hidden="true" />}
                {p.label}
              </li>
            ))}
          </ul>
        </Group>
        {mfa && (
          <Group id="v2-me-mfa" title={t.meTwoStep}>
            <p className="v2-small" data-warn={mfa.warn}>
              <strong>{mfa.label}</strong> · <span className="v2-dim">{mfa.detail}</span>
            </p>
            <a className="v2-btn v2-me-mfa" href="/cuenta/dos-pasos">
              {t.meTwoStepSetup}
            </a>
          </Group>
        )}
      </div>

      <div className="v2-set-col">
        <Group id="v2-me-prefs" title={t.mePrefs}>
          <div className="v2-field">
            <span>{t.meLang}</span>
            <div className="v2-seg" role="group" aria-label={t.meLang}>
              {(['es', 'en'] as const).map((l) => (
                <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
                  {l === 'es' ? dict.settings.general.langEs : dict.settings.general.langEn}
                </button>
              ))}
            </div>
          </div>
          <div className="v2-me-notify">
            <Toggle checked={prefs.enabled} onChange={(v) => void update({ ...prefs, enabled: v })} label={t.meNotify} />
            <p className="v2-small v2-dim">{t.meNotifyHint}</p>
            {/* the tone rides on the alerts toggle (as in the classic bell), and still sounds where the browser refuses notifications */}
            <Toggle checked={prefs.sound} disabled={!prefs.enabled} onChange={(v) => void update({ ...prefs, sound: v })} label={t.meSound} />
            <button type="button" className="v2-link v2-small" onClick={() => playNotifyTone()}>
              {t.meTestSound}
            </button>
            <p className="v2-small" data-permission={permission}>
              {t.mePermission[permission] ?? permission}
            </p>
            {storageError && <Notice tone="warn">{dict.notify.storageError}</Notice>}
          </div>
        </Group>
      </div>
    </div>
  )
}
