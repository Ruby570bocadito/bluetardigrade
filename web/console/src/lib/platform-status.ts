// SET-3 «Estado de la plataforma»: pure aggregation of the engine's
// /api/stats snapshot into the sections of the dedicated platform-status
// view. The lib owns every label, tone and capacity computation so the
// whole surface is testable without a DOM, exactly like triage-flow or
// donut.
//
// Honesty contract (same as every panel of this console): a metric the
// engine does not publish is rendered as ABSENT («no publicado»), never
// as 0 and never skipped silently. The TODO asks for latencies, the
// store size in bytes, the engine version, expiring certificates and
// the last scheduled report — the engine publishes none of them today,
// so `unavailable` carries them for the view's footnote instead of
// inventing placeholders.

import { formatUptime, type EngineStats, type HotHost } from './console-types'

export type StatusTone = 'neutral' | 'ok' | 'warn' | 'bad'

/** One metric row of a section; `fill` renders a capacity meter. */
export type StatusRow = {
  key: string
  label: string
  /** Pre-rendered Spanish display value; the view stays dumb. */
  display: string
  /** True when the engine does not publish this metric (display says so). */
  absent?: boolean
  /** Short operator-facing explanation, already in Spanish. */
  hint?: string
  tone: StatusTone
  /** Capacity meter, only when the engine publishes a real cap. */
  fill?: { value: number; max: number; color: string }
}

export type StatusSection = {
  key: string
  title: string
  hint?: string
  rows: StatusRow[]
}

export type PlatformStatusReport = {
  sections: StatusSection[]
  /** Metrics the TODO asks for that the API does not publish today. */
  unavailable: string[]
  /** False as soon as any row is in the `bad` tone. */
  healthy: boolean
}

const NOT_PUBLISHED = 'no publicado'
const fmt = (n: number) => n.toLocaleString('es-ES')

/** Delivery triple (sent/failed/dropped) shared by webhook, elastic and splunk. */
type DeliveryTriple = { sent: number; failed: number; dropped: number }

function deliveryRow(key: string, label: string, t: DeliveryTriple | undefined, hint: string): StatusRow {
  if (!t) {
    return { key, label, display: NOT_PUBLISHED, absent: true, hint, tone: 'neutral' }
  }
  const idle = t.sent === 0 && t.failed === 0 && t.dropped === 0
  const broken = t.failed > 0 || t.dropped > 0
  return {
    key,
    label,
    display: idle
      ? 'sin actividad'
      : `${fmt(t.sent)} enviados · ${fmt(t.failed)} fallidos · ${fmt(t.dropped)} descartados`,
    hint,
    tone: broken ? 'bad' : 'neutral',
  }
}

function countRow(key: string, label: string, value: number | undefined, opts: {
  hint?: string
  /** value > 0 marks attention (failures, violations, losses). */
  attention?: 'warn' | 'bad'
  /** Render the number plus this suffix when present. */
  suffix?: string
} = {}): StatusRow {
  if (value === undefined || !Number.isFinite(value)) {
    return { key, label, display: NOT_PUBLISHED, absent: true, hint: opts.hint, tone: 'neutral' }
  }
  return {
    key,
    label,
    display: `${fmt(value)}${opts.suffix ? ' ' + opts.suffix : ''}`,
    hint: opts.hint,
    tone: opts.attention && value > 0 ? opts.attention : 'neutral',
  }
}

/** Capacity meter color: validated palette, amber past 80% of the cap. */
function fillColor(value: number, max: number): string {
  return max > 0 && value / max >= 0.8 ? 'var(--sev-medium)' : 'var(--series-1)'
}

/** One row per notify channel, capped so a long config cannot flood the page. */
export const MAX_CHANNEL_ROWS = 6

function channelRows(channels: EngineStats['notify_channels']): { rows: StatusRow[]; hidden: number } {
  if (!channels) {
    return {
      rows: [{ key: 'notify', label: 'Canales de notificación', display: NOT_PUBLISHED, absent: true, hint: 'reenvío pendiente o motor antiguo', tone: 'neutral' }],
      hidden: 0,
    }
  }
  const rows = channels.slice(0, MAX_CHANNEL_ROWS).map((c, i) =>
    deliveryRow('notify-' + i, `Canal «${c.name}» (${c.type})`, { sent: c.sent, failed: c.failed, dropped: c.dropped }, 'entrega del canal de notificación del motor'),
  )
  return { rows, hidden: Math.max(0, channels.length - MAX_CHANNEL_ROWS) }
}

