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

const PILL: Record<StepStatus, string> = {
  hecho: 'bg-emerald-400/15 text-emerald-300',
  aviso: 'bg-amber-400/15 text-amber-200',
  info: 'bg-white/[0.06] text-zinc-400',
  pendiente: 'bg-white/[0.06] text-zinc-500',
}
const PILL_LABEL: Record<StepStatus, string> = { hecho: 'Hecho', aviso: 'Atención', info: 'Información', pendiente: 'Pendiente' }
const PILL_ICON: Record<StepStatus, typeof Info> = { hecho: CheckCircle, aviso: WarningCircle, info: Info, pendiente: CircleDashed }
const STEP_ICON: Record<StepId, typeof Info> = { acceso: UserCirclePlus, certificado: ShieldWarning, token: Key, sensor: RocketLaunch }

function StepPill({ status }: { status: StepStatus }) {
  const Icon = PILL_ICON[status]
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${PILL[status]}`}>
      <Icon size={11} weight={status === 'hecho' ? 'fill' : 'regular'} aria-hidden />
      {PILL_LABEL[status]}
    </span>
  )
}

const TITLES: Record<StepId, string> = {
  acceso: 'Acceso a la consola y administrador',
  certificado: 'Certificado TLS de ingesta',
  token: 'Primer token de alta',
  sensor: 'Comprobar el sensor',
}

function Step({ id, status, children }: { id: StepId; status: StepStatus; children: React.ReactNode }) {
  const Icon = STEP_ICON[id]
  return (
    <li className="rounded-lg border border-white/[0.06] p-3">
      <p className="flex flex-wrap items-center gap-2">
        <Icon size={15} aria-hidden className="text-zinc-300" />
        <span className="text-sm font-medium text-zinc-100">{TITLES[id]}</span>
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
            <h2 id="onboarding-title" className="text-sm font-semibold text-zinc-50">Puesta en marcha</h2>
            <p id="onboarding-desc" className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              Lo que una instalación nueva necesita, en cuatro pasos, con el estado que declara el motor. Nada se
              ejecuta en ningún equipo: el asistente solo lee el motor y usa las dos acciones de alta que ya ofrecía
              Equipos (crear un token y aprobar una máquina).
            </p>
          </div>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="Cerrar el asistente"
            className="ml-auto shrink-0 rounded-md p-1 text-zinc-500 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <ol className="mt-4 space-y-2.5">
          <Step id="acceso" status={statuses.acceso}>
            <p>
              <span className="font-medium text-zinc-300">Cómo entra quien usa esta consola ahora:</span> {modeText(me)}.
              Rol efectivo: {me.role === 'admin' ? 'Administrador' : me.role === 'analyst' ? 'Analista' : 'Lector'}.
            </p>
            {me.mode !== 'users' && (
              <p>
                Para cuentas por persona (quién hizo cada cambio y con qué rol) crea una entrada con{' '}
                <code className="rounded bg-black/40 px-1 font-mono text-[11px] text-zinc-200">bun scripts/console-user.mjs &lt;usuario&gt; admin</code>{' '}
                desde <code className="rounded bg-black/40 px-1 font-mono text-[11px] text-zinc-200">web/console</code>, pégala en el fichero
                «users» de <code className="rounded bg-black/40 px-1 font-mono text-[11px] text-zinc-200">CONSOLE_USERS_FILE</code> y rearranca la
                consola. La contraseña solo se guarda como hash PBKDF2.
              </p>
            )}
            <p className="text-[11px] text-zinc-500">
              Las cuentas viven en el servicio de la consola, no en el motor; este paso queda como información hasta que
              exista una pantalla de ajustes (SET-1).
            </p>
          </Step>

          <Step id="certificado" status={statuses.certificado}>
            {!enroll && <p>El motor todavía no ha contestado al estado del alta de equipos; en cuanto responda, este paso muestra su señal real.</p>}
            {enroll?.enabled && (
              <p>
                El motor sirve el alta de equipos: su certificado de ingesta está en marcha. Para que un sensor remoto
                cifre la conexión, cópiale el certificado público del servidor y arranca el sensor con{' '}
                <code className="rounded bg-black/40 px-1 font-mono text-[11px] text-zinc-200">-TlsCa</code> (la ruta exacta la
                prepara el paso del token). Detalle: docs/FLOTA-REMOTA.md, «Certificado TLS del servidor».
              </p>
            )}
            {enroll && !enroll.enabled && (
              <>
                <p className="flex items-start gap-2 text-amber-200">
                  <WarningCircle size={14} aria-hidden className="mt-0.5 shrink-0" />
                  <span>{enroll.hint || 'El alta de equipos está apagada en el motor.'}</span>
                </p>
                <p>
                  Es la señal del propio motor, copiada tal cual. En la instalación de Windows el certificado de ingesta
                  se crea solo; a mano está guiado en docs/FLOTA-REMOTA.md, «Certificado TLS del servidor».
                </p>
              </>
            )}
            <p className="text-[11px] text-zinc-500">
              La consola todavía no sirve ficheros para descargar (REP-3): el certificado se copia desde el servidor, y
              aquí no se declara hecho por encima de lo que el motor dice.
            </p>
          </Step>

          <Step id="token" status={statuses.token}>
            {!enroll && <p>El motor no ha respondido al estado del alta; sin respuesta, este paso no ofrece el formulario.</p>}
            {enroll && statuses.token === 'hecho' && (
              <p className="flex items-start gap-2 text-emerald-200">
                <SealCheck size={14} aria-hidden className="mt-0.5 shrink-0" />
                <span>
                  Hay {facts.enroll?.usableTokens} token{facts.enroll?.usableTokens === 1 ? '' : 's'} de alta en uso
                  {enroll.tokens.some((t) => t.status === 'active' && t.expires_at) && `; el más próximo caduca ${formatDateTime(
                    enroll.tokens
                      .filter((t) => t.status === 'active')
                      .map((t) => t.expires_at)
                      .sort()[0],
                  )}`}. Si pierdes el secreto de uno, crea otro: el motor solo guarda su huella.
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
                  {facts.enroll?.activeHosts} equipo{facts.enroll?.activeHosts === 1 ? '' : 's'} con sensor activo en el alta. La
                  ficha de cada máquina (vista Equipos) muestra su riesgo, procesos y conexiones en vivo.
                </span>
              </p>
            )}
            {statuses.sensor === 'aviso' && (
              <>
                <p>El sensor arrancó y espera aprobación. Sus eventos están en el disco del equipo hasta que lo apruebes; nada se pierde.</p>
                <PendingHosts />
              </>
            )}
            {statuses.sensor === 'pendiente' && (
              <p>
                Crea el token en el paso anterior y ejecuta sus comandos en el equipo (o la instalación completa con
                install.ps1 -WithSensor en este servidor). En cuanto el sensor arranque, el equipo aparece como
                pendiente aquí y en Equipos, y este paso lo confirma.
              </p>
            )}
            {!enroll && <p>El motor no ha respondido al alta de equipos: este paso no puede confirmar nada sin su respuesta.</p>}
          </Step>
        </ol>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3">
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={stayClosed} onChange={(e) => setStayClosedAndStore(e.target.checked)} />
            No volver a proponerlo al abrir la consola
          </label>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:border-white/20 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cerrar
          </button>
          {done && (
            <button
              type="button"
              onClick={finish}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CheckCircle size={13} weight="fill" aria-hidden />
              Terminar la puesta en marcha
            </button>
          )}
        </div>
      </div>
    </ConsoleDialog>
  )
}
