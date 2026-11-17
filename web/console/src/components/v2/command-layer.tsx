'use client'

// v2 · keyboard and command palette, on every page of the console:
// Ctrl+K (⌘K) opens a palette that finds sections, machines, alerts and a
// few actions; «?» opens the list of shortcuts; «g» then a letter opens a
// section; «/» jumps to the page's own search. A key typed into a field
// stays in the field (except Ctrl+K). Machines and alerts come from the
// live data already on the page; nothing is fetched to search.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowsClockwise, Command, Desktop, Keyboard, MagnifyingGlass, Siren, Translate, ArrowSquareOut, type IconProps } from '@phosphor-icons/react'
import type { ComponentType } from 'react'
import { useEngine } from '@/components/console/engine-provider'
import { useFleet } from '@/components/console/fleet-provider'
import { useI18n } from '@/components/console/i18n-provider'
import { alertKey } from '@/lib/engine-client'
import { v2AlertLink } from '@/lib/v2/alerts-model'
import { v2HostLink } from '@/lib/v2/hosts-model'
import { chordTarget, isTypingTarget, PALETTE_GROUPS, searchPalette, V2_SECTIONS, type PaletteItem } from '@/lib/v2/palette-model'
import { SEV_COLOR } from './home/parts'
import type { Severity } from '@/lib/console-types'

export const OPEN_PALETTE_EVENT = 'bluetardigrade:palette'

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="v2-kbd">{children}</kbd>
}

/** Focus stays inside the dialog and goes back where it was on close. */
function useDialogFocus(open: boolean, first: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return undefined
    const before = document.activeElement as HTMLElement | null
    first.current?.focus()
    return () => before?.focus?.()
  }, [open, first])
}

const ICONS: Record<string, ComponentType<IconProps>> = {
  hosts: Desktop,
  alerts: Siren,
  refresh: ArrowsClockwise,
  language: Translate,
  shortcuts: Keyboard,
  classic: ArrowSquareOut,
}

