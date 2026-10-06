'use client'

// First-run assistant (IDEA-11): one guided pass over the four things a
// fresh installation needs — console access, the ingest TLS certificate,
// the first enrollment token and the local sensor check. Everything it
// shows comes from what the engine reports (enrollment state, hosts,
// access mode); the steps the console cannot verify today are labeled as
// information, never as done. The only writes are the two the console
// already offered in Equipos: creating a token and approving a machine.

import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle, CircleDashed, Info, Key, RocketLaunch, SealCheck, ShieldWarning, UserCirclePlus, WarningCircle, X } from '@phosphor-icons/react'
import { ConsoleDialog } from './console-dialog'
import { PendingHosts, TokenEnrollment } from './enroll-parts'
import { useFleet } from './fleet-provider'
import { useConsoleUser } from './user-session'
import { useEngine } from './engine-provider'
import { modeText } from '@/lib/console-user'
import {
  allGatesDone,
  clearDismissed,
  readDismissed,
  stepStatuses,
  writeDismissed,
  type OnboardingFacts,
  type StepId,
  type StepStatus,
} from '@/lib/onboarding'
import { formatDateTime } from '@/lib/console-types'
import { useI18n } from './i18n-provider'

const PILL: Record<StepStatus, string> = {
  hecho: 'bg-emerald-400/15 text-emerald-300',
  aviso: 'bg-amber-400/15 text-amber-200',
  info: 'bg-white/[0.06] text-zinc-400',
  pendiente: 'bg-white/[0.06] text-zinc-500',
}
const PILL_ICON: Record<StepStatus, typeof Info> = { hecho: CheckCircle, aviso: WarningCircle, info: Info, pendiente: CircleDashed }
const STEP_ICON: Record<StepId, typeof Info> = { acceso: UserCirclePlus, certificado: ShieldWarning, token: Key, sensor: RocketLaunch }

