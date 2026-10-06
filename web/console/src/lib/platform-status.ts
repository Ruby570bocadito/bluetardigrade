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
// the last scheduled report — the merged engine (f8853eb) publishes the
// first four in /api/stats and this report renders them in their own
// rows; only the last scheduled report stays in `unavailable` (and each
// row still degrades to «no publicado» against older engines).
//
// Ronda 12: IMP-A published the v1.1 per-team admission quotas and the
// in-memory ring rotation counters (beacon/threshold_quota_rejected,
// ring_dropped_events/alerts, quota_top_hosts worst-first top 8) — the
// rows this page promised to add "as soon as they exist". They live in
// their own section plus two ring rows in the correlator section; an
// older engine that omits them keeps the honest «no publicado».
//
// Language: the lib renders the display strings, so the language rides
// in (default 'es', byte-identical to the pre-i18n labels; EN twin for
// the operator's console choice). Number formatting follows the lang.

import { formatUptime, type EngineStats, type HotHost, type QuotaHostRow } from './console-types'
import type { Lang } from './i18n'

/** Byte size in operator units (KiB/MiB/GiB); pure so tests pin it. */
export function formatBytes(bytes: number, lang: Lang = 'es'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${fmt2(bytes, lang)} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 'B'
  for (const u of units) {
    value /= 1024
    unit = u
    if (value < 1024) break
  }
  return `${value.toLocaleString(localeOf(lang), { maximumFractionDigits: 1 })} ${unit}`
}

/** Certificate expiry tone: operational thresholds chosen here (the
 * engine publishes the date; it sets no policy): warn under 30 days,
 * bad under 7. Both need a published date — no invented urgency. */
export function certTone(notAfter: string, now = new Date()): StatusTone {
  if (!notAfter) return 'neutral'
  const t = Date.parse(notAfter)
  if (Number.isNaN(t)) return 'neutral'
  const days = (t - now.getTime()) / 86_400_000
  return days < 7 ? 'bad' : days < 30 ? 'warn' : 'ok'
}

export type StatusTone = 'neutral' | 'ok' | 'warn' | 'bad'

