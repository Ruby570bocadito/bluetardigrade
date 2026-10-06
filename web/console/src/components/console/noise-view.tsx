'use client'

// §2.4 — noise report: the processes, DNS domains and rules that most
// generate events or alerts, fleet-wide or for one host. The engine
// aggregates (GET /api/noise); the console renders it and adds the
// tuning affordances: «crear supresión» for a loud rule (the write
// surface already exists) and the disabled placeholder for known
// software (arrives with v1.1). The report says where its records come
// from (store or rings) and whether the scan hit its cap.

import { useEffect, useMemo, useState } from 'react'
import { ArrowClockwise, Prohibit, SpeakerHigh, X } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { useFleet } from './fleet-provider'
import { EmptyState, SkeletonRows } from './ui-bits'
import { SuppressionDialog, type SuppressionTarget } from './alert-actions'
import { fetchNoise, NOISE_LIMITS, NOISE_WINDOWS, noiseLimit, noiseWindowPreset, type NoiseReport, type NoiseWindow } from '@/lib/noise'

const chip =
  'rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function NoiseView() {
  const { status } = useEngine()
  const { fleet } = useFleet()

  const [windowPreset, setWindowPreset] = useState<NoiseWindow>('24h')
  const [limit, setLimit] = useState(10)
  const [host, setHost] = useState('')
  const [report, setReport] = useState<NoiseReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [suppressTarget, setSuppressTarget] = useState<SuppressionTarget | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetchNoise(windowPreset, host, limit).then((res) => {
      if (!alive) return
      setLoading(false)
      if (res.ok) setReport(res.data)
      else {
        setReport(null)
        setError(res.error)
      }
    })
    return () => {
      alive = false
    }
  }, [windowPreset, host, limit, reload])

  const hostOptions = useMemo(() => (fleet?.hosts ?? []).map((h) => h.host), [fleet])
  const hasData = report && (report.processes.length > 0 || report.domains.length > 0 || report.rules.length > 0)

  return (
    <section aria-label="Informe de ruido" className="space-y-4">
      <p className="max-w-[100ch] text-xs leading-relaxed text-zinc-500">
        Qué genera volumen sin aportar señal: procesos repetidos, consultas DNS y reglas que más disparan, agregados por el motor
        sobre los mismos registros que la consola. Para silenciar una regla concreta usa{' '}
        <span className="text-zinc-300">crear supresión</span>; la lista de software conocido llega con la v1.1 del motor.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          Ventana
          <select value={windowPreset} onChange={(e) => setWindowPreset(noiseWindowPreset(e.target.value))} className={chip}>
            {NOISE_WINDOWS.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          Equipo
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="(toda la flota)"
            list="ruido-hosts"
            spellCheck={false}
            className={`${chip} w-44`}
          />
          <datalist id="ruido-hosts">
            {hostOptions.map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          Filas por lista
          <select value={limit} onChange={(e) => setLimit(noiseLimit(e.target.value))} className={chip}>
            {NOISE_LIMITS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setReload((n) => n + 1)}
          disabled={loading}
          className="chip px-2 py-1.5 text-zinc-400 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          aria-label="Actualizar el informe de ruido"
        >
          <ArrowClockwise size={13} aria-hidden className={loading ? 'animate-spin motion-reduce:hidden' : ''} /> Actualizar
        </button>
        {report && (
          <span className="ml-auto flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
            <span>origen: {report.source === 'store' ? 'almacén SQLite' : 'anillos en memoria'}</span>
            <span className="tabular-nums">{report.scanned.events} eventos · {report.scanned.alerts} alertas examinados</span>
            {report.host && <span>equipo: <span className="font-mono text-zinc-400">{report.host}</span></span>}
          </span>
        )}
      </div>

      {report?.scanned.truncated && (
        <p role="status" className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          El examen alcanzó su tope de registros: el informe ve el trozo MÁS NUEVO de la ventana, no una muestra sesgada.
        </p>
      )}

      {error ? (
        <div className="panel px-4 py-6">
          <EmptyState icon={SpeakerHigh} title="El informe de ruido no está disponible" hint={`${error} — sin conexión no se inventan agregados.`} />
        </div>
      ) : loading && !report ? (
        <div className="panel px-4 py-6">
          <SkeletonRows rows={5} />
        </div>
      ) : !report || !hasData ? (
        <div className="panel px-4 py-6">
          <EmptyState
            icon={SpeakerHigh}
            title={status !== 'live' ? 'Sin telemetría del motor' : 'Sin ruido en esta ventana'}
            hint="Con eventos en el motor, los procesos, dominios y reglas más ruidosos aparecen aquí."
          />
        </div>
      ) : (
        <>
          <NoiseProcesses processes={report.processes} />
          <NoiseDomains domains={report.domains} />
          <NoiseRules rules={report.rules} onSuppress={setSuppressTarget} />
        </>
      )}

      {suppressTarget && <SuppressionDialog targets={[suppressTarget]} onClose={() => setSuppressTarget(null)} />}
    </section>
  )
}

/** Loud processes: the «software conocido» button stays disabled until the
 * engine ships the v1.1 known-software surface — said, never faked. */
function NoiseProcesses({ processes }: { processes: NoiseReport['processes'] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-baseline gap-2 px-4 pt-3.5 pb-2">
        <h2 className="text-sm font-medium text-zinc-100">Procesos más repetidos</h2>
        <span className="text-xs text-zinc-500">agrupados por imagen (mayúsculas/minúsculas aparte)</span>
      </div>
      {processes.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState icon={SpeakerHigh} title="Sin procesos en la ventana" hint="Con telemetría de proceso.create en la ventana, el top aparece aquí." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Procesos que más eventos generan en la ventana</caption>
            <thead>
              <tr className="bg-zinc-900">
                {['Imagen', 'Eventos', 'Equipos', 'Visto por última vez', 'Padre', 'Software conocido'].map((h) => (
                  <th key={h} scope="col" className="border-b border-zinc-800 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {processes.map((p) => (
                <tr key={p.image} className="align-top transition-colors hover:bg-zinc-900/60">
                  <td className="max-w-[340px] px-4 py-3">
                    <span className="block truncate font-mono text-xs text-zinc-100" title={p.image}>{p.image}</span>
                    {p.command_line && <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-500" title={p.command_line}>{p.command_line}</span>}
                    {p.sha256 && <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-600" title={p.sha256}>sha256 {p.sha256.slice(0, 16)}…</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-200">{p.count.toLocaleString('es-ES')}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-400">{p.distinct_hosts}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-zinc-500">{p.last_seen.replace('T', ' ').slice(0, 19)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-zinc-500" title={p.parent}>{p.parent ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      title="El motor todavía no publica la lista de software conocido (v1.1): el botón se activa cuando aterrice."
                      className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-600"
                      aria-disabled="true"
                    >
                      <Prohibit size={11} aria-hidden /> añadir
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function NoiseDomains({ domains }: { domains: NoiseReport['domains'] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-baseline gap-2 px-4 pt-3.5 pb-2">
        <h2 className="text-sm font-medium text-zinc-100">Dominios DNS más consultados</h2>
        <span className="text-xs text-zinc-500">por nombre consultado, en minúsculas</span>
      </div>
      {domains.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState icon={SpeakerHigh} title="Sin consultas DNS en la ventana" hint="El top de dominios aparece con la primera resolución registrada." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Dominios DNS que más consultas generan en la ventana</caption>
            <thead>
              <tr className="bg-zinc-900">
                {['Dominio', 'Consultas', 'Equipos', 'Visto por última vez'].map((h) => (
                  <th key={h} scope="col" className="border-b border-zinc-800 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {domains.map((d) => (
                <tr key={d.domain} className="transition-colors hover:bg-zinc-900/60">
                  <td className="max-w-[340px] truncate px-4 py-3 font-mono text-xs text-zinc-100" title={d.domain}>{d.domain}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-200">{d.count.toLocaleString('es-ES')}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-400">{d.distinct_hosts}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-zinc-500">{d.last_seen.replace('T', ' ').slice(0, 19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Loud rules: the tuning action. The suppression opens prefilled with
 * the rule and, when the report is narrowed, with that host. */
function NoiseRules({ rules, onSuppress }: { rules: NoiseReport['rules']; onSuppress: (target: SuppressionTarget) => void }) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-baseline gap-2 px-4 pt-3.5 pb-2">
        <h2 className="text-sm font-medium text-zinc-100">Reglas que más alertan</h2>
        <span className="text-xs text-zinc-500">porcentaje sobre el estado ACTUAL del triaje de sus alertas</span>
      </div>
      {rules.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState icon={SpeakerHigh} title="Sin alertas en la ventana" hint="Las reglas del top aparecen en cuanto algo dispare." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Reglas que más alertas generan en la ventana</caption>
            <thead>
              <tr className="bg-zinc-900">
                {['Regla', 'Alertas', 'Equipos', 'Reconocidas', 'Cerradas', 'Ajuste'].map((h) => (
                  <th key={h} scope="col" className="border-b border-zinc-800 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {rules.map((r) => (
                <tr key={r.rule_id} className="transition-colors hover:bg-zinc-900/60">
                  <td className="max-w-[300px] px-4 py-3">
                    <span className="block truncate text-[13px] text-zinc-100" title={r.rule_name}>{r.rule_name}</span>
                    <span className="block truncate font-mono text-[11px] text-zinc-500">{r.rule_id}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-200">{r.count.toLocaleString('es-ES')}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-400">{r.distinct_hosts}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-300">{Math.round(r.acknowledged_pct)} %</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-300">{Math.round(r.closed_pct)} %</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onSuppress({ rule_id: r.rule_id, rule_name: r.rule_name, host: '' })}
                      className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X size={11} aria-hidden /> crear supresión
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
