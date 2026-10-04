'use client'

// Critical-alert notifications: a header control (bell) with the
// per-browser preference, a browser Notification for each batch of new
// open critical alerts and an optional short tone. Off by default; the
// permission prompt only appears when the operator turns it on.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellSlash, SpeakerHigh } from '@phosphor-icons/react'
import { Switch } from '@/components/ui/switch'
import { useEngine } from './engine-provider'
import { HeaderPopover } from './header-popover'
import { alertKey } from '@/lib/engine-client'
import { newCriticalAlerts, notificationText, readNotifyPrefs, writeNotifyPrefs, type NotifyPrefs } from '@/lib/alert-notify'

type Permission = NotificationPermission | 'unsupported'

function currentPermission(): Permission {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
}

/** Two short descending tones through WebAudio (no audio asset). */
function playTone() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const at = ctx.currentTime
    for (const [i, freq] of [880, 660].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, at + i * 0.18)
      gain.gain.exponentialRampToValueAtTime(0.18, at + i * 0.18 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.18 + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at + i * 0.18)
      osc.stop(at + i * 0.18 + 0.17)
    }
    setTimeout(() => void ctx.close(), 600)
  } catch {
    // audio is a courtesy; a blocked context must never break the console
  }
}

export function NotifyMenu() {
  const { alerts, status } = useEngine()
  const [prefs, setPrefs] = useState<NotifyPrefs>({ enabled: false, sound: false })
  const [permission, setPermission] = useState<Permission>('default')
  const [open, setOpen] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const seenRef = useRef<Set<string> | null>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])

  // Read after mount: the server render never knows the browser state.
  useEffect(() => {
    setPrefs(readNotifyPrefs(window.localStorage))
    setPermission(currentPermission())
  }, [])

  // An outage restarts the baseline: reconnecting never replays alerts.
  useEffect(() => {
    if (status !== 'live') seenRef.current = null
  }, [status])

  useEffect(() => {
    if (status !== 'live') return
    const { fresh, seen } = newCriticalAlerts(alerts, seenRef.current, alertKey)
    seenRef.current = seen
    if (!prefs.enabled || fresh.length === 0) return
    if (permission === 'granted') {
      const { title, body } = notificationText(fresh)
      try {
        const toast = new Notification(title, { body, tag: 'bluetardigrade-critical', icon: '/icon.svg' })
        toast.onclick = () => { window.focus(); toast.close() }
      } catch {
        // some browsers only allow notifications from a service worker
      }
    }
    if (prefs.sound) playTone()
  }, [alerts, status, prefs, permission])

  const update = async (next: NotifyPrefs) => {
    if (next.enabled && !prefs.enabled && currentPermission() === 'default') {
      setPermission(await Notification.requestPermission())
    }
    setPrefs(next)
    setStorageError(!writeNotifyPrefs(window.localStorage, next))
  }

  const active = prefs.enabled && (permission === 'granted' || prefs.sound)
  const Icon = active ? Bell : BellSlash
  return (
    <div className="shrink-0">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Avisos de alertas críticas"
        title={active ? 'Avisos de alertas críticas activados' : 'Avisos de alertas críticas desactivados'}
        className={`chip px-2 py-1.5 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'text-blue-300' : 'text-zinc-500'}`}
      >
        <Icon size={15} weight={active ? 'fill' : 'regular'} aria-hidden />
      </button>
      <HeaderPopover anchorRef={anchorRef} open={open} onClose={close} label="Preferencias de avisos" className="w-72 p-3">
          <p className="text-sm font-medium text-zinc-100">Avisos de alertas críticas</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">Solo para alertas críticas nuevas y sin cerrar, mientras esta pestaña esté abierta. La preferencia se guarda en este navegador.</p>
          <label className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-200">
            <span className="flex items-center gap-2"><Bell size={14} aria-hidden className="text-zinc-400" /> Notificación del navegador</span>
            <Switch checked={prefs.enabled} onCheckedChange={(v) => void update({ ...prefs, enabled: v })} aria-label="Notificación del navegador para alertas críticas" />
          </label>
          <label className="mt-2.5 flex items-center justify-between gap-3 text-xs text-zinc-200">
            <span className="flex items-center gap-2"><SpeakerHigh size={14} aria-hidden className="text-zinc-400" /> Sonido</span>
            <Switch checked={prefs.sound} onCheckedChange={(v) => void update({ ...prefs, sound: v })} aria-label="Sonido para alertas críticas" />
          </label>
          {prefs.enabled && permission === 'denied' && (
            <p role="alert" className="mt-2.5 text-[11px] text-amber-300">El navegador bloqueó las notificaciones para este sitio: permítelas en el icono del candado de la barra de direcciones.</p>
          )}
          {permission === 'unsupported' && <p className="mt-2.5 text-[11px] text-zinc-500">Este navegador no admite notificaciones; el sonido sí funciona.</p>}
          {storageError && <p role="alert" className="mt-2.5 text-[11px] text-amber-300">No se pudo guardar la preferencia en este navegador; dura hasta recargar.</p>}
          <button type="button" onClick={playTone} className="mt-3 text-[11px] text-blue-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Probar sonido
          </button>
      </HeaderPopover>
    </div>
  )
}