function StepPill({ status }: { status: StepStatus }) {
  const { dict } = useI18n()
  const Icon = PILL_ICON[status]
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${PILL[status]}`}>
      <Icon size={11} weight={status === 'hecho' ? 'fill' : 'regular'} aria-hidden />
      {dict.onboarding.pills[status]}
    </span>
  )
}

function Step({ id, status, children }: { id: StepId; status: StepStatus; children: React.ReactNode }) {
  const { dict } = useI18n()
  const Icon = STEP_ICON[id]
  return (
    <li className="rounded-lg border border-white/[0.06] p-3">
      <p className="flex flex-wrap items-center gap-2">
        <Icon size={15} aria-hidden className="text-zinc-300" />
        <span className="text-sm font-medium text-zinc-100">{dict.onboarding.steps[id]}</span>
        <span className="ml-auto"><StepPill status={status} /></span>
      </p>
      <div className="mt-2 space-y-2 text-xs leading-relaxed text-zinc-400">{children}</div>
    </li>
  )
}

export function OnboardingWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { enroll, fleet, loaded } = useFleet()
  const me = useConsoleUser()
  const { status: engineStatus } = useEngine()
  const { dict } = useI18n()
  const [stayClosed, setStayClosed] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  const facts: OnboardingFacts = useMemo(
    () => ({
      engineLive: engineStatus === 'live',
      loaded,
      enroll: enroll
        ? {
            enabled: enroll.enabled,
            usableTokens: enroll.tokens.filter((t) => t.status === 'active').length,
            pendingHosts: enroll.hosts.filter((h) => h.state === 'pending').length,
            activeHosts: enroll.hosts.filter((h) => h.state === 'active').length,
          }
        : null,
      inventoryHosts: fleet ? fleet.hosts.length : null,
    }),
    [engineStatus, loaded, enroll, fleet],
  )
  const statuses = useMemo(() => stepStatuses(facts), [facts])
  const done = allGatesDone(statuses)

  // The dismissal flag is browser state (this operator's choice), never
  // engine data: read it only while the dialog is open, after mount, so
  // the server render and the hydration never touch localStorage.
  useEffect(() => {
    if (open) setStayClosed(readDismissed(window.localStorage))
  }, [open])

  function setStayClosedAndStore(next: boolean) {
    setStayClosed(next)
    if (next) writeDismissed(window.localStorage, new Date())
    else clearDismissed(window.localStorage)
  }

  function finish() {
    writeDismissed(window.localStorage, new Date())
    onClose()
  }

  return (
    <ConsoleDialog open={open} onClose={onClose} titleId="onboarding-title" descriptionId="onboarding-desc" initialFocus={closeRef}>
      <div className="p-5">
        <div className="flex items-start gap-2">
          <RocketLaunch size={18} aria-hidden className="mt-0.5 text-zinc-300" />
          <div className="min-w-0">
            <h2 id="onboarding-title" className="text-sm font-semibold text-zinc-50">{dict.onboarding.title}</h2>
            <p id="onboarding-desc" className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              {dict.onboarding.desc}
            </p>
          </div>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label={dict.onboarding.close}
            className="ml-auto shrink-0 rounded-md p-1 text-zinc-500 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <ol className="mt-4 space-y-2.5">
          <Step id="acceso" status={statuses.acceso}>
            <p>
              <span className="font-medium text-zinc-300">{dict.onboarding.acceso.howNow}</span> {modeText(me)}.
              {dict.onboarding.acceso.effectiveRole} {me.role === 'admin' ? dict.onboarding.acceso.roles.admin : me.role === 'analyst' ? dict.onboarding.acceso.roles.analyst : dict.onboarding.acceso.roles.viewer}.
            </p>
            {me.mode !== 'users' && (
              <p>
                {dict.onboarding.acceso.usersProseA}
                <code className="rounded bg-black/40 px-1 font-mono text-[11px] text-zinc-200">bun scripts/console-user.mjs &lt;usuario&gt; admin</code>
                {dict.onboarding.acceso.usersProseB}
                <code className="rounded bg-black/40 px-1 font-mono text-[11px] text-zinc-200">web/console</code>
                {dict.onboarding.acceso.usersProseC}
                <code className="rounded bg-black/40 px-1 font-mono text-[11px] text-zinc-200">CONSOLE_USERS_FILE</code>
                {dict.onboarding.acceso.usersProseD}
              </p>
            )}
            <p className="text-[11px] text-zinc-500">
              {dict.onboarding.acceso.infoProse}
            </p>
          </Step>

          <Step id="certificado" status={statuses.certificado}>
            {!enroll && <p>{dict.onboarding.certificado.pending}</p>}
            {enroll?.enabled && (
              <p>
                {dict.onboarding.certificado.enabledA}
                <code className="rounded bg-black/40 px-1 font-mono text-[11px] text-zinc-200">-TlsCa</code>
                {dict.onboarding.certificado.enabledB}
              </p>
            )}
            {enroll && !enroll.enabled && (
              <>
                <p className="flex items-start gap-2 text-amber-200">
                  <WarningCircle size={14} aria-hidden className="mt-0.5 shrink-0" />
                  <span>{enroll.hint || dict.onboarding.certificado.disabledHint}</span>
                </p>
                <p>
                  {dict.onboarding.certificado.disabledProse}
                </p>
              </>
            )}
            <p className="text-[11px] text-zinc-500">
              {dict.onboarding.certificado.infoProse}
            </p>
          </Step>

          <Step id="token" status={statuses.token}>
            {!enroll && <p>{dict.onboarding.token.pending}</p>}
            {enroll && statuses.token === 'hecho' && (
              <p className="flex items-start gap-2 text-emerald-200">
                <SealCheck size={14} aria-hidden className="mt-0.5 shrink-0" />
                <span>
                  {dict.onboarding.token.done(
                    facts.enroll?.usableTokens ?? 0,
                    enroll.tokens.some((t) => t.status === 'active' && t.expires_at)
                      ? formatDateTime(
                        enroll.tokens
                          .filter((t) => t.status === 'active')
                          .map((t) => t.expires_at)
                          .sort()[0],
                      )
                      : null,
                  )}
                </span>
              </p>
            )}
            {enroll && statuses.token !== 'hecho' && <TokenEnrollment />}
          </Step>

          <Step id="sensor" status={statuses.sensor}>
            {statuses.sensor === 'hecho' && (
              <p className="flex items-start gap-2 text-emerald-200">
                <SealCheck size={14} aria-hidden className="mt-0.5 shrink-0" />
                <span>
                  {dict.onboarding.sensor.done(facts.enroll?.activeHosts ?? 0)}
                </span>
              </p>
            )}
            {statuses.sensor === 'aviso' && (
              <>
                <p>{dict.onboarding.sensor.avisoProse}</p>
                <PendingHosts />
              </>
            )}
            {statuses.sensor === 'pendiente' && (
              <p>
                {dict.onboarding.sensor.pendienteProse}
              </p>
            )}
            {!enroll && <p>{dict.onboarding.sensor.noEnroll}</p>}
          </Step>
        </ol>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3">
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={stayClosed} onChange={(e) => setStayClosedAndStore(e.target.checked)} />
            {dict.onboarding.footer.dontRepeat}
          </label>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:border-white/20 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {dict.onboarding.footer.close}
          </button>
          {done && (
            <button
              type="button"
              onClick={finish}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CheckCircle size={13} weight="fill" aria-hidden />
              {dict.onboarding.footer.finish}
            </button>
          )}
        </div>
      </div>
    </ConsoleDialog>
  )
}