/** The whole report; null stays null so the view keeps its empty state. */
export function platformStatus(stats: EngineStats | null): PlatformStatusReport | null {
  if (!stats) return null

  const mode = stats.mode ?? 'engine'
  const correlatorLive = (stats.correlator_cap ?? 0) > 0
  const channels = channelRows(stats.notify_channels)

  const sections: StatusSection[] = [
    {
      key: 'motor',
      title: 'Motor',
      rows: [
        {
          key: 'uptime',
          label: 'Tiempo encendido',
          display: formatUptime(stats.uptime_s),
          hint: 'desde el arranque del proceso del motor',
          tone: 'neutral',
        },
        {
          key: 'mode',
          label: 'Modo',
          display: mode === 'engine' ? 'conectado al motor' : 'sin motor (vista local)',
          hint: 'fuente de los datos de esta consola',
          tone: 'neutral',
        },
        countRow('rules', 'Reglas cargadas', stats.rules_count, {
          hint: stats.rules_types.length ? 'tipos: ' + stats.rules_types.join(', ') : undefined,
        }),
      ],
    },
    {
      key: 'ingesta',
      title: 'Ingesta',
      rows: [
        countRow('events', 'Eventos aceptados', stats.events_total, { hint: 'desde el arranque' }),
        countRow('rate', 'Ritmo actual', stats.events_per_min, { suffix: 'eventos/min' }),
        countRow('dropped', 'Eventos descartados', stats.dropped, { attention: 'warn', hint: 'búfer de ingesta saturado o telemetría malformada' }),
        countRow('rejected', 'Conexiones sin credencial', stats.ingest_rejected, { attention: 'warn', hint: 'señal de sondeos del puerto de ingesta cuando hay -token' }),
        countRow('identities', 'Identidades de ingesta', stats.ingest_identities, { hint: 'vinculación host–sensor del alta (cuando está armada)' }),
        countRow('violations', 'Violaciones de identidad', stats.ingest_identity_violations, { attention: 'bad', hint: 'eventos que reclaman un host fuera de su vinculación' }),
      ],
    },
    {
      key: 'colas',
      title: 'Colas y correlación',
      rows: [
        countRow('buffered', 'Búfer de eventos', stats.events_buffered, { hint: 'cola viva del stream, no persistida' }),
        {
          key: 'chains',
          label: 'Cadenas en curso',
          display: `${fmt(stats.correlator_states)} de ${fmt(stats.correlator_cap)} plazas`,
          hint: correlatorLive
            ? 'secuencias (host, etapa) vivas del correlador de kill chain'
            : 'todo a cero: correlador sin secuencias cargadas o desactivado',
          tone: 'neutral',
          fill: correlatorLive
            ? { value: stats.correlator_states, max: stats.correlator_cap, color: fillColor(stats.correlator_states, stats.correlator_cap) }
            : undefined,
        },
        countRow('sequences', 'Secuencias cargadas', stats.correlator_sequences),
        countRow('risk', 'Hosts con riesgo', stats.risk_hosts_tracked, { hint: 'ancho de la señal del score A1 (riesgo no frío)' }),
        countRow('hot', 'Hosts calientes', stats.hot_hosts?.length, { hint: 'top-5 publicado por el motor' }),
        {
          key: 'beacons',
          label: 'Beacons en seguimiento',
          display: stats.beacons_cap === undefined
            ? NOT_PUBLISHED
            : `${fmt(stats.beacons_tracked ?? 0)} de ${fmt(stats.beacons_cap)} plazas`,
          absent: stats.beacons_cap === undefined,
          hint: 'perfiles de beaconing vivos del detector (A3)',
          tone: stats.beacons_cap !== undefined && (stats.beacons_tracked ?? 0) >= stats.beacons_cap ? 'warn' : 'neutral',
          fill: stats.beacons_cap
            ? { value: stats.beacons_tracked ?? 0, max: stats.beacons_cap, color: fillColor(stats.beacons_tracked ?? 0, stats.beacons_cap) }
            : undefined,
        },
        countRow('beacons-fired', 'Beacons disparados', stats.beacons_fired, { attention: 'warn', hint: 'alertas de beaconing desde el arranque' }),
      ],
    },
    {
      key: 'almacen',
      title: 'Almacén',
      hint: 'persistencia SQLite opcional (engine -store)',
      rows: [
        stats.store_enabled === undefined
          ? { key: 'store', label: 'Persistencia', display: NOT_PUBLISHED, absent: true, hint: 'motor antiguo o arranque sin -store', tone: 'neutral' }
          : {
              key: 'store',
              label: 'Persistencia',
              display: stats.store_enabled ? 'activa (-store)' : 'sin persistencia',
              hint: 'los contadores siguientes solo aplican con -store',
              tone: 'neutral',
            },
        countRow('store-events', 'Eventos almacenados', stats.store_events),
        countRow('store-alerts', 'Alertas almacenadas', stats.store_alerts),
        countRow('store-failures', 'Fallos de escritura', stats.store_write_failures, { attention: 'bad', hint: 'escrituras de eventos o alertas fallidas desde el arranque de la API' }),
        countRow('store-conflicts', 'Conflictos de id', stats.store_id_conflicts, { attention: 'warn', hint: 'eventos reenviados con otra carga útil; se conserva la copia almacenada' }),
      ],
    },
    {
      key: 'entrega',
      title: 'Entrega externa',
      hint: 'contadores de entrega vistos desde fuera del motor',
      rows: [
        deliveryRow('webhook', 'Webhook', pickTriple(stats, 'webhook'), 'conector -webhook del motor'),
        deliveryRow('elastic', 'Elastic', pickTriple(stats, 'elastic'), 'indexado por lotes (-elastic)'),
        deliveryRow('splunk', 'Splunk', pickTriple(stats, 'splunk'), 'eventos HEC (-splunk)'),
        ...channels.rows,
      ],
    },
    {
      key: 'deteccion',
      title: 'Detección auxiliar',
      rows: [
        countRow('suppressions', 'Supresiones activas', stats.suppressions_active, { hint: 'entradas no expiradas de la lista del operador' }),
        countRow('threshold-rules', 'Definiciones de umbral', stats.threshold_rules, { hint: 'detector volumétrico (A2); todo a cero sin -thresholds' }),
        countRow('threshold-keys', 'Claves de umbral en seguimiento', stats.threshold_keys),
        countRow('threshold-fired', 'Alertas por umbral', stats.threshold_fired, { attention: 'warn' }),
        countRow('intel-indicators', 'Indicadores de inteligencia', stats.intel_indicators, { hint: 'listas locales offline; cero sin -intel' }),
        countRow('intel-lists', 'Listas de inteligencia', stats.intel_lists),
        countRow('intel-hits', 'Aciertos de inteligencia', stats.intel_hits, { attention: 'warn', hint: 'indicadores que han alertado' }),
        countRow('baseline-hosts', 'Equipos con línea base', stats.baseline_hosts, { hint: 'línea base de procesos por equipo' }),
        countRow('baseline-learning', 'Equipos aún aprendiendo', stats.baseline_learning),
        countRow('baseline-novelties', 'Novedades de proceso', stats.baseline_novelties, { attention: 'warn', hint: 'procesos nuevos frente a la línea base' }),
      ],
    },
  ]

  const unavailable = [
    'latencias de ingesta y consulta',
    'tamaño del almacén en bytes',
    'versión del motor',
    'certificados por caducar',
    'último informe programado',
  ]

  const bad = sections.some((s) => s.rows.some((r) => r.tone === 'bad'))
  return { sections, unavailable, healthy: !bad }
}

/** Safe triple read: the hub forwards the sinks when the engine reports them. */
function pickTriple(stats: EngineStats, sink: 'webhook' | 'elastic' | 'splunk'): DeliveryTriple | undefined {
  const sent = stats[`${sink}_sent` as keyof EngineStats]
  const failed = stats[`${sink}_failed` as keyof EngineStats]
  const dropped = stats[`${sink}_dropped` as keyof EngineStats]
  if (sent === undefined && failed === undefined && dropped === undefined) return undefined
  return {
    sent: typeof sent === 'number' ? sent : 0,
    failed: typeof failed === 'number' ? failed : 0,
    dropped: typeof dropped === 'number' ? dropped : 0,
  }
}

/** Hot hosts reuse for the view: top score line, already decayed by the engine. */
export function topHostLine(hot: HotHost[] | undefined): string | undefined {
  const first = hot?.[0]
  return first ? `${first.host} · riesgo ${fmt(first.score)}` : undefined
}
