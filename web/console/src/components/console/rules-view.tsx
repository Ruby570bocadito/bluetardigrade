'use client'

// Detection rules on display: the YAML contract as the engine sees it,
// served by /api/rules. Dense expandable rows (severity, technique,
// event type at a glance; description and conditions on demand).
// Free-text search narrows the pack by anything an analyst remembers:
// rule name, id, MITRE technique, tactic, event type, condition fields
// or the values the conditions match on.

import { useMemo, useState } from 'react'
import { CaretDown, MagnifyingGlass, ShieldCheck } from '@phosphor-icons/react'
import { Input } from '@/components/ui/input'
import { useEngine } from './engine-provider'
import { EmptyState, SectionHeader, SeverityBadge } from './ui-bits'
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
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rules
    return rules.filter((r) => ruleHaystack(r).includes(q))
  }, [rules, query])

  const filtering = query.trim() !== ''

  return (
    <section aria-label="Reglas de detección">
      <SectionHeader
        title="Reglas cargadas en el motor"
        count={visible.length}
        hint={filtering ? `de ${rules.length} totales` : 'hot-reload cada 15s'}
        action={
          <div className="flex items-center gap-2">
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
                className="h-8 w-[230px] rounded-md border-zinc-800 bg-zinc-900 pl-7 font-mono text-xs text-zinc-200 placeholder:text-zinc-500"
              />
            </div>
          </div>
        }
      />

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
                    onClick={() => setOpenId(open ? null : r.id)}
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
                      <span className="hidden rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 sm:inline">
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
