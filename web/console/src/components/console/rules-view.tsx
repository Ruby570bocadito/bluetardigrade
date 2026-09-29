'use client'

// Detection rules on display: the YAML contract as the engine sees it.
// Grouped blocks with hairlines instead of card soup (cockpit density).
// Free-text search narrows the pack by anything an analyst remembers:
// rule name, id, MITRE technique, tactic, event type, condition fields
// or the values the conditions match on.

import { useMemo, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { Input } from '@/components/ui/input'
import { useConsole } from './socket-provider'
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
  const { rules } = useConsole()
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rules
    return rules.filter((r) => ruleHaystack(r).includes(q))
  }, [rules, query])

  const filtering = query.trim() !== ''

  return (
    <section aria-label="Reglas de detección">
      <SectionHeader
        title="Reglas cargadas"
        count={visible.length}
        action={
          <div className="flex items-center gap-2">
            {filtering && (
              <span className="hidden font-mono text-[11px] text-zinc-600 sm:inline">de {rules.length}</span>
            )}
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
                className="h-8 w-[210px] border-white/10 bg-transparent pl-7 font-mono text-xs text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
          </div>
        }
      />
      {rules.length === 0 ? (
        <EmptyState title="Aún no hay reglas en el búfer" hint="Se rellenan al recibir la primera instantánea del motor" />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Sin resultados"
          hint="Ninguna regla coincide con la búsqueda actual"
        />
      ) : (
        <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
          {visible.map((r) => (
            <article key={r.id} className="grid gap-6 py-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={r.severity} />
                  <h3 className="text-sm font-medium text-zinc-100">{r.name}</h3>
                </div>
                <p className="mt-2 max-w-[60ch] text-xs leading-relaxed text-zinc-400">{r.description}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    {r.mitre} {r.tactic.split(':').pop()?.trim()}
                  </span>
                  {r.tags.map((t) => (
                    <span key={t} className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="min-w-0 overflow-hidden rounded-md border border-white/[0.08]">
                <div className="flex items-center justify-between border-b border-white/[0.08] bg-white/[0.02] px-3 py-1.5 text-[11px] text-zinc-500">
                  <span>condiciones</span>
                  <span className="font-mono">{r.event_type}</span>
                </div>
                <table className="w-full text-left text-xs">
                  <tbody className="divide-y divide-white/[0.06]">
                    {r.conditions.map((c, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 font-mono text-zinc-300">{c.field}</td>
                        <td className="px-3 py-1.5 font-mono text-amber-200/90">{c.operator}</td>
                        <td className="px-3 py-1.5 font-mono text-zinc-400">
                          {Array.isArray(c.value) ? `[${c.value.join(', ')}]` : c.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-zinc-600">
        Formato YAML igual al del motor Go: internal/rules las indexa por event_type y las recarga en caliente cada 15s.
      </p>
    </section>
  )
}