/** One metric row of a section; `fill` renders a capacity meter. */
export type StatusRow = {
  key: string
  label: string
  /** Pre-rendered display value in the requested language; the view stays dumb. */
  display: string
  /** True when the engine does not publish this metric (display says so). */
  absent?: boolean
  /** Short operator-facing explanation, already in the requested language. */
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

function localeOf(lang: Lang): string {
  return lang === 'en' ? 'en-US' : 'es-ES'
}

const fmt2 = (n: number, lang: Lang) => n.toLocaleString(localeOf(lang))

// The lib's whole vocabulary, per language. ES is byte-identical to the
// pre-i18n labels (the lib battery pins them); EN is the console twin.
const T = {
  es: {
    notPublished: 'no publicado',
    idle: 'sin actividad',
    delivery: (sent: number, failed: number, dropped: number) => `${sent.toLocaleString('es-ES')} enviados · ${failed.toLocaleString('es-ES')} fallidos · ${dropped.toLocaleString('es-ES')} descartados`,
    motorTitle: 'Motor',
    uptime: 'Tiempo encendido',
    uptimeHint: 'desde el arranque del proceso del motor',
    mode: 'Modo',
    modeEngine: 'conectado al motor',
    modeLocal: 'sin motor (vista local)',
    modeHint: 'fuente de los datos de esta consola',
    rulesLoaded: 'Reglas cargadas',
    rulesTypes: 'tipos: ',
    version: 'Versión del motor',
    versionHint: 'la que reporta el propio proceso del motor',
    ingestaTitle: 'Ingesta',
    eventsAccepted: 'Eventos aceptados',
    sinceBoot: 'desde el arranque',
    currentRate: 'Ritmo actual',
    perMin: 'eventos/min',
    dropped: 'Eventos descartados',
    droppedHint: 'búfer de ingesta saturado o telemetría malformada',
    rejected: 'Conexiones sin credencial',
    rejectedHint: 'señal de sondeos del puerto de ingesta cuando hay -token',
    identities: 'Identidades de ingesta',
    identitiesHint: 'vinculación host–sensor del alta (cuando está armada)',
    violations: 'Violaciones de identidad',
    violationsHint: 'eventos que reclaman un host fuera de su vinculación',
    latencyLabel: 'Latencia ingesta→alerta',
    latencyDetail: ' (p50 · p95 · máx)',
    latencyNone: 'sin alertas aún desde el arranque',
    latencyHint: (count: number) => `medido sobre ${count.toLocaleString('es-ES')} alertas; de la marca temporal del sensor al disparo (transporte + cola + detección)`,
    colasTitle: 'Colas y correlación',
    buffer: 'Búfer de eventos',
    bufferHint: 'cola viva del stream, no persistida',
    chains: 'Cadenas en curso',
    chainsOf: (states: number, cap: number) => `${states.toLocaleString('es-ES')} de ${cap.toLocaleString('es-ES')} plazas`,
    chainsHintLive: 'secuencias (host, etapa) vivas del correlador de kill chain',
    chainsHintOff: 'todo a cero: correlador sin secuencias cargadas o desactivado',
    sequences: 'Secuencias cargadas',
    riskHosts: 'Hosts con riesgo',
    riskHint: 'ancho de la señal del score A1 (riesgo no frío)',
    hotHosts: 'Hosts calientes',
    hotHint: 'top-5 publicado por el motor',
    beacons: 'Beacons en seguimiento',
    beaconsHint: 'perfiles de beaconing vivos del detector (A3)',
    beaconsFired: 'Beacons disparados',
    beaconsFiredHint: 'alertas de beaconing desde el arranque',
    ringEvents: 'Eventos rotados del anillo',
    ringAlerts: 'Alertas rotadas del anillo',
    ringHint: 'recorte más-antiguo-primero del anillo en memoria; el historial completo queda en SQLite con -store',
    almacenTitle: 'Almacén',
    almacenHint: 'persistencia SQLite opcional (engine -store)',
    persistence: 'Persistencia',
    persistenceOn: 'activa (-store)',
    persistenceOff: 'sin persistencia',
    persistenceHint: 'los contadores siguientes solo aplican con -store',
    storeAbsentHint: 'motor antiguo o arranque sin -store',
    storeEvents: 'Eventos almacenados',
    storeAlerts: 'Alertas almacenadas',
    storeFailures: 'Fallos de escritura',
    storeFailuresHint: 'escrituras de eventos o alertas fallidas desde el arranque de la API',
    storeConflicts: 'Conflictos de id',
    storeConflictsHint: 'eventos reenviados con otra carga útil; se conserva la copia almacenada',
    storeSize: 'Tamaño en disco',
    storeSizeOff: 'sin almacén',
    storeSizeOffHint: 'el motor corre sin -store',
    storeSizeHint: 'fichero SQLite del almacén (-store)',
    entregaTitle: 'Entrega externa',
    entregaHint: 'contadores de entrega vistos desde fuera del motor',
    webhook: 'Webhook',
    webhookHint: 'conector -webhook del motor',
    elastic: 'Elastic',
    elasticHint: 'indexado por lotes (-elastic)',
    splunk: 'Splunk',
    splunkHint: 'eventos HEC (-splunk)',
    channel: (name: string, type: string) => `Canal «${name}» (${type})`,
    channelHint: 'entrega del canal de notificación del motor',
    channelsLabel: 'Canales de notificación',
    channelsHint: 'reenvío pendiente o motor antiguo',
    certTitle: 'Certificados',
    certHint: 'caducidad de los dos escuchas TLS del motor',
    certApi: 'Certificado de la API',
    certIngest: 'Certificado de ingesta',
    noTls: 'sin TLS (texto en claro)',
    noTlsHint: 'el escucha corre sin -tls: sin certificado que caduque',
    certExpires: ' · caduca ',
    certConfigured: 'certificado configurado',
    deteccionTitle: 'Detección auxiliar',
    suppressions: 'Supresiones activas',
    suppressionsHint: 'entradas no expiradas de la lista del operador',
    thresholdRules: 'Definiciones de umbral',
    thresholdRulesHint: 'detector volumétrico (A2); todo a cero sin -thresholds',
    thresholdKeys: 'Claves de umbral en seguimiento',
    thresholdFired: 'Alertas por umbral',
    intelIndicators: 'Indicadores de inteligencia',
    intelIndicatorsHint: 'listas locales offline; cero sin -intel',
    intelLists: 'Listas de inteligencia',
    intelHits: 'Aciertos de inteligencia',
    intelHitsHint: 'indicadores que han alertado',
    baselineHosts: 'Equipos con línea base',
    baselineHint: 'línea base de procesos por equipo',
    baselineLearning: 'Equipos aún aprendiendo',
    baselineNovelties: 'Novedades de proceso',
    baselineNoveltiesHint: 'procesos nuevos frente a la línea base',
    cuotasTitle: 'Cuotas por equipo',
    cuotasHint: 'admisión v1.1: un equipo ruidoso no puede ahogar a los demás',
    quotaBeacon: 'Beacons nuevos rechazados',
    quotaBeaconHint: 'la cuota propia del equipo estaba llena; sus claves existentes siguen contando y disparando',
    quotaThreshold: 'Umbrales nuevos rechazados',
    quotaThresholdHint: 'misma semántica de admisión que la cuota por regla; la evidencia muerta se purga antes del rechazo',
    quotaHosts: 'Presión por equipo (peor primero)',
    quotaHostsHint: 'rotación del anillo y rechazos de admisión por equipo; tope de 8 filas',
    quotaHostEmpty: 'sin rechazos ni rotación por equipo desde el arranque',
    quotaRow: (r: QuotaHostRow) => `anillo ${r.ring_events.toLocaleString('es-ES')} ev · ${r.ring_alerts.toLocaleString('es-ES')} al · beacon ${r.beacon.toLocaleString('es-ES')} · umbral ${r.threshold.toLocaleString('es-ES')}`,
    unavailableLastReport: 'último informe programado',
    riskWord: 'riesgo',
    oldEngine: 'motor anterior a f8853eb',
  },
  en: {
    notPublished: 'not published',
    idle: 'no activity',
    delivery: (sent: number, failed: number, dropped: number) => `${sent.toLocaleString('en-US')} sent · ${failed.toLocaleString('en-US')} failed · ${dropped.toLocaleString('en-US')} dropped`,
    motorTitle: 'Engine',
    uptime: 'Uptime',
    uptimeHint: 'since the engine process started',
    mode: 'Mode',
    modeEngine: 'connected to the engine',
    modeLocal: 'no engine (local view)',
    modeHint: 'where this console\'s data comes from',
    rulesLoaded: 'Rules loaded',
    rulesTypes: 'types: ',
    version: 'Engine version',
    versionHint: 'as reported by the engine process itself',
    ingestaTitle: 'Ingest',
    eventsAccepted: 'Events accepted',
    sinceBoot: 'since startup',
    currentRate: 'Current rate',
    perMin: 'events/min',
    dropped: 'Events dropped',
    droppedHint: 'saturated ingest buffer or malformed telemetry',
    rejected: 'Connections without credential',
    rejectedHint: 'probing of the ingest port when -token is on',
    identities: 'Ingest identities',
    identitiesHint: 'host–sensor binding of enrollment (when armed)',
    violations: 'Identity violations',
    violationsHint: 'events claiming a host outside its binding',
    latencyLabel: 'Ingest→alert latency',
    latencyDetail: ' (p50 · p95 · max)',
    latencyNone: 'no alerts yet since startup',
    latencyHint: (count: number) => `measured over ${count.toLocaleString('en-US')} alerts; from the sensor timestamp to the firing (transport + queue + detection)`,
    colasTitle: 'Queues and correlation',
    buffer: 'Event buffer',
    bufferHint: 'live stream queue, not persisted',
    chains: 'Chains in flight',
    chainsOf: (states: number, cap: number) => `${states.toLocaleString('en-US')} of ${cap.toLocaleString('en-US')} slots`,
    chainsHintLive: 'live (host, stage) sequences of the kill-chain correlator',
    chainsHintOff: 'all zero: correlator with no sequences loaded or disabled',
    sequences: 'Sequences loaded',
    riskHosts: 'Hosts with risk',
    riskHint: 'width of the A1 score signal (non-cold risk)',
    hotHosts: 'Hot hosts',
    hotHint: 'top-5 published by the engine',
    beacons: 'Beacons tracked',
    beaconsHint: 'live beaconing profiles of the detector (A3)',
    beaconsFired: 'Beacons fired',
    beaconsFiredHint: 'beaconing alerts since startup',
    ringEvents: 'Events rotated out of the ring',
    ringAlerts: 'Alerts rotated out of the ring',
    ringHint: 'oldest-first trim of the in-memory ring; full history stays in SQLite with -store',
    almacenTitle: 'Store',
    almacenHint: 'optional SQLite persistence (engine -store)',
    persistence: 'Persistence',
    persistenceOn: 'active (-store)',
    persistenceOff: 'no persistence',
    persistenceHint: 'the counters below only apply with -store',
    storeAbsentHint: 'older engine or startup without -store',
    storeEvents: 'Events stored',
    storeAlerts: 'Alerts stored',
    storeFailures: 'Write failures',
    storeFailuresHint: 'failed event or alert writes since the API started',
    storeConflicts: 'Id conflicts',
    storeConflictsHint: 'events re-sent with a different payload; the stored copy is kept',
    storeSize: 'Disk size',
    storeSizeOff: 'no store',
    storeSizeOffHint: 'the engine runs without -store',
    storeSizeHint: 'the store\'s SQLite file (-store)',
    entregaTitle: 'External delivery',
    entregaHint: 'delivery counters seen from outside the engine',
    webhook: 'Webhook',
    webhookHint: 'the engine\'s -webhook connector',
    elastic: 'Elastic',
    elasticHint: 'batch indexing (-elastic)',
    splunk: 'Splunk',
    splunkHint: 'HEC events (-splunk)',
    channel: (name: string, type: string) => `Channel «${name}» (${type})`,
    channelHint: 'delivery of the engine\'s notify channel',
    channelsLabel: 'Notify channels',
    channelsHint: 'forwarding pending or older engine',
    certTitle: 'Certificates',
    certHint: 'expiry of the engine\'s two TLS listeners',
    certApi: 'API certificate',
    certIngest: 'Ingest certificate',
    noTls: 'no TLS (plaintext)',
    noTlsHint: 'the listener runs without -tls: no certificate to expire',
    certExpires: ' · expires ',
    certConfigured: 'configured certificate',
    deteccionTitle: 'Auxiliary detection',
    suppressions: 'Active suppressions',
    suppressionsHint: 'non-expired entries of the operator\'s list',
    thresholdRules: 'Threshold definitions',
    thresholdRulesHint: 'volumetric detector (A2); all zero without -thresholds',
    thresholdKeys: 'Threshold keys tracked',
    thresholdFired: 'Threshold alerts',
    intelIndicators: 'Intel indicators',
    intelIndicatorsHint: 'offline local lists; zero without -intel',
    intelLists: 'Intel lists',
    intelHits: 'Intel hits',
    intelHitsHint: 'indicators that have alerted',
    baselineHosts: 'Hosts with a baseline',
    baselineHint: 'per-host process baseline',
    baselineLearning: 'Hosts still learning',
    baselineNovelties: 'Process novelties',
    baselineNoveltiesHint: 'new processes against the baseline',
    cuotasTitle: 'Per-host quotas',
    cuotasHint: 'v1.1 admission: one noisy host cannot wash the others out',
    quotaBeacon: 'New beacons refused',
    quotaBeaconHint: 'the host\'s own quota was full; its existing keys keep counting and firing',
    quotaThreshold: 'New thresholds refused',
    quotaThresholdHint: 'same admission semantics as the per-rule quota; dead evidence is purged before the refusal',
    quotaHosts: 'Per-host pressure (worst first)',
    quotaHostsHint: 'ring rotation and admission refusals per host; capped at 8 rows',
    quotaHostEmpty: 'no per-host refusals or rotation since startup',
    quotaRow: (r: QuotaHostRow) => `ring ${r.ring_events.toLocaleString('en-US')} ev · ${r.ring_alerts.toLocaleString('en-US')} al · beacon ${r.beacon.toLocaleString('en-US')} · threshold ${r.threshold.toLocaleString('en-US')}`,
    unavailableLastReport: 'last scheduled report',
    riskWord: 'risk',
    oldEngine: 'engine predating f8853eb',
  },
} as const

const NOT_PUBLISHED_ES = 'no publicado'
const fmt = (n: number) => n.toLocaleString('es-ES')

/** Delivery triple (sent/failed/dropped) shared by webhook, elastic and splunk. */
type DeliveryTriple = { sent: number; failed: number; dropped: number }

type Ctx = { lang: Lang; t: (typeof T)['es'] | (typeof T)['en'] }

function deliveryRow(ctx: Ctx, key: string, label: string, triple: DeliveryTriple | undefined, hint: string): StatusRow {
  const { t } = ctx
  if (!triple) {
    return { key, label, display: t.notPublished, absent: true, hint, tone: 'neutral' }
  }
  const idle = triple.sent === 0 && triple.failed === 0 && triple.dropped === 0
  const broken = triple.failed > 0 || triple.dropped > 0
  return {
    key,
    label,
    display: idle ? t.idle : t.delivery(triple.sent, triple.failed, triple.dropped),
    hint,
    tone: broken ? 'bad' : 'neutral',
  }
}

function countRow(ctx: Ctx, key: string, label: string, value: number | undefined, opts: {
  hint?: string
  /** value > 0 marks attention (failures, violations, losses). */
  attention?: 'warn' | 'bad'
  /** Render the number plus this suffix when present. */
  suffix?: string
} = {}): StatusRow {
  const { t, lang } = ctx
  if (value === undefined || !Number.isFinite(value)) {
    return { key, label, display: t.notPublished, absent: true, hint: opts.hint, tone: 'neutral' }
  }
  return {
    key,
    label,
    display: `${fmt2(value, lang)}${opts.suffix ? ' ' + opts.suffix : ''}`,
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

function channelRows(ctx: Ctx, channels: EngineStats['notify_channels']): { rows: StatusRow[]; hidden: number } {
  const { t } = ctx
  if (!channels) {
    return {
      rows: [{ key: 'notify', label: t.channelsLabel, display: t.notPublished, absent: true, hint: t.channelsHint, tone: 'neutral' }],
      hidden: 0,
    }
  }
  const rows = channels.slice(0, MAX_CHANNEL_ROWS).map((c, i) =>
    deliveryRow(ctx, 'notify-' + i, t.channel(c.name, c.type), { sent: c.sent, failed: c.failed, dropped: c.dropped }, t.channelHint),
  )
  return { rows, hidden: Math.max(0, channels.length - MAX_CHANNEL_ROWS) }
}

/** The whole report; null stays null so the view keeps its empty state. */
export function platformStatus(stats: EngineStats | null, lang: Lang = 'es'): PlatformStatusReport | null {
  if (!stats) return null
  const ctx: Ctx = { lang, t: T[lang] }
  const { t } = ctx

  const mode = stats.mode ?? 'engine'
  const correlatorLive = (stats.correlator_cap ?? 0) > 0
  const channels = channelRows(ctx, stats.notify_channels)

  const sections: StatusSection[] = [
    {
      key: 'motor',
      title: t.motorTitle,
      rows: [
        {
          key: 'uptime',
          label: t.uptime,
          display: formatUptime(stats.uptime_s),
          hint: t.uptimeHint,
          tone: 'neutral',
        },
        {
          key: 'mode',
          label: t.mode,
          display: mode === 'engine' ? t.modeEngine : t.modeLocal,
          hint: t.modeHint,
          tone: 'neutral',
        },
        countRow(ctx, 'rules', t.rulesLoaded, stats.rules_count, {
          hint: stats.rules_types.length ? t.rulesTypes + stats.rules_types.join(', ') : undefined,
        }),
        {
          key: 'version',
          label: t.version,
          display: stats.version ?? t.notPublished,
          absent: stats.version === undefined,
          hint: t.versionHint,
          tone: 'neutral',
        },
      ],
    },
    {
      key: 'ingesta',
      title: t.ingestaTitle,
      rows: [
        countRow(ctx, 'events', t.eventsAccepted, stats.events_total, { hint: t.sinceBoot }),
        countRow(ctx, 'rate', t.currentRate, stats.events_per_min, { suffix: t.perMin }),
        countRow(ctx, 'dropped', t.dropped, stats.dropped, { attention: 'warn', hint: t.droppedHint }),
        countRow(ctx, 'rejected', t.rejected, stats.ingest_rejected, { attention: 'warn', hint: t.rejectedHint }),
        countRow(ctx, 'identities', t.identities, stats.ingest_identities, { hint: t.identitiesHint }),
        countRow(ctx, 'violations', t.violations, stats.ingest_identity_violations, { attention: 'bad', hint: t.violationsHint }),
        latencyRows(ctx, stats.alert_latency),
      ],
    },
    {
      key: 'colas',
      title: t.colasTitle,
      rows: [
        countRow(ctx, 'buffered', t.buffer, stats.events_buffered, { hint: t.bufferHint }),
        {
          key: 'chains',
          label: t.chains,
          display: t.chainsOf(stats.correlator_states, stats.correlator_cap),
          hint: correlatorLive ? t.chainsHintLive : t.chainsHintOff,
          tone: 'neutral',
          fill: correlatorLive
            ? { value: stats.correlator_states, max: stats.correlator_cap, color: fillColor(stats.correlator_states, stats.correlator_cap) }
            : undefined,
        },
        countRow(ctx, 'sequences', t.sequences, stats.correlator_sequences),
        countRow(ctx, 'risk', t.riskHosts, stats.risk_hosts_tracked, { hint: t.riskHint }),
        countRow(ctx, 'hot', t.hotHosts, stats.hot_hosts?.length, { hint: t.hotHint }),
        {
          key: 'beacons',
          label: t.beacons,
          display: stats.beacons_cap === undefined
            ? t.notPublished
            : t.chainsOf(stats.beacons_tracked ?? 0, stats.beacons_cap),
          absent: stats.beacons_cap === undefined,
          hint: t.beaconsHint,
          tone: stats.beacons_cap !== undefined && (stats.beacons_tracked ?? 0) >= stats.beacons_cap ? 'warn' : 'neutral',
          fill: stats.beacons_cap
            ? { value: stats.beacons_tracked ?? 0, max: stats.beacons_cap, color: fillColor(stats.beacons_tracked ?? 0, stats.beacons_cap) }
            : undefined,
        },
        countRow(ctx, 'beacons-fired', t.beaconsFired, stats.beacons_fired, { attention: 'warn', hint: t.beaconsFiredHint }),
        countRow(ctx, 'ring-events', t.ringEvents, stats.ring_dropped_events, { attention: 'warn', hint: t.ringHint }),
        countRow(ctx, 'ring-alerts', t.ringAlerts, stats.ring_dropped_alerts, { attention: 'warn', hint: t.ringHint }),
      ],
    },
    {
      key: 'almacen',
      title: t.almacenTitle,
      hint: t.almacenHint,
      rows: [
        stats.store_enabled === undefined
          ? { key: 'store', label: t.persistence, display: t.notPublished, absent: true, hint: t.storeAbsentHint, tone: 'neutral' }
          : {
              key: 'store',
              label: t.persistence,
              display: stats.store_enabled ? t.persistenceOn : t.persistenceOff,
              hint: t.persistenceHint,
              tone: 'neutral',
            },
        countRow(ctx, 'store-events', t.storeEvents, stats.store_events),
        countRow(ctx, 'store-alerts', t.storeAlerts, stats.store_alerts),
        countRow(ctx, 'store-failures', t.storeFailures, stats.store_write_failures, { attention: 'bad', hint: t.storeFailuresHint }),
        countRow(ctx, 'store-conflicts', t.storeConflicts, stats.store_id_conflicts, { attention: 'warn', hint: t.storeConflictsHint }),
        storeSizeRow(ctx, stats),
      ],
    },
    {
      key: 'entrega',
      title: t.entregaTitle,
      hint: t.entregaHint,
      rows: [
        deliveryRow(ctx, 'webhook', t.webhook, pickTriple(stats, 'webhook'), t.webhookHint),
        deliveryRow(ctx, 'elastic', t.elastic, pickTriple(stats, 'elastic'), t.elasticHint),
        deliveryRow(ctx, 'splunk', t.splunk, pickTriple(stats, 'splunk'), t.splunkHint),
        ...channels.rows,
      ],
    },
    {
      key: 'certificados',
      title: t.certTitle,
      hint: t.certHint,
      rows: [
        certRow(ctx, 'cert-api', t.certApi, stats.certificates?.api),
        certRow(ctx, 'cert-ingest', t.certIngest, stats.certificates?.ingest),
      ],
    },
    {
      key: 'deteccion',
      title: t.deteccionTitle,
      rows: [
        countRow(ctx, 'suppressions', t.suppressions, stats.suppressions_active, { hint: t.suppressionsHint }),
        countRow(ctx, 'threshold-rules', t.thresholdRules, stats.threshold_rules, { hint: t.thresholdRulesHint }),
        countRow(ctx, 'threshold-keys', t.thresholdKeys, stats.threshold_keys),
        countRow(ctx, 'threshold-fired', t.thresholdFired, stats.threshold_fired, { attention: 'warn' }),
        countRow(ctx, 'intel-indicators', t.intelIndicators, stats.intel_indicators, { hint: t.intelIndicatorsHint }),
        countRow(ctx, 'intel-lists', t.intelLists, stats.intel_lists),
        countRow(ctx, 'intel-hits', t.intelHits, stats.intel_hits, { attention: 'warn', hint: t.intelHitsHint }),
        countRow(ctx, 'baseline-hosts', t.baselineHosts, stats.baseline_hosts, { hint: t.baselineHint }),
        countRow(ctx, 'baseline-learning', t.baselineLearning, stats.baseline_learning),
        countRow(ctx, 'baseline-novelties', t.baselineNovelties, stats.baseline_novelties, { attention: 'warn', hint: t.baselineNoveltiesHint }),
      ],
    },
    {
      key: 'cuotas',
      title: t.cuotasTitle,
      hint: t.cuotasHint,
      rows: [
        countRow(ctx, 'quota-beacon', t.quotaBeacon, stats.beacon_quota_rejected, { attention: 'warn', hint: t.quotaBeaconHint }),
        countRow(ctx, 'quota-threshold', t.quotaThreshold, stats.threshold_quota_rejected, { attention: 'warn', hint: t.quotaThresholdHint }),
        ...quotaHostRows(ctx, stats.quota_top_hosts),
      ],
    },
  ]

  const unavailable = [
    t.unavailableLastReport,
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

/** Bounded worst-first per-host pressure rows; absent engine stays absent. */
function quotaHostRows(ctx: Ctx, rows: QuotaHostRow[] | undefined): StatusRow[] {
  const { t } = ctx
  if (!rows) {
    return [{ key: 'quota-hosts', label: t.quotaHosts, display: t.notPublished, absent: true, hint: t.quotaHostsHint, tone: 'neutral' }]
  }
  if (rows.length === 0) {
    return [{ key: 'quota-hosts', label: t.quotaHosts, display: t.quotaHostEmpty, hint: t.quotaHostsHint, tone: 'neutral' }]
  }
  return rows.slice(0, 8).map((r, i) => ({
    key: `quota-host-${i}`,
    label: r.host,
    display: t.quotaRow(r),
    hint: t.quotaHostsHint,
    tone: 'neutral' as const,
  }))
}

/** SET-3: ingest→alert latency, one expandable triple. Tone stays
 * neutral: the engine publishes no SLA threshold and none is invented. */
function latencyRows(ctx: Ctx, lat: EngineStats['alert_latency']): StatusRow {
  const { t, lang } = ctx
  if (!lat) {
    return { key: 'alert-latency', label: t.latencyLabel, display: t.notPublished, absent: true, hint: t.oldEngine, tone: 'neutral' }
  }
  const fmtMs = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString(localeOf(lang), { maximumFractionDigits: 2 })} s` : `${v.toLocaleString(localeOf(lang), { maximumFractionDigits: 1 })} ms`)
  return {
    key: 'alert-latency',
    label: t.latencyLabel + t.latencyDetail,
    display: lat.count === 0
      ? t.latencyNone
      : `${fmtMs(lat.p50_ms)} · ${fmtMs(lat.p95_ms)} · ${fmtMs(lat.max_ms)}`,
    hint: t.latencyHint(lat.count),
    tone: 'neutral',
  }
}

/** SET-3: the durable store's on-disk size, human-readable. */
function storeSizeRow(ctx: Ctx, stats: EngineStats): StatusRow {
  const { t } = ctx
  if (stats.store_size_bytes === undefined) {
    return { key: 'store-size', label: t.storeSize, display: t.notPublished, absent: true, hint: t.oldEngine, tone: 'neutral' }
  }
  if (stats.store_enabled === false) {
    return { key: 'store-size', label: t.storeSize, display: t.storeSizeOff, hint: t.storeSizeOffHint, tone: 'neutral' }
  }
  return {
    key: 'store-size',
    label: t.storeSize,
    display: formatBytes(stats.store_size_bytes, ctx.lang),
    hint: t.storeSizeHint,
    tone: 'neutral',
  }
}

/** SET-3: one TLS listener's certificate row. */
function certRow(ctx: Ctx, key: string, label: string, cert: EngineCertificatesLike | undefined): StatusRow {
  const { t, lang } = ctx
  if (!cert) {
    return { key, label, display: t.notPublished, absent: true, hint: t.oldEngine, tone: 'neutral' }
  }
  if (!cert.present) {
    return { key, label, display: t.noTls, hint: t.noTlsHint, tone: 'neutral' }
  }
  const tone = certTone(cert.not_after)
  const when = cert.not_after ? new Date(cert.not_after).toLocaleString(localeOf(lang), { hour12: false }) : '—'
  return {
    key,
    label,
    display: when,
    hint: `${cert.path || t.certConfigured}${t.certExpires}${when}`,
    tone,
  }
}

type EngineCertificatesLike = { present: boolean; not_after: string; path: string }

/** Hot hosts reuse for the view: top score line, already decayed by the engine. */
export function topHostLine(hot: HotHost[] | undefined, lang: Lang = 'es'): string | undefined {
  const first = hot?.[0]
  return first ? `${first.host} · ${T[lang].riskWord} ${fmt2(first.score, lang)}` : undefined
}

// Spanish literal kept for the lib's own tests and any unswept consumer.
export const NOT_PUBLISHED = NOT_PUBLISHED_ES
