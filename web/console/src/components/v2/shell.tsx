'use client'

// v2 shell: the section rail, the top bar (live state, clock, language,
// way back to the classic console) and the content area. Sections that
// are not rebuilt yet open their classic view, so the new console is
// usable end to end while it grows section by section.
import type { ComponentType, ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import {
  ArrowSquareOut,
  ArrowUpRight,
  Briefcase,
  Crosshair,
  Desktop,
  FileText,
  GearSix,
  House,
  Lightning,
  MagnifyingGlass,
  Siren,
  type IconProps,
} from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import type { Dict } from '@/lib/i18n'
import { TardigradeMark } from './logo'
import { useNow } from './use-now'

type SectionId = keyof Dict['v2']['nav']

type Section = { id: SectionId; href: string; icon: ComponentType<IconProps>; ready?: boolean }

const SECTIONS: readonly Section[] = [
  { id: 'inicio', href: '/v2', icon: House, ready: true },
  { id: 'alertas', href: '/v2/alertas', icon: Siren, ready: true },
  { id: 'incidentes', href: '/v2/incidentes', icon: Briefcase, ready: true },
  { id: 'investigar', href: '/v2/investigar', icon: MagnifyingGlass, ready: true },
  { id: 'equipos', href: '/v2/equipos', icon: Desktop, ready: true },
  { id: 'deteccion', href: '/?view=reglas', icon: Crosshair },
  { id: 'respuesta', href: '/?view=respuesta', icon: Lightning },
  { id: 'informes', href: '/?view=informes', icon: FileText },
  { id: 'ajustes', href: '/?view=ajustes', icon: GearSix },
]

function Rail({ current }: { current: SectionId }) {
  const { dict } = useI18n()
  const t = dict.v2
  return (
    <nav className="v2-rail" aria-label={t.railAria}>
      <a className="v2-brand" href="/v2" aria-label={t.brandAria}>
        <TardigradeMark size={30} />
        <span className="v2-brand-name">bluetardigrade</span>
      </a>
      <div className="v2-nav">
        {SECTIONS.map(({ id, href, icon: Icon, ready }) => {
          const label = t.nav[id]
          return (
            <a
              key={id}
              href={href}
              className="v2-nav-item"
              aria-current={id === current ? 'page' : undefined}
              title={ready ? label : t.navClassicTitle(label)}
            >
              <Icon weight={id === current ? 'fill' : 'regular'} aria-hidden="true" />
              <span className="v2-nav-label">{label}</span>
              {!ready && (
                <>
                  <ArrowUpRight className="v2-nav-classic" aria-hidden="true" />
                  <span className="v2-sr-only">({t.classicBadge})</span>
                </>
              )}
            </a>
          )
        })}
      </div>
    </nav>
  )
}

function LiveState() {
  const { dict } = useI18n()
  const { status } = useEngine()
  const t = dict.v2.topbar
  const text = status === 'live' ? t.live : status === 'down' ? t.offline : t.connecting
  return (
    <span className="v2-live" data-state={status} role="status">
      <span className="v2-live-dot" aria-hidden="true" />
      {text}
    </span>
  )
}

function Clock() {
  const { dict, lang } = useI18n()
  const now = useNow(1000)
  const locale = lang === 'en' ? 'en-GB' : 'es-ES'
  const date = now === null ? '' : new Date(now).toLocaleDateString(locale, { day: '2-digit', month: 'short' })
  const time = now === null ? '--:--:--' : new Date(now).toLocaleTimeString(locale, { hour12: false })
  return (
    <time className="v2-clock" aria-label={dict.v2.topbar.clockAria} dateTime={now === null ? undefined : new Date(now).toISOString()}>
      <span className="v2-clock-date">{date}</span>
      {time}
    </time>
  )
}

function LanguageSwitch() {
  const { lang, dict, setLang } = useI18n()
  const next = lang === 'es' ? 'en' : 'es'
  const label = lang === 'es' ? dict.lang.toEn : dict.lang.toEs
  return (
    <button type="button" className="v2-btn" onClick={() => setLang(next)} aria-label={`${label} ${next.toUpperCase()}`} title={label}>
      {next.toUpperCase()}
    </button>
  )
}

export function V2Shell({ current, title, children }: { current: SectionId; title: string; children: ReactNode }) {
  const { dict } = useI18n()
  return (
    <MotionConfig reducedMotion="user">
      <div className="v2">
        <a className="v2-skip" href="#v2-content">
          {dict.v2.skip}
        </a>
        <div className="v2-layout">
          <Rail current={current} />
          <div className="v2-main">
            <header className="v2-topbar">
              <h1 className="v2-title">{title}</h1>
              <LiveState />
              <div className="v2-topbar-spacer" />
              <Clock />
              <LanguageSwitch />
              <a className="v2-btn v2-hide-sm" href="/">
                <ArrowSquareOut aria-hidden="true" />
                {dict.v2.topbar.classic}
              </a>
            </header>
            <main id="v2-content" className="v2-content" tabIndex={-1}>
              {children}
            </main>
          </div>
        </div>
      </div>
    </MotionConfig>
  )
}
