'use client'

// Directorio: small pieces the tabs share.
import { useCallback } from 'react'
import { useI18n } from '@/components/console/i18n-provider'

/** «12:12» today, «16 nov 12:12» another day. */
export function useWhen() {
  const { lang } = useI18n()
  const locale = lang === 'en' ? 'en-GB' : 'es-ES'
  return useCallback(
    (iso: string | null | undefined, never: string) => {
      if (!iso) return never
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return never
      const today = new Date().toDateString() === d.toDateString()
      return today
        ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })
        : d.toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    },
    [locale],
  )
}
