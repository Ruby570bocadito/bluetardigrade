'use client'

// Language plumbing for the console (IDEA-10). The provider mirrors the
// theme's discipline (theme-toggle.tsx): the server render is Spanish (it
// matches <html lang="es"> and the no-JS outcome), the stored choice is
// applied after mount so hydration stays quiet, and a `storage` listener
// makes every open tab follow the decision. The operator's language is
// browser state, never engine data.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { DICTS, LANG_STORAGE_KEY, storedLang, type Dict, type Lang } from '@/lib/i18n'

type I18n = { lang: Lang; dict: Dict; setLang: (next: Lang) => void }

const Ctx = createContext<I18n | null>(null)

function readLang(): Lang {
  return storedLang(window.localStorage, navigator.language)
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('es')

  useEffect(() => {
    setLangState(readLang())
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LANG_STORAGE_KEY) return
      setLangState(readLang())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // The document language tracks the console language (assistive tech and
  // the browser's own UI decisions read it).
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = (next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next)
    } catch {
      // Private mode or blocked storage: the language flips for this
      // session, it just will not survive a reload.
    }
  }

  return <Ctx.Provider value={{ lang, dict: DICTS[lang], setLang }}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n debe usarse dentro de I18nProvider')
  return ctx
}
