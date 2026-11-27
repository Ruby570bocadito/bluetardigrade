'use client'

// Ajustes · Puesta en marcha: the four steps a fresh installation needs —
// console access, the ingest TLS certificate, the first enrollment code
// and the sensor check — each with what the engine reports. A step the
// console cannot verify is information, never «done».
import { useMemo, type ReactNode } from 'react'
import { Check, CircleDashed, Info, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { useFleet } from '@/components/console/fleet-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { modeText, roleText } from '@/lib/console-user'
import { stepStatuses, type StepId, type StepStatus } from '@/lib/onboarding'
import { v2HostsLink } from '@/lib/v2/hosts-model'
import type { SettingsTab } from '@/lib/v2/settings-model'
import { Empty } from '../home/parts'
import { onboardingFacts } from './settings-map'

const ICON: Record<StepStatus, typeof Info> = { hecho: Check, aviso: Warning, info: Info, pendiente: CircleDashed }
const STEPS: StepId[] = ['acceso', 'certificado', 'token', 'sensor']

export function FirstRun({ onOpen }: { onOpen: (tab: SettingsTab) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.settingsView
  const o = dict.onboarding
  const me = useConsoleUser()
  const { status } = useEngine()
  const { enroll, fleet, loaded } = useFleet()
  const facts = useMemo(() => onboardingFacts(status, loaded, enroll, fleet), [status, loaded, enroll, fleet])
  const statuses = stepStatuses(facts)
  const done = STEPS.filter((s) => statuses[s] === 'hecho').length
  const usable = facts.enroll?.usableTokens ?? 0
  const nextExpiry = enroll?.tokens
    .filter((x) => x.status === 'active' && x.expires_at)
    .map((x) => x.expires_at as string)
    .sort()[0]

  const body: Record<StepId, ReactNode> = {
    acceso: (
      <>
        <p className="v2-small">
          {o.acceso.howNow} <strong>{me.pending ? t.states.loading : modeText(me, lang)}</strong>. {o.acceso.effectiveRole}{' '}
          <strong>{me.pending ? t.states.loading : roleText(me.role, lang)}</strong>.
        </p>
        <p className="v2-small v2-dim">{o.acceso.infoProse}</p>
        <button type="button" className="v2-link v2-small" onClick={() => onOpen('cuentas')}>
          {t.frOpenAccounts}
        </button>
      </>
    ),
    certificado: (
      <>
        <p className="v2-small">{!facts.enroll ? o.certificado.pending : facts.enroll.enabled ? o.certificado.enabledA + o.certificado.enabledB : o.certificado.disabledHint}</p>
        <p className="v2-small v2-dim">{o.certificado.infoProse}</p>
      </>
    ),
    token: (
      <>
        <p className="v2-small">
          {!facts.enroll ? o.token.pending : usable > 0 ? o.token.done(usable, nextExpiry ? new Date(nextExpiry).toLocaleDateString(lang) : null) : o.sensor.pendienteProse}
        </p>
        <a className="v2-link v2-small" href={v2HostsLink('alta')}>
          {t.frOpenEnroll}
        </a>
      </>
    ),
    sensor: (
      <>
        <p className="v2-small">
          {!facts.enroll
            ? o.sensor.noEnroll
            : statuses.sensor === 'hecho'
              ? o.sensor.done(facts.enroll.activeHosts)
              : statuses.sensor === 'aviso'
                ? o.sensor.avisoProse
                : o.sensor.pendienteProse}
        </p>
        <a className="v2-link v2-small" href="/v2/equipos">
          {t.frOpenHosts}
        </a>
      </>
    ),
  }

  // limited to host groups: no enrollment tokens and only its own machines
  if (me.scope?.length) return <Empty title={t.states.restricted}>{t.restrictedHint}</Empty>

  return (
    <div className="v2-set-stack">
      <div className="v2-set-head">
        <h2>{t.frTitle}</h2>
        <p className="v2-small v2-dim">{o.desc}</p>
      </div>
      <div className="v2-fr-progress" role="img" aria-label={t.frProgress(done, STEPS.length)}>
        <i style={{ ['--w' as string]: `${(done / STEPS.length) * 100}%` }} />
      </div>
      <p className="v2-small">{t.frProgress(done, STEPS.length)}</p>
      <ol className="v2-fr-steps">
        {STEPS.map((id, i) => {
          const st = statuses[id]
          const Icon = ICON[st]
          return (
            <li key={id} className="v2-fr-step" data-status={st} style={{ ['--i' as string]: i }}>
              <span className="v2-fr-icon" aria-hidden="true">
                <Icon weight="bold" />
              </span>
              <div className="v2-fr-body">
                <header>
                  <strong>
                    {i + 1}. {o.steps[id]}
                  </strong>
                  <span className="v2-fr-pill" data-status={st}>
                    {o.pills[st]}
                  </span>
                </header>
                {body[id]}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
