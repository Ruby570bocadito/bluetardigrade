'use client'

// Consulta BD (C-4): read-only SQL console over the engine's evidence
// database (-store, M-4) for analysis the curated endpoints do not cover.
// The engine owns the limits — one SELECT/WITH/VALUES statement, max_rows
// clamped to 5000, a hard time budget, an audit row per attempt — and the
// proxy only lets administrators through; the console adds the form, the
// results table and honest errors. The history lives in session state
// only: nothing about the queries persists in the browser.

import { useState } from 'react'
import { ClockCounterClockwise, Database, Play } from '@phosphor-icons/react'
import { useConsoleUser } from './user-session'
import { useI18n } from './i18n-provider'
import { EmptyState } from './ui-bits'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { dbQuery, DB_QUERY_MAX_ROWS, type DbQueryReply } from '@/lib/db-query'

const ROW_OPTIONS = [100, 500, 1000, 2000, DB_QUERY_MAX_ROWS] as const
const TIMEOUT_OPTIONS = [1000, 5000, 10000, 30000] as const
const HISTORY_MAX = 10

/** One evidence cell: SQLite returns primitives; null gets its own dim
 * rendering and anything structured degrades to JSON text. */
function QueryCell({ value, nullLabel }: { value: unknown; nullLabel: string }) {
  if (value === null || value === undefined) return <span className="italic text-zinc-600">{nullLabel}</span>
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return <span className="block truncate font-mono text-[11px]" title={text}>{text}</span>
}

export function DbQueryView() {
  const { dict } = useI18n()
  const me = useConsoleUser()
  const [sql, setSql] = useState('')
  const [maxRows, setMaxRows] = useState<number>(500)
  const [timeoutMs, setTimeoutMs] = useState<number>(10000)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reply, setReply] = useState<DbQueryReply | null>(null)
  const [history, setHistory] = useState<string[]>([])

  if (me.role !== 'admin') {
    return (
      <section aria-label={dict.dbQuery.sectionAria} className="space-y-4">
        <div className="panel">
          <EmptyState icon={Database} title={dict.dbQuery.notAdminTitle} hint={dict.dbQuery.notAdminHint} />
        </div>
      </section>
    )
  }

  async function run() {
    const statement = sql.trim()
    if (!statement) {
      setError(dict.dbQuery.needSql)
      return
    }
    setBusy(true)
    setError('')
    const res = await dbQuery({ sql: statement, max_rows: maxRows, timeout_ms: timeoutMs })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setReply(res.data)
    setHistory((h) => [statement, ...h.filter((s) => s !== statement)].slice(0, HISTORY_MAX))
  }

  return (
    <section aria-label={dict.dbQuery.sectionAria} className="space-y-4">
      <div className="panel px-5 py-4">
        <p className="text-xs leading-relaxed text-zinc-500">{dict.dbQuery.intro}</p>
        <Textarea
          aria-label={dict.dbQuery.sqlLabel}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              void run()
            }
          }}
          rows={6}
          placeholder={dict.dbQuery.sqlPlaceholder}
          className="mt-3 resize-y font-mono text-xs leading-relaxed"
        />
        <p className="mt-1.5 text-[11px] text-zinc-600">{dict.dbQuery.runHint}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            {dict.dbQuery.rowsLabel}
            <Select value={String(maxRows)} onValueChange={(v) => setMaxRows(Number(v))}>
              <SelectTrigger className="h-7 w-[92px] rounded-md text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROW_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            {dict.dbQuery.timeoutLabel}
            <Select value={String(timeoutMs)} onValueChange={(v) => setTimeoutMs(Number(v))}>
              <SelectTrigger className="h-7 w-[92px] rounded-md text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEOUT_OPTIONS.map((n, i) => <SelectItem key={n} value={String(n)}>{dict.dbQuery.timeouts[i]}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <Button type="button" size="sm" disabled={busy} onClick={() => void run()} className="gap-1.5 rounded-lg text-xs">
            <Play size={13} weight="fill" aria-hidden /> {busy ? dict.dbQuery.running : dict.dbQuery.run}
          </Button>
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{dict.dbQuery.examplesLabel}</span>
        {dict.dbQuery.examples.map((example, i) => (
          <button key={i} type="button" onClick={() => setSql(example)}
            className="max-w-full truncate rounded-md border border-white/10 px-2 py-1 font-mono text-[11px] text-zinc-400 hover:border-white/20 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {example}
          </button>
        ))}
      </div>

      {history.length > 0 && (
        <div className="panel px-5 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            <ClockCounterClockwise size={12} aria-hidden /> {dict.dbQuery.historyLabel}
          </p>
          <ul className="mt-2 space-y-1">
            {history.map((statement, i) => (
              <li key={i}>
                <button type="button" onClick={() => setSql(statement)}
                  className="block w-full truncate rounded-md px-1.5 py-1 text-left font-mono text-[11px] text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {statement}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reply && (
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/[0.06] px-5 py-3">
            <Database size={14} aria-hidden className="text-zinc-400" />
            <span className="text-xs tabular-nums text-zinc-300">{dict.dbQuery.meta(reply.row_count, reply.duration_ms)}</span>
            {reply.truncated && <span className="rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">{dict.dbQuery.truncated}</span>}
          </div>
          {reply.rows.length === 0 ? (
            <EmptyState icon={Database} title={dict.dbQuery.noRows} />
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
                  <TableRow>
                    {reply.columns.map((col) => <TableHead key={col} className="font-mono text-[11px]">{col}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reply.rows.map((row, i) => (
                    <TableRow key={i}>
                      {row.map((value, j) => (
                        <TableCell key={j} className="max-w-[340px] text-zinc-200">
                          <QueryCell value={value} nullLabel={dict.dbQuery.nullValue} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