function Palette({ open, onClose, onShortcuts }: { open: boolean; onClose: () => void; onShortcuts: () => void }) {
  const { dict, lang, setLang } = useI18n()
  const t = dict.v2.palette
  const { alerts, refresh } = useEngine()
  const { fleet } = useFleet()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useDialogFocus(open, input)

  const items = useMemo<PaletteItem[]>(() => {
    const open = new Map<string, number>()
    for (const a of alerts) if (a.status !== 'closed' && a.host) open.set(a.host, (open.get(a.host) ?? 0) + 1)
    const hosts = [...new Set([...(fleet?.hosts ?? []).map((h) => h.host), ...alerts.map((a) => a.host)].filter(Boolean))]
    return [
      ...V2_SECTIONS.map((s) => ({ id: `s:${s.id}`, group: 'sections' as const, label: dict.v2.nav[s.id], detail: `g ${s.chord}`, href: s.href })),
      ...hosts.map((h) => ({ id: `h:${h}`, group: 'hosts' as const, label: h, detail: t.hostDetail(open.get(h) ?? 0), href: v2HostLink(h) })),
      ...alerts.slice(0, 300).map((a) => ({
        id: `a:${alertKey(a)}`,
        group: 'alerts' as const,
        label: a.rule_name,
        detail: `${a.host} · ${dict.v2.sev[a.severity]}`,
        keywords: `${a.summary ?? ''} ${(a.tags ?? []).join(' ')} ${a.user ?? ''}`,
        href: v2AlertLink(alertKey(a)),
        tone: a.severity,
      })),
      { id: 'x:refresh', group: 'actions' as const, label: t.actions.refresh, action: 'refresh' as const },
      { id: 'x:language', group: 'actions' as const, label: lang === 'es' ? dict.lang.toEn : dict.lang.toEs, action: 'language' as const },
      { id: 'x:shortcuts', group: 'actions' as const, label: t.actions.shortcuts, detail: '?', action: 'shortcuts' as const },
      { id: 'x:classic', group: 'actions' as const, label: t.actions.classic, href: '/' },
    ]
  }, [alerts, fleet, dict, lang, t])

  const found = useMemo(() => searchPalette(items, q), [items, q])

  useEffect(() => {
    if (!open) {
      setQ('')
      setActive(0)
    }
  }, [open])
  useEffect(() => setActive(0), [q])
  useEffect(() => {
    document.getElementById(`v2-pal-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const run = (item: PaletteItem | undefined) => {
    if (!item) return
    onClose()
    if (item.action === 'refresh') refresh()
    else if (item.action === 'language') setLang(lang === 'es' ? 'en' : 'es')
    else if (item.action === 'shortcuts') onShortcuts()
    else if (item.href) window.location.assign(item.href)
  }

  let index = -1
  return (
    <div className="v2-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="v2-palette" role="dialog" aria-modal="true" aria-label={t.aria}>
        <label className="v2-palette-search">
          <MagnifyingGlass aria-hidden="true" />
          <span className="v2-sr-only">{t.inputAria}</span>
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="v2-pal-list"
            aria-activedescendant={found.length ? `v2-pal-${active}` : undefined}
            value={q}
            maxLength={120}
            placeholder={t.placeholder}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setActive((i) => Math.min(found.length - 1, i + 1))
              else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1))
              else if (e.key === 'Enter') run(found[active])
              else if (e.key === 'Escape') onClose()
              else return
              e.preventDefault()
            }}
          />
          <Kbd>Esc</Kbd>
        </label>
        <div id="v2-pal-list" role="listbox" aria-label={t.aria} className="v2-palette-list">
          {found.length === 0 && <p className="v2-small v2-dim v2-palette-empty">{t.empty}</p>}
          {PALETTE_GROUPS.map((group) => {
            const inGroup = found.filter((f) => f.group === group)
            if (inGroup.length === 0) return null
            return (
              <div key={group} role="group" aria-label={t.groups[group]}>
                <p className="v2-eyebrow">{t.groups[group]}</p>
                {inGroup.map((item) => {
                  index += 1
                  const i = index
                  const Icon = item.group === 'sections' ? Command : ICONS[item.action ?? (item.href === '/' ? 'classic' : item.group)] ?? Command
                  return (
                    <div
                      key={item.id}
                      id={`v2-pal-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className="v2-palette-item"
                      onMouseMove={() => setActive(i)}
                      onClick={() => run(item)}
                    >
                      {item.tone ? <i className="v2-palette-sev" style={{ background: SEV_COLOR[item.tone as Severity] }} aria-hidden="true" /> : <Icon aria-hidden="true" />}
                      <span className="v2-palette-label">{item.label}</span>
                      {item.detail && <span className="v2-palette-detail">{item.detail}</span>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
        <footer className="v2-palette-foot">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t.footMove}
          </span>
          <span>
            <Kbd>Enter</Kbd> {t.footOpen}
          </span>
          <span>
            <Kbd>Esc</Kbd> {t.footClose}
          </span>
        </footer>
      </div>
    </div>
  )
}

function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dict } = useI18n()
  const t = dict.v2.shortcuts
  const closeBtn = useRef<HTMLButtonElement>(null)
  useDialogFocus(open, closeBtn)
  if (!open) return null
  const row = (keys: ReactNode, label: string) => (
    <li key={label}>
      <span className="v2-keys">{keys}</span>
      <span>{label}</span>
    </li>
  )
  return (
    <div className="v2-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="v2-shortcuts" role="dialog" aria-modal="true" aria-labelledby="v2-sc-title">
        <header>
          <h2 id="v2-sc-title">{t.title}</h2>
          <button ref={closeBtn} type="button" className="v2-btn" onClick={onClose}>
            {t.close} <Kbd>Esc</Kbd>
          </button>
        </header>
        <div className="v2-shortcuts-cols">
          <section>
            <h3 className="v2-eyebrow">{t.groups.nav}</h3>
            <ul>
              {V2_SECTIONS.map((s) =>
                row(
                  <>
                    <Kbd>g</Kbd> <Kbd>{s.chord}</Kbd>
                  </>,
                  dict.v2.nav[s.id],
                ),
              )}
            </ul>
          </section>
          <section>
            <h3 className="v2-eyebrow">{t.groups.general}</h3>
            <ul>
              {row(
                <>
                  <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>
                </>,
                t.general.palette,
              )}
              {row(<Kbd>/</Kbd>, t.general.search)}
              {row(<Kbd>?</Kbd>, t.general.help)}
              {row(<Kbd>Esc</Kbd>, t.general.close)}
            </ul>
          </section>
          <section>
            <h3 className="v2-eyebrow">{t.groups.focus}</h3>
            <ul>
              {row(
                <>
                  <Kbd>j</Kbd> <Kbd>→</Kbd>
                </>,
                t.focus.next,
              )}
              {row(
                <>
                  <Kbd>k</Kbd> <Kbd>←</Kbd>
                </>,
                t.focus.prev,
              )}
              {row(<Kbd>a</Kbd>, t.focus.ack)}
              {row(<Kbd>c</Kbd>, t.focus.closeAlert)}
              {row(<Kbd>Esc</Kbd>, t.focus.exit)}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

/** The palette button of the top bar. */
export function PaletteButton() {
  const { dict } = useI18n()
  return (
    <button type="button" className="v2-btn v2-palette-btn" onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))} aria-keyshortcuts="Control+K Meta+K">
      <MagnifyingGlass aria-hidden="true" />
      <span className="v2-hide-sm">{dict.v2.palette.button}</span>
      <Kbd>Ctrl K</Kbd>
    </button>
  )
}

