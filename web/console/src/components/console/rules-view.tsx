'use client'

// Detection rules on display: the YAML contract as the engine sees it,
// served by /api/rules. Dense expandable rows (severity, technique,
// event type at a glance; description and conditions on demand).
// Free-text search narrows the pack by anything an analyst remembers:
// rule name, id, MITRE technique, tactic, event type, condition fields
// or the values the conditions match on.

import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, Crosshair, MagnifyingGlass, ShieldCheck, ShieldWarning, Stack } from '@phosphor-icons/react'
import { Input } from '@/components/ui/input'
import { useEngine } from './engine-provider'
import { EmptyState, SeverityBadge } from './ui-bits'
import { ChartCard } from '@/components/charts/chart-frame'
import { BarList } from '@/components/charts/bars'
import { SEV_COLOR, SeverityIcon } from '@/components/charts/severity'
import { ATTACK_TACTICS, SEVERITIES, SEVERITY_LABEL, tacticSlug, topCounts } from '@/lib/soc-metrics'
import {
  currentSearch,
  readLensState,
  replaceOperatorState,
  writeRulesToSearch,
} from '@/lib/url-state'
import type { RuleMeta } from '@/lib/console-types'

function ruleHaystack(r: RuleMeta): string {
  const values = r.conditions.map((c) =>
    Array.isArray(c.value) ? c.value.join(' ') : String(c.value),
  )
  return [
    r.name, r.id, r.description, r.mitre, r.tactic, r.event_type,
    ...r.tags, ...r.conditions.map((c) => c.field), ...values,
  ].join(' ').toLowerCase()
}

