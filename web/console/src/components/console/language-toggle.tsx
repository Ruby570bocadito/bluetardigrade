'use client'

// LanguageToggle — IDEA-10 phase 1: a two-way pick (Spanish / English)
// next to the theme toggle. The visible text is the language you would
// switch TO (always readable, whichever language is active); the
// accessible name comes from the active dictionary. The choice persists
// under the shared storage key and every open tab follows it.

import { useI18n } from './i18n-provider'
import type { Lang } from '@/lib/i18n'

export function LanguageToggle() {
  const { lang, dict, setLang } = useI18n()
  const next: Lang = lang === 'es' ? 'en' : 'es'
  const label = lang === 'es' ? dict.lang.toEn : dict.lang.toEs
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      aria-label={`${label} ${next === 'es' ? 'ES' : 'EN'}`}
      title={label}
      className="chip shrink-0 px-2 py-1.5 text-xs font-medium tracking-wide text-zinc-400 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {next === 'es' ? 'ES' : 'EN'}
    </button>
  )
}