export function CommandLayer() {
  const { dict } = useI18n()
  const [palette, setPalette] = useState(false)
  const [help, setHelp] = useState(false)
  const [chord, setChord] = useState(false)
  const chordTimer = useRef<number | undefined>(undefined)
  const overlayOpen = palette || help

  useEffect(() => {
    const openPalette = () => {
      setHelp(false)
      setPalette(true)
    }
    window.addEventListener(OPEN_PALETTE_EVENT, openPalette)
    return () => window.removeEventListener(OPEN_PALETTE_EVENT, openPalette)
  }, [])

  useEffect(() => {
    const endChord = () => {
      window.clearTimeout(chordTimer.current)
      setChord(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        setHelp(false)
        setPalette((v) => !v)
        return
      }
      if (overlayOpen || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
      if (chord) {
        const target = chordTarget(e.key)
        endChord()
        if (target) {
          e.preventDefault()
          e.stopPropagation()
          window.location.assign(target.href)
        }
        return
      }
      if (e.key === 'g') {
        setChord(true)
        window.clearTimeout(chordTimer.current)
        chordTimer.current = window.setTimeout(() => setChord(false), 1500)
        e.preventDefault()
        e.stopPropagation()
      } else if (e.key === '?') {
        e.preventDefault()
        setHelp(true)
      } else if (e.key === '/') {
        const search = document.querySelector<HTMLInputElement>('#v2-content input[type="search"]')
        if (search) {
          e.preventDefault()
          search.focus()
          search.select()
        }
      }
    }
    // capture: a chord's second key never reaches the page's own keys
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [chord, overlayOpen])

  useEffect(() => () => window.clearTimeout(chordTimer.current), [])

  return (
    <>
      <Palette open={palette} onClose={() => setPalette(false)} onShortcuts={() => setHelp(true)} />
      <ShortcutsHelp open={help} onClose={() => setHelp(false)} />
      {chord && (
        <div className="v2-chord" role="status">
          <Kbd>g</Kbd> {dict.v2.palette.chordWaiting}
        </div>
      )}
    </>
  )
}
