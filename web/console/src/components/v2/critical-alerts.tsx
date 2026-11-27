'use client'

// Critical-alert notifications in v2: the per-browser preference the
// classic bell keeps too (set in Ajustes → Mi cuenta), one system
// notification per batch of new open critical alerts and the optional
// tone. No interface here; a reconnection never replays old alerts.
import { useEffect, useRef, useState } from 'react'
import { useEngine } from '@/components/console/engine-provider'
import { useI18n } from '@/components/console/i18n-provider'
import { currentPermission, newCriticalAlerts, notificationText, NOTIFY_KEY, playNotifyTone, readNotifyPrefs, type NotifyPrefs } from '@/lib/alert-notify'
import { alertKey } from '@/lib/engine-client'

/** Fired by the preference editor so an open page picks the change up at once. */
export const NOTIFY_PREFS_EVENT = 'bluetardigrade:notify-prefs'

export function CriticalAlerts() {
  const { alerts, status } = useEngine()
  const { dict } = useI18n()
  const [prefs, setPrefs] = useState<NotifyPrefs>({ enabled: false, sound: false })
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    const read = () => setPrefs(readNotifyPrefs(window.localStorage))
    const onStorage = (e: StorageEvent) => {
      if (e.key === NOTIFY_KEY || e.key === null) read()
    }
    read()
    window.addEventListener('storage', onStorage)
    window.addEventListener(NOTIFY_PREFS_EVENT, read)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(NOTIFY_PREFS_EVENT, read)
    }
  }, [])

  // an outage restarts the baseline
  useEffect(() => {
    if (status !== 'live') seen.current = null
  }, [status])

  useEffect(() => {
    if (status !== 'live') return
    const { fresh, seen: next } = newCriticalAlerts(alerts, seen.current, alertKey)
    seen.current = next
    if (!prefs.enabled || fresh.length === 0) return
    if (currentPermission() === 'granted') {
      const { title, body } = notificationText(fresh, dict.notify.toast)
      try {
        const toast = new Notification(title, { body, tag: 'bluetardigrade-critical', icon: '/icon.svg' })
        toast.onclick = () => {
          window.focus()
          toast.close()
        }
      } catch {
        // some browsers only allow notifications from a service worker
      }
    }
    if (prefs.sound) playNotifyTone()
  }, [alerts, status, prefs, dict])

  return null
}
