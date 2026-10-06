'use client'

// Detección: the detection content in one place. Rules, kill chains,
// threat intel, suppressions, the rule tester, the noise report and the
// detection-validation battery are tabs of one section (each tab keeps
// its own deep link:
// ?view=reglas|cadenas|inteligencia|supresiones|probador|ruido|simulacion).

import { BatteryCharging, Flask, FlowArrow, ListMagnifyingGlass, Prohibit, ShieldCheck, SpeakerHigh } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { ConsoleTablist, type ConsoleTab } from './ui-tabs'
import { RulesView } from './rules-view'
import { SequencesView } from './sequences-view'
import { SuppressionsView } from './suppressions-view'
import { RuleTester } from './rule-tester'
import { IntelView } from './intel-view'
import { NoiseView } from './noise-view'
import { ScenarioView } from './scenario-view'
import type { DetectionView } from '@/lib/url-state'

const TABS: ConsoleTab<DetectionView>[] = [
  { id: 'reglas', label: 'Reglas', icon: ShieldCheck },
  { id: 'cadenas', label: 'Cadenas', icon: FlowArrow },
  { id: 'inteligencia', label: 'Inteligencia', icon: ListMagnifyingGlass },
  { id: 'supresiones', label: 'Supresiones', icon: Prohibit },
  { id: 'probador', label: 'Probador', icon: Flask },
  { id: 'ruido', label: 'Ruido', icon: SpeakerHigh },
  { id: 'simulacion', label: 'Validación', icon: BatteryCharging },
]

export function DetectionHub({ tab, onTab, onOpenRule }: { tab: DetectionView; onTab: (tab: DetectionView) => void; onOpenRule: (id: string) => void }) {
  const { rules, sequences, suppressions } = useEngine()
  const counts: Partial<Record<DetectionView, number>> = { reglas: rules.length, cadenas: sequences.length, supresiones: suppressions.length }
  const tabs = TABS.map((t) => ({ ...t, count: counts[t.id] }))
  return (
    <div className="space-y-4">
      <ConsoleTablist idPrefix="detection" ariaLabel="Contenido de detección" tabs={tabs} value={tab} onSelect={onTab} />
      <div role="tabpanel" aria-labelledby={`tab-detection-${tab}`}>
        {tab === 'reglas' && <RulesView />}
        {tab === 'cadenas' && <SequencesView />}
        {tab === 'inteligencia' && <IntelView />}
        {tab === 'supresiones' && <SuppressionsView />}
        {tab === 'probador' && <RuleTester onOpenRule={onOpenRule} />}
        {tab === 'ruido' && <NoiseView />}
        {tab === 'simulacion' && <ScenarioView onOpenRule={onOpenRule} />}
      </div>
    </div>
  )
}
