'use client'

// Alert triage queue. Each row carries the severity band (semantic color),
// the rule that fired, the MITRE technique and an expandable evidence panel.
// "Analizar con IA" hands the alert to the analyst view.

import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { CaretDown, Sparkle } from '@phosphor-icons/react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useConsole } from './socket-provider'
import { EmptyState, SectionHeader, SeverityBadge } from './ui-bits'
import { SEVERITY_STYLE, formatTime, type SfAlert, type Severity } from '@/lib/console-types'

type Props = {
  compact?: boolean
  onAnalyze?: (alert: SfAlert) => void
}

export function AlertsView({ compact = false, onAnalyze }: Props) {
  const { alerts, status } = useConsole()
  const reduce = useReducedMotion()
  const [sevFilter, setSevFilter] = useState<string>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const visible = useMemo(() => {
    const list = sevFilter === 'all' ? alerts : alerts.filter((a) => a.severity === sevFilter)
    return compact ? list.slice(0, 6) : list
  }, [alerts, sevFilter, compact])

  return (
    <section aria-label="Alertas de detección">
      <SectionHeader
        title="Alertas"
        count={alerts.length}
        action={
          !compact && (
            <Select value={sevFilter} onValueChange={setSevFilter}>
              <SelectTrigger className="h-8 w-[170px] font-mono text-xs" aria-label="Filtrar por severidad">
                <SelectValue placeholder="Severidad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">todas</SelectItem>
                <SelectItem value="critical">critical</SelectItem>
                <SelectItem value="high">high</SelectItem>
                <SelectItem value="medium">medium</SelectItem>
                <SelectItem value="low">low</SelectItem>
              </SelectContent>
            </Select>
          )
        }
      />

      {status !== 'live' && visible.length === 0 ? (
        <div className="h-24 animate-pulse rounded bg-white/5" />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Sin alertas todavía"
          hint="Las detecciones aparecen en cuanto una regla evalúa telemetría sospechosa"
        />
      ) : (
        <ul className="divide-y divide-white/[0.06] border-y border-white/[0.08]">
          {visible.map((al) => {
            const sev = SEVERITY_STYLE[al.severity as Severity] ?? SEVERITY_STYLE.low
            const open = openId === al.id
            const mitre = al.tags.find((t) => t.startsWith('attack.t'))?.replace('attack.', '').toUpperCase()
            return (
              <motion.li
                key={al.id}
                initial={reduce ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="relative"
              >
                <span
                  aria-hidden
                  className={`absolute inset-y-0 left-0 w-[3px] ${sev.bar} ${al.severity === 'critical' && !reduce ? '' : 'opacity-70'}`}
                >
                  {al.severity === 'critical' && !reduce && (
                    <motion.span
                      className={`absolute inset-0 ${sev.bar}`}
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : al.id)}
                  aria-expanded={open}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 pl-5 text-left transition-colors hover:bg-white/[0.03] active:scale-[0.995]"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={al.severity} />
                      <span className="text-sm font-medium text-zinc-100">{al.rule_name}</span>
                      {mitre && <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{mitre}</span>}
                    </span>
                    <span className="mt-1 block truncate font-mono text-xs text-zinc-400">{al.summary}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="hidden font-mono text-xs text-zinc-500 sm:inline">
                      {al.host} {formatTime(al.timestamp)}
                    </span>
                    <CaretDown size={14} className={`text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
                  </span>
                </button>

                {open && (
                  <div className="border-t border-white/[0.06] bg-white/[0.02] px-5 py-4">
                    <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                      <Detail label="Usuario" value={al.user ?? 'n/d'} />
                      <Detail label="Equipo" value={al.host} />
                      <Detail label="Tipo de evento" value={al.event_type} mono />
                      <Detail label="Campos que dispararon la regla" value={al.matched_on.join(', ')} mono />
                      <Detail label="ID de evento" value={al.event_id} mono />
                      <Detail label="ID de regla" value={al.rule_id} mono />
                    </dl>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {al.tags.map((t) => (
                        <span key={t} className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {t}
                        </span>
                      ))}
                    </div>
                    {onAnalyze && (
                      <div className="mt-4">
                        <Button size="sm" onClick={() => onAnalyze(al)} className="gap-1.5 active:scale-[0.98]">
                          <Sparkle size={14} weight="fill" aria-hidden />
                          Analizar con IA
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </motion.li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`truncate text-zinc-300 ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </dd>
    </div>
  )
}
