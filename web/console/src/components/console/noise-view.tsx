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
import { useI18n } from './i18n-provider'
import { EmptyState, SkeletonRows } from './ui-bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeadRow, TableHeader, TableRow } from '@/components/ui/table'
import { SuppressionDialog, type SuppressionTarget } from './alert-actions'
import { fetchNoise, NOISE_LIMITS, NOISE_WINDOWS, noiseLimit, noiseWindowPreset, type NoiseReport, type NoiseWindow } from '@/lib/noise'

export function NoiseView() {
  const { status } = useEngine()
  const { fleet } = useFleet()
  const { dict, lang } = useI18n()
  const locale = lang === 'en' ? 'en-US' : 'es-ES'

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
    <section aria-label={dict.noise.sectionAria} className="space-y-4">
      <p className="max-w-[100ch] text-xs leading-relaxed text-zinc-500">
        {dict.noise.introA}
        <span className="text-zinc-300">{dict.noise.introSuppress}</span>
        {dict.noise.introB}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-zinc-400" htmlFor="ruido-ventana">
          {dict.noise.windowLabel}
          <Select value={windowPreset} onValueChange={(v) => setWindowPreset(noiseWindowPreset(v))}>
            <SelectTrigger id="ruido-ventana" className="h-8 rounded-md text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOISE_WINDOWS.map((w) => (
                <SelectItem key={w} value={w}>{w}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400" htmlFor="ruido-equipo">
          {dict.noise.hostLabel}
          <Input
            id="ruido-equipo"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={dict.noise.hostPlaceholder}
            list="ruido-hosts"
            spellCheck={false}
            className="h-8 w-44 text-xs"
          />
          <datalist id="ruido-hosts">
            {hostOptions.map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400" htmlFor="ruido-filas">
          {dict.noise.rowsLabel}
          <Select value={String(limit)} onValueChange={(v) => setLimit(noiseLimit(v))}>
            <SelectTrigger id="ruido-filas" className="h-8 rounded-md text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOISE_LIMITS.map((l) => (
                <SelectItem key={l} value={String(l)}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setReload((n) => n + 1)}
          disabled={loading}
          className="text-zinc-400 hover:text-zinc-100"
          aria-label={dict.noise.reloadAria}
        >
          <ArrowClockwise size={13} aria-hidden className={loading ? 'animate-spin motion-reduce:hidden' : ''} /> {dict.noise.reload}
        </Button>
        {report && (
          <span className="ml-auto flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
            <span>{report.source === 'store' ? dict.noise.originStore : dict.noise.originRings}</span>
            <span className="tabular-nums">{dict.noise.scanned(report.scanned.events, report.scanned.alerts)}</span>
            {report.host && <span>{dict.noise.hostPrefix}<span className="font-mono text-zinc-400">{report.host}</span></span>}
          </span>
        )}
      </div>

      {report?.scanned.truncated && (
        <p role="status" className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          {dict.noise.truncated}
        </p>
      )}

      {error ? (
        <div className="panel px-4 py-6">
          <EmptyState icon={SpeakerHigh} title={dict.noise.unavailableTitle} hint={dict.noise.unavailableHint(error)} />
        </div>
      ) : loading && !report ? (
        <div className="panel px-4 py-6">
          <SkeletonRows rows={5} />
        </div>
      ) : !report || !hasData ? (
        <div className="panel px-4 py-6">
          <EmptyState
            icon={SpeakerHigh}
            title={status !== 'live' ? dict.noise.noTelemetryTitle : dict.noise.noNoiseTitle}
            hint={dict.noise.noNoiseHint}
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
  const { dict, lang } = useI18n()
  const n = dict.noise.processes
  const locale = lang === 'en' ? 'en-US' : 'es-ES'
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-baseline gap-2 px-4 pt-3.5 pb-2">
        <h2 className="text-sm font-medium text-zinc-100">{n.title}</h2>
        <span className="text-xs text-zinc-500">{n.subtitle}</span>
      </div>
      {processes.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState icon={SpeakerHigh} title={n.emptyTitle} hint={n.emptyHint} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption>{n.caption}</TableCaption>
            <TableHeader>
              <TableHeadRow>
                {n.cols.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableHeadRow>
            </TableHeader>
            <TableBody>
              {processes.map((p) => (
                <TableRow key={p.image} className="align-top">
                  <TableCell className="max-w-[340px] px-4 py-3">
                    <span className="block truncate font-mono text-xs text-zinc-100" title={p.image}>{p.image}</span>
                    {p.command_line && <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-500" title={p.command_line}>{p.command_line}</span>}
                    {p.sha256 && <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-600" title={p.sha256}>sha256 {p.sha256.slice(0, 16)}…</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-200">{p.count.toLocaleString(locale)}</TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-400">{p.distinct_hosts}</TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-zinc-500">{p.last_seen.replace('T', ' ').slice(0, 19)}</TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-zinc-500" title={p.parent}>{p.parent ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-3">
                    <span
                      title={n.addKnownTitle}
                      className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-600"
                      aria-disabled="true"
                    >
                      <Prohibit size={11} aria-hidden /> {n.addKnown}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function NoiseDomains({ domains }: { domains: NoiseReport['domains'] }) {
  const { dict, lang } = useI18n()
  const d = dict.noise.domains
  const locale = lang === 'en' ? 'en-US' : 'es-ES'
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-baseline gap-2 px-4 pt-3.5 pb-2">
        <h2 className="text-sm font-medium text-zinc-100">{d.title}</h2>
        <span className="text-xs text-zinc-500">{d.subtitle}</span>
      </div>
      {domains.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState icon={SpeakerHigh} title={d.emptyTitle} hint={d.emptyHint} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption>{d.caption}</TableCaption>
            <TableHeader>
              <TableHeadRow>
                {d.cols.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableHeadRow>
            </TableHeader>
            <TableBody>
              {domains.map((d) => (
                <TableRow key={d.domain}>
                  <TableCell className="max-w-[340px] truncate px-4 py-3 font-mono text-xs text-zinc-100" title={d.domain}>{d.domain}</TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-200">{d.count.toLocaleString(locale)}</TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-400">{d.distinct_hosts}</TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-zinc-500">{d.last_seen.replace('T', ' ').slice(0, 19)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/** Loud rules: the tuning action. The suppression opens prefilled with
 * the rule and, when the report is narrowed, with that host. */
function NoiseRules({ rules, onSuppress }: { rules: NoiseReport['rules']; onSuppress: (target: SuppressionTarget) => void }) {
  const { dict, lang } = useI18n()
  const table = dict.noise.rules
  const locale = lang === 'en' ? 'en-US' : 'es-ES'
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-baseline gap-2 px-4 pt-3.5 pb-2">
        <h2 className="text-sm font-medium text-zinc-100">{table.title}</h2>
        <span className="text-xs text-zinc-500">{table.subtitle}</span>
      </div>
      {rules.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState icon={SpeakerHigh} title={table.emptyTitle} hint={table.emptyHint} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption>{table.caption}</TableCaption>
            <TableHeader>
              <TableHeadRow>
                {table.cols.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableHeadRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.rule_id}>
                  <TableCell className="max-w-[300px] px-4 py-3">
                    <span className="block truncate text-[13px] text-zinc-100" title={r.rule_name}>{r.rule_name}</span>
                    <span className="block truncate font-mono text-[11px] text-zinc-500">{r.rule_id}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-200">{r.count.toLocaleString(locale)}</TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-400">{r.distinct_hosts}</TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-300">{Math.round(r.acknowledged_pct)} %</TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-300">{Math.round(r.closed_pct)} %</TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onSuppress({ rule_id: r.rule_id, rule_name: r.rule_name, host: '' })}
                      className="h-7 gap-1 px-2 text-[11px]"
                    >
                      <X size={11} aria-hidden /> {table.createSuppression}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
