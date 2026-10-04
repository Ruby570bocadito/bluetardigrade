'use client'

// Detección: the detection content in one place. Rules, kill chains,
// suppressions and the rule tester are tabs of one section (each tab
// keeps its own deep link: ?view=reglas|cadenas|supresiones|probador).

import { FlowArrow, Flask, Prohibit, ShieldCheck } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { RulesView } from './rules-view'
import { SequencesView } from './sequences-view'
import { SuppressionsView } from './suppressions-view'
import { RuleTester } from './rule-tester'
import type { DetectionView } from '@/lib/url-state'

const TABS: { id: DetectionView; label: string; icon: React.ElementType }[] = [
  { id: 'reglas', label: 'Reglas', icon: ShieldCheck },
  { id: 'cadenas', label: 'Cadenas', icon: FlowArrow },
  { id: 'supresiones', label: 'Supresiones', icon: Prohibit },
  { id: 'probador', label: 'Probador', icon: Flask },
]

export function DetectionHub({ tab, onTab, onOpenRule }: { tab: DetectionView; onTab: (tab: DetectionView) => void; onOpenRule: (id: string) => void }) {
  const { rules, sequences, suppressions } = useEngine()
  const counts: Partial<Record<DetectionView, number>> = { reglas: rules.length, cadenas: sequences.length, supresiones: suppressions.length }
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Contenido de detección" className="flex flex-wrap gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTab(id)}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active ? 'bg-blue-500/15 text-blue-100 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.25)]' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
              }`}
            >
              <Icon size={14} weight={active ? 'fill' : 'regular'} aria-hidden className={active ? 'text-blue-400' : ''} />
              {label}
              {counts[id] !== undefined && <span className="rounded bg-white/[0.06] px-1.5 text-[10px] tabular-nums text-zinc-400">{counts[id]}</span>}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
        {tab === 'reglas' && <RulesView />}
        {tab === 'cadenas' && <SequencesView />}
        {tab === 'supresiones' && <SuppressionsView />}
        {tab === 'probador' && <RuleTester onOpenRule={onOpenRule} />}
      </div>
    </div>
  )
}
