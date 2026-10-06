import { describe, expect, test } from 'bun:test'
import { DICTS, LANG_STORAGE_KEY, resolveLang, storedLang, type Lang } from './index'
import { dictEs } from './dict-es'

// Parity walk: every key of the Spanish source must exist in the English
// dictionary with the same kind (string vs function), functions keep the
// same arity (each language does its own pluralization inside) and no
// string is empty. Compilation already enforces this via `Dict`; the walk
// re-checks it at runtime so an accidental `as any` or a widened dict
// cannot slip through.

function walk(esPath: string[], esValue: unknown, enValue: unknown): void {
  if (typeof esValue === 'function') {
    expect(typeof enValue, `en path ${esPath.join('.')} should be a function`).toBe('function')
    expect((enValue as (...args: unknown[]) => unknown).length, `arity drift at en ${esPath.join('.')}`).toBe(
      (esValue as (...args: unknown[]) => unknown).length,
    )
    return
  }
  if (typeof esValue === 'string') {
    expect(typeof enValue, `en path ${esPath.join('.')} should be a string`).toBe('string')
    expect((enValue as string).length > 0, `empty string at en ${esPath.join('.')}`).toBe(true)
    return
  }
  expect(esValue && typeof esValue === 'object', `unexpected leaf at ${esPath.join('.')}`).toBe(true)
  expect(enValue && typeof enValue === 'object', `en path ${esPath.join('.')} should be an object`).toBe(true)
  const esKeys = Object.keys(esValue as object).sort()
  const enKeys = Object.keys(enValue as object).sort()
  expect(enKeys, `key drift at en ${esPath.join('.')}`).toEqual(esKeys)
  for (const key of esKeys) {
    walk(
      [...esPath, key],
      (esValue as Record<string, unknown>)[key],
      (enValue as Record<string, unknown>)[key],
    )
  }
}

describe('i18n dictionaries', () => {
  test('en implements the full es shape (keys, kinds, arity, non-empty)', () => {
    walk([], dictEs, DICTS.en)
  })

  test('both languages resolve for every Lang key', () => {
    for (const lang of ['es', 'en'] as const) expect(DICTS[lang]).toBeTypeOf('object')
  })

  test('battery-pinned Spanish strings stay byte-identical', () => {
    expect(dictEs.onboarding.title).toBe('Puesta en marcha')
    expect(dictEs.chrome.onboardingOpen).toBe('Puesta en marcha')
    expect(dictEs.palette.title).toBe('Comandos de la consola')
    expect(dictEs.palette.searchLabel).toBe('Buscar comandos')
    expect(dictEs.shortcuts.title).toBe('Atajos de teclado')
  })

  test('english copy is a real translation, not the spanish source', () => {
    expect(DICTS.en.onboarding.title).toBe('Set up')
    expect(DICTS.en.chrome.live).toBe('Live')
    expect(DICTS.en.views.alertas.title).toBe('Alert queue')
  })

  test('phase 2 sweep (noc + notify) keeps the spanish copy byte-identical', () => {
    expect(dictEs.noc.ariaLabel).toBe('Modo NOC')
    expect(dictEs.noc.slides.situacion).toBe('Situación')
    expect(dictEs.noc.slides.grafo).toBe('Grafo de investigación')
    expect(dictEs.noc.slides.cobertura).toBe('Cobertura y equipos')
    expect(dictEs.noc.exit).toBe('Salir')
    expect(dictEs.noc.offlineTitle).toBe('Motor sin conexión')
    expect(dictEs.noc.situation.criticalOpen).toBe('Críticas sin cerrar')
    expect(dictEs.noc.coverage.riskSeen(3, '10:05')).toBe('3 alertas · visto 10:05')
    expect(dictEs.notify.title).toBe('Avisos de alertas críticas')
    expect(dictEs.notify.testSound).toBe('Probar sonido')
    expect(dictEs.notify.toast.many(5)).toBe('5 alertas críticas nuevas')
  })

  test('phase 2 english copy is a real translation of noc and notify', () => {
    expect(DICTS.en.noc.ariaLabel).toBe('NOC mode')
    expect(DICTS.en.noc.slides.cobertura).toBe('Coverage and hosts')
    expect(DICTS.en.noc.situation.criticalHint(2, 1)).toBe('2 new · 1 acknowledged')
    expect(DICTS.en.noc.coverage.riskSeen(3, '10:05')).toBe('3 alerts · seen 10:05')
    expect(DICTS.en.notify.title).toBe('Critical alert notifications')
    expect(DICTS.en.notify.toast.one('r')).toBe('Critical alert: r')
    expect(DICTS.en.notify.toast.moreHosts(2)).toBe('and 2 more hosts')
  })
})

describe('language resolution', () => {
  test('a validated stored choice always wins', () => {
    expect(resolveLang('en', 'es-ES')).toBe('en')
    expect(resolveLang('es', 'en-US')).toBe('es')
  })

  test('without storage the browser preference decides', () => {
    expect(resolveLang(null, 'en-GB')).toBe('en')
    expect(resolveLang(undefined, 'en')).toBe('en')
    expect(resolveLang(null, 'es-AR')).toBe('es')
    expect(resolveLang(null, 'fr-FR')).toBe('es')
    expect(resolveLang(null, undefined)).toBe('es')
  })

  test('unknown stored values fall to the browser branch', () => {
    expect(resolveLang('de', 'en-US')).toBe('en')
    expect(resolveLang('{"injected":true}', 'es')).toBe('es')
    expect(resolveLang('en-US', 'es-ES')).toBe('es')
  })

  test('storedLang reads validated storage and survives blocked storage', () => {
    expect(storedLang({ getItem: (key: string) => (key === LANG_STORAGE_KEY ? 'en' : null) }, 'es-ES')).toBe('en')
    expect(storedLang({ getItem: () => 'garbage' }, 'es-ES')).toBe('es')
    expect(
      storedLang(
        {
          getItem: () => {
            throw new Error('blocked')
          },
        },
        'en-US',
      ),
    ).toBe('en')
    expect(storedLang(null, 'es-ES')).toBe('es')
    expect(storedLang(undefined, undefined)).toBe('es')
  })
})

describe('language toggle framing', () => {
  test('each language advertises the switch in the language being read', () => {
    const pairs: Array<[Lang, string, string]> = [
      ['es', DICTS.es.lang.toEn, DICTS.es.lang.toEs],
      ['en', DICTS.en.lang.toEn, DICTS.en.lang.toEs],
    ]
    for (const [lang, toEn, toEs] of pairs) {
      expect(typeof toEn).toBe('string')
      expect(typeof toEs).toBe('string')
      expect(lang === 'es' ? toEn : toEs).toMatch(/inglés|English|español|Spanish/)
    }
  })
})
