// The engine's behavioral detectors as the header summarizes them
// (fed by /api/stats): kill-chain correlator, beaconing, volumetric
// thresholds, offline threat intel and the process baseline. Honest by
// design, as the per-detector chips were:
// - a detector that is off (no sequences, no beacons.yaml, no lists...)
//   has no row: zeros would suggest coverage the engine is not running;
// - "alert" when a tracker reached its cap: NEW keys silently stop being
//   tracked there, which is detection loss the operator must see;
// - "warn" when the intel lists matched something since startup.

import type { EngineStats } from './console-types'

export type DetectorState = 'ok' | 'warn' | 'alert'
export type DetectorKey = 'correlator' | 'beacons' | 'thresholds' | 'intel' | 'baseline'

export type DetectorRow = {
  key: DetectorKey
  label: string
  value: string
  detail: string
  state: DetectorState
}

function n(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function detectorRows(stats: EngineStats | null): DetectorRow[] {
  if (!stats || (stats.mode && stats.mode !== 'engine')) return []
  const rows: DetectorRow[] = []
  const { correlator_states: states = 0, correlator_sequences: seqs = 0, correlator_cap: corrCap = 0 } = stats
  if (seqs > 0) {
    const exhausted = corrCap > 0 && states >= corrCap
    rows.push({
      key: 'correlator',
      label: 'Correlador',
      value: `${states}/${corrCap}`,
      detail: exhausted
        ? `Al límite: ${states} cadenas en curso (cap ${corrCap}). Equipos NUEVOS dejan de correlacionarse hasta que se liberen estados.`
        : `${n(states, 'cadena', 'cadenas')} en curso, ${n(seqs, 'secuencia cargada', 'secuencias cargadas')}.`,
      state: exhausted ? 'alert' : 'ok',
    })
  }
  const { beacons_tracked: tracked = 0, beacons_cap: bCap = 0, beacons_fired: bFired = 0 } = stats
  if (bCap > 0 || tracked > 0) {
    const exhausted = bCap > 0 && tracked >= bCap
    rows.push({
      key: 'beacons',
      label: 'Beaconing',
      value: `${tracked}/${bCap}`,
      detail: exhausted
        ? `Al límite: ${tracked} destinos seguidos (cap ${bCap}). Destinos NUEVOS dejan de rastrearse hasta que se liberen claves.`
        : `${n(tracked, 'destino seguido', 'destinos seguidos')}, ${n(bFired, 'disparo', 'disparos')} desde el arranque.`,
      state: exhausted ? 'alert' : 'ok',
    })
  }
  const { threshold_rules: defs = 0, threshold_keys: keys = 0, threshold_fired: tFired = 0 } = stats
  if (defs > 0) {
    rows.push({
      key: 'thresholds',
      label: 'Umbrales',
      value: `${defs} · ${tFired}`,
      detail: `${n(defs, 'definición cargada', 'definiciones cargadas')}, ${n(keys, 'clave de agregación viva', 'claves de agregación vivas')}, ${n(tFired, 'disparo', 'disparos')} desde el arranque.`,
      state: 'ok',
    })
  }
  const { intel_indicators: indicators = 0, intel_lists: lists = 0, intel_hits: hits = 0 } = stats
  if (indicators > 0) {
    rows.push({
      key: 'intel',
      label: 'Inteligencia',
      value: `${indicators} · ${hits}`,
      detail: `${n(indicators, 'indicador', 'indicadores')} en ${n(lists, 'lista', 'listas')}, ${n(hits, 'coincidencia', 'coincidencias')} con alerta desde el arranque.`,
      state: hits > 0 ? 'warn' : 'ok',
    })
  }
  const { baseline_hosts: bHosts = 0, baseline_learning: learning = 0, baseline_novelties: novel = 0 } = stats
  if (bHosts > 0) {
    rows.push({
      key: 'baseline',
      label: 'Línea base',
      value: `${bHosts} · ${novel}`,
      detail: `${n(bHosts, 'equipo', 'equipos')} (${learning} aprendiendo), ${n(novel, 'proceso nuevo', 'procesos nuevos')} desde el arranque.`,
      state: 'ok',
    })
  }
  return rows
}

/** The worst state among the rows: what the closed chip shows. */
export function worstState(rows: readonly DetectorRow[]): DetectorState {
  if (rows.some((r) => r.state === 'alert')) return 'alert'
  if (rows.some((r) => r.state === 'warn')) return 'warn'
  return 'ok'
}