export function RulesView() {
  const { rules } = useEngine()
  const [query, setQueryState] = useState('')
  const [openId, setOpenIdState] = useState<string | null>(null)

  // The rules lenses live in the URL (url-state.ts, ?rq=&regla=): the
  // search survives a refresh and an expanded row is a shareable link —
  // rule ids are stable catalog ids (hot-reload every 15 s), so unlike
  // the rotating alert ring a deep link does not rot. Read AFTER mount
  // (hydration-safe); the search debounces (250 ms); expanding/collapsing
  // a row writes immediately (replaceState, no history spam); popstate
  // re-syncs. An id that is not in the loaded pack simply does not
  // expand (honest degradation) and WILL expand when the hot-reload
  // delivers it, because `open` derives from state on every render.
  const lensRef = useRef<{ rq: string; regla: string | null }>({ rq: '', regla: null })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const apply = () => {
      const lens = readLensState(currentSearch())
      lensRef.current = { rq: lens.rq, regla: lens.regla === '' ? null : lens.regla }
      setQueryState(lens.rq)
      setOpenIdState(lens.regla === '' ? null : lens.regla)
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => {
      window.removeEventListener('popstate', apply)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const setQuery = (next: string) => {
    lensRef.current = { ...lensRef.current, rq: next }
    setQueryState(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(
      () =>
        replaceOperatorState((search) => writeRulesToSearch(search, lensRef.current.rq, lensRef.current.regla)),
      250,
    )
  }
  const toggleOpen = (id: string) => {
    const regla = openId === id ? null : id
    lensRef.current = { ...lensRef.current, regla }
    setOpenIdState(regla)
    replaceOperatorState((search) => writeRulesToSearch(search, lensRef.current.rq, regla))
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rules
    return rules.filter((r) => ruleHaystack(r).includes(q))
  }, [rules, query])

  const filtering = query.trim() !== ''

  return (
    <section aria-label="Reglas de detección" className="space-y-4">
      {rules.length > 0 && <RuleCoverage rules={rules} onFilter={(text) => setQuery(query === text ? '' : text)} active={query} />}

      <div className="panel-head panel justify-between">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-medium text-zinc-100">Reglas cargadas en el motor</h2>
          <span className="text-xs tabular-nums text-zinc-500">{visible.length}</span>
          <span className="text-xs text-zinc-500">{filtering ? `de ${rules.length} totales` : 'recarga en caliente cada 15 s'}</span>
        </div>
        <div className="relative">
          <MagnifyingGlass
            size={13}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="buscar regla, MITRE, táctica..."
            aria-label="Buscar en reglas"
            className="h-8 w-[240px] rounded-md border-zinc-800 bg-zinc-900 pl-7 text-xs text-zinc-200 placeholder:text-zinc-500"
          />
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={ShieldCheck}
            title="Aún no hay reglas en el búfer"
            hint="El catálogo se rellena con la primera sincronización contra la API del motor (GET /api/rules)."
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={MagnifyingGlass}
            title="Sin resultados"
            hint="Ninguna regla coincide con la búsqueda actual"
          />
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <ul className="divide-y divide-zinc-800/80">
            {visible.map((r) => {
              const open = openId === r.id
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => toggleOpen(r.id)}
                    aria-expanded={open}
                    className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-zinc-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[auto_minmax(0,3fr)_minmax(0,2fr)_auto_auto]"
                  >
                    <SeverityBadge severity={r.severity} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-zinc-100">{r.name}</span>
                      <span className="block truncate font-mono text-[11px] text-zinc-500">{r.id}</span>
                    </span>
                    <span className="hidden min-w-0 md:block">
                      <span className="block truncate font-mono text-xs text-zinc-400">{r.event_type}</span>
                      <span className="block truncate font-mono text-[11px] text-zinc-500">{r.tactic || 'sin táctica'}</span>
                    </span>
                    {r.mitre ? (
                      <span className="hidden rounded-md border border-blue-400/20 bg-blue-500/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-blue-200 sm:inline">
                        {r.mitre}
                      </span>
                    ) : (
                      <span className="hidden text-xs text-zinc-500 sm:inline">n/d</span>
                    )}
                    <CaretDown size={13} aria-hidden className={`text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>

                  {open && (
                    <div className="grid gap-4 border-t border-zinc-800/80 bg-zinc-900/60 px-4 py-4 md:grid-cols-2">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500">Descripción</p>
                        <p className="mt-1.5 max-w-[65ch] text-xs leading-relaxed text-zinc-400">{r.description || 'sin descripción'}</p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {r.tags.map((t) => (
                            <span key={t} className="rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="min-w-0 overflow-hidden rounded-md border border-zinc-800">
                        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-[11px] text-zinc-500">
                          <span>Condiciones de match</span>
                          <span className="font-mono">{r.event_type}</span>
                        </div>
                        <table className="w-full text-left text-xs">
                          <caption className="sr-only">Condiciones de la regla {r.name}</caption>
                          <tbody className="divide-y divide-zinc-800/60">
                            {r.conditions.map((c, i) => (
                              <tr key={i}>
                                <th scope="row" className="px-3 py-1.5 text-left font-mono font-normal text-zinc-300">{c.field}</th>
                                <td className="px-3 py-1.5 font-mono text-amber-400">{c.operator}</td>
                                <td className="break-all px-3 py-1.5 font-mono text-zinc-500">
                                  {Array.isArray(c.value) ? `[${c.value.join(', ')}]` : String(c.value)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-zinc-500">
        Formato YAML igual al del motor Go: internal/rules las indexa por event_type y las recarga en caliente cada 15s.
      </p>
    </section>
  )
}

/**
 * Coverage of the loaded pack: rules per ATT&CK tactic (kill-chain order),
 * per severity and per event type. Each bar narrows the catalogue below
 * with the same free-text search (a second click clears it).
 */
function RuleCoverage({ rules, onFilter, active }: { rules: RuleMeta[]; onFilter: (text: string) => void; active: string }) {
  const byTactic = ATTACK_TACTICS.map((t) => ({
    ...t,
    count: rules.filter((r) => (tacticSlug(r.tactic) ?? r.tags.map(tacticSlug).find(Boolean)) === t.slug).length,
  })).filter((t) => t.count > 0)
  const uncovered = ATTACK_TACTICS.length - byTactic.length
  const bySeverity = SEVERITIES.map((sev) => ({ sev, count: rules.filter((r) => r.severity === sev).length }))
  const byType = topCounts(rules, (r) => r.event_type, 6)
  const pressed = (text: string) => active.trim().toLowerCase() === text.toLowerCase()
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartCard
        title="Reglas por táctica ATT&CK"
        subtitle={`${byTactic.length} de 14 tácticas cubiertas${uncovered ? ` · ${uncovered} sin reglas` : ''}`}
        icon={Crosshair}
        table={{ caption: 'Reglas por táctica de MITRE ATT&CK', columns: ['Táctica', 'Reglas'], rows: ATTACK_TACTICS.map((t) => [t.label, byTactic.find((b) => b.slug === t.slug)?.count ?? 0]) }}
      >
        <BarList
          rows={byTactic.map((t) => {
            const label = rules.find((r) => tacticSlug(r.tactic) === t.slug)?.tactic || t.slug
            return {
              key: t.slug, label: t.label, value: t.count,
              onSelect: () => onFilter(label),
              selectLabel: pressed(label) ? `Quitar el filtro ${t.label}` : `Filtrar reglas de ${t.label}: ${t.count}`,
            }
          })}
        />
      </ChartCard>
      <ChartCard
        title="Reglas por severidad"
        subtitle="Severidad declarada en el YAML de cada regla"
        icon={ShieldWarning}
        table={{ caption: 'Reglas por severidad', columns: ['Severidad', 'Reglas'], rows: bySeverity.map((b) => [SEVERITY_LABEL[b.sev], b.count]) }}
      >
        <BarList
          rows={bySeverity.map((b) => ({
            key: b.sev,
            label: <span className="flex items-center gap-2"><SeverityIcon severity={b.sev} size={13} />{SEVERITY_LABEL[b.sev]}</span>,
            value: b.count,
            color: SEV_COLOR[b.sev],
          }))}
        />
      </ChartCard>
      <ChartCard
        title="Tipos de evento evaluados"
        subtitle={`${byType.distinct} tipos de telemetría con reglas`}
        icon={Stack}
        table={{ caption: 'Reglas por tipo de evento', columns: ['Tipo de evento', 'Reglas'], rows: byType.top.map((r) => [r.key, r.count]) }}
        footer={byType.rest > 0 ? `${byType.rest} reglas más en otros tipos.` : undefined}
      >
        <BarList
          color="var(--series-2)"
          rows={byType.top.map((r) => ({
            key: r.key, label: <span className="font-mono">{r.key}</span>, value: r.count,
            onSelect: () => onFilter(r.key),
            selectLabel: pressed(r.key) ? `Quitar el filtro ${r.key}` : `Filtrar reglas de ${r.key}: ${r.count}`,
          }))}
        />
      </ChartCard>
    </div>
  )
}
