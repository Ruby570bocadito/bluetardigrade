// i18n core (IDEA-10): two languages (Spanish = product default, English),
// one dictionary per language with compile-time parity (dict-en is typed
// with Dict), a pure resolver and the storage plumbing shared by the
// provider (i18n-provider.tsx) and the boot script in layout.tsx. The
// discipline mirrors the theme (lib/theme.ts): stored choice wins, then
// the browser preference, then the product default; the storage key is
// validated on read, and multi-tab sync is a `storage` listener.

import { dictEs, type Dict } from './dict-es'
import { dictEn } from './dict-en'

export type Lang = 'es' | 'en'

export const LANG_STORAGE_KEY = 'bt-lang'

export const DICTS: Record<Lang, Dict> = { es: dictEs, en: dictEn }

export type { Dict }

export const LANGS: readonly Lang[] = ['es', 'en']

/** Pure decision: a stored pin wins, then the browser preference, then
 * Spanish (the product's default language, also the no-JS outcome).
 * Anything unknown in storage deliberately falls to the browser branch. */
export function resolveLang(stored: string | null | undefined, browserLanguage: string | null | undefined): Lang {
  if (stored === 'es' || stored === 'en') return stored
  const primary = (browserLanguage ?? '').toLowerCase()
  if (primary.startsWith('en')) return 'en'
  return 'es'
}

/** Reads the operator's choice from a Storage-like object (validated),
 * falling back to the browser preference. Storage-less contexts (SSR,
 * tests) just resolve the browser branch. */
export function storedLang(storage: Pick<Storage, 'getItem'> | null | undefined, browserLanguage: string | null | undefined): Lang {
  let stored: string | null = null
  try {
    stored = storage?.getItem(LANG_STORAGE_KEY) ?? null
  } catch {
    // Private mode or blocked storage: the browser preference decides.
  }
  return resolveLang(stored, browserLanguage)
}
