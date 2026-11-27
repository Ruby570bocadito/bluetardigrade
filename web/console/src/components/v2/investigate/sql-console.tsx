'use client'

// Read-only SQL over the engine's evidence database (boceto 7). The engine
// owns every limit (one read-only statement, 5000 rows, 30 s, an audit row
// per attempt); this is the editor with its colours, the schema, a few
// examples, the history of this browser and the results, which can be
// exported. With the surface turned off in the engine it says so.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DownloadSimple, Play } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { tableToCsv } from '@/lib/chart-export'
import { dbQuery, type DbQueryReply } from '@/lib/db-query'
import { download, stamp } from './parts'

const HISTORY_KEY = 'bluetardigrade.v2.sql-history.v1'
const HISTORY_MAX = 15
const SHOWN = 500

const SCHEMA: { table: string; columns: string[] }[] = [
  { table: 'events', columns: ['id', 'ts', 'type', 'host', 'search', 'json'] },
  { table: 'alerts', columns: ['seq', 'ts', 'severity', 'rule_id', 'host', 'search', 'json'] },
]

export const SQL_EXAMPLES: Record<'byType' | 'byHost' | 'rareProcs' | 'alertsByRule', string> = {
  byType: 'SELECT type, COUNT(*) AS eventos\nFROM events\nGROUP BY type\nORDER BY eventos DESC',
  byHost: "SELECT host, COUNT(*) AS eventos,\n       datetime(MAX(ts) / 1000000000, 'unixepoch') AS ultimo\nFROM events\nGROUP BY host\nORDER BY eventos DESC",
  rareProcs:
    "SELECT json_extract(json, '$.process.name') AS proceso,\n       COUNT(DISTINCT host) AS equipos, COUNT(*) AS veces\nFROM events\nWHERE type = 'process.create'\nGROUP BY proceso\nORDER BY equipos ASC, veces ASC\nLIMIT 50",
  alertsByRule: 'SELECT rule_id, severity, COUNT(*) AS alertas\nFROM alerts\nGROUP BY rule_id, severity\nORDER BY alertas DESC',
}

const KEYWORDS = new Set(
  'select from where group by order limit as and or not in is null count distinct min max sum avg join on left inner case when then else end like desc asc having union all with datetime json_extract lower upper strftime between offset'.split(
    ' ',
  ),
)

/** The statement in colours: keywords, strings, numbers and comments. */
function highlight(sql: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(--[^\n]*)|('(?:[^']|'')*'?)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_][A-Za-z0-9_]*)\b/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(sql))) {
    if (m.index > last) out.push(sql.slice(last, m.index))
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : KEYWORDS.has(m[4].toLowerCase()) ? 'k' : null
    out.push(cls ? <span key={i++} data-t={cls}>{m[0]}</span> : m[0])
    last = m.index + m[0].length
  }
  out.push(sql.slice(last) + '\n')
  return out
}

function readHistory(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.length <= 8192).slice(0, HISTORY_MAX) : []
  } catch {
    return []
  }
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

export function SqlConsole({ initial }: { initial: string | null }) {
  const { dict } = useI18n()
  const t = dict.v2.investigateView
  const [sql, setSql] = useState(initial ?? SQL_EXAMPLES.byType)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DbQueryReply | null>(null)
  const [error, setError] = useState<{ off: boolean; message: string } | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const area = useRef<HTMLTextAreaElement>(null)
  const pre = useRef<HTMLPreElement>(null)

  useEffect(() => setHistory(readHistory()), [])
  useEffect(() => {
    if (initial) setSql(initial)
  }, [initial])

  const run = async () => {
    const text = sql.trim()
    if (!text || running) return
    setRunning(true)
    setError(null)
    const res = await dbQuery({ sql: text, max_rows: 1000, timeout_ms: 15000 })
    setRunning(false)
    const next = [text, ...history.filter((h) => h !== text)].slice(0, HISTORY_MAX)
    setHistory(next)
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
    } catch {
      // the history is a convenience; the query already ran
    }
    if (!res.ok) {
      setResult(null)
      setError({ off: res.status === 403 || res.status === 404 || res.status === 405, message: res.error })
      return
    }
    setResult(res.data)
  }

  const insert = (word: string) => {
    const el = area.current
    if (!el) return setSql((s) => s + word)
    const { selectionStart: a, selectionEnd: b } = el
    setSql((s) => s.slice(0, a) + word + s.slice(b))
    window.requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + word.length, a + word.length)
    })
  }

  return (
    <div className="v2-sql">
      <aside className="v2-sql-side">
        <section>
          <h3>{t.sqlSchema}</h3>
          {SCHEMA.map((s) => (
            <div key={s.table} className="v2-sql-table">
              <button type="button" className="v2-link v2-mono" onClick={() => insert(s.table)}>
                {s.table}
              </button>
              <ul>
                {s.columns.map((c) => (
                  <li key={c}>
                    <button type="button" className="v2-sql-col v2-mono" onClick={() => insert(c)}>
                      {c}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="v2-dim v2-small">{t.sqlSchemaNote}</p>
        </section>
        <section>
          <h3>{t.sqlExamples}</h3>
          <ul className="v2-sql-examples">
            {(Object.keys(SQL_EXAMPLES) as (keyof typeof SQL_EXAMPLES)[]).map((k) => (
              <li key={k}>
                <button type="button" className="v2-link" onClick={() => setSql(SQL_EXAMPLES[k])}>
                  {t.sqlExampleNames[k]}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>{t.sqlHistory}</h3>
          {history.length === 0 ? (
            <p className="v2-dim v2-small">{t.sqlHistoryNone}</p>
          ) : (
            <ul className="v2-sql-history">
              {history.map((h) => (
                <li key={h}>
                  <button type="button" className="v2-mono" title={h} onClick={() => setSql(h)}>
                    {h.replace(/\s+/g, ' ')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      <div className="v2-sql-main">
        <div className="v2-sql-bar">
          <span className="v2-dim v2-small">{t.sqlReadOnly}</span>
          <button type="button" className="v2-btn v2-btn-primary" onClick={() => void run()} disabled={running || !sql.trim()} title={t.sqlRunHint}>
            <Play aria-hidden="true" />
            {running ? t.sqlRunning : t.sqlRun}
            <kbd className="v2-kbd">Ctrl ↵</kbd>
          </button>
        </div>
        <div className="v2-sql-editor" data-running={running}>
          <pre ref={pre} className="v2-sql-hl v2-mono" aria-hidden="true">
            {highlight(sql)}
          </pre>
          <textarea
            ref={area}
            className="v2-sql-input v2-mono"
            value={sql}
            spellCheck={false}
            aria-label={t.sqlEditorAria}
            onChange={(e) => setSql(e.target.value)}
            onScroll={(e) => {
              if (pre.current) {
                pre.current.scrollTop = e.currentTarget.scrollTop
                pre.current.scrollLeft = e.currentTarget.scrollLeft
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void run()
              }
            }}
          />
          <i className="v2-sql-progress" aria-hidden="true" />
        </div>

        {error ? (
          error.off ? (
            <div className="v2-notice" role="status">
              <strong>{t.sqlOff}</strong>
              <p className="v2-dim v2-small">{t.sqlOffHint}</p>
              <p className="v2-mono v2-dim v2-small">{error.message}</p>
            </div>
          ) : (
            <p className="v2-error">{t.sqlError(error.message)}</p>
          )
        ) : !result ? (
          <p className="v2-dim v2-small">{t.sqlEmpty}</p>
        ) : (
          <div className="v2-sql-result">
            <div className="v2-sql-bar">
              <span className="v2-small" role="status">
                <span className="v2-mono">{t.sqlRows(result.row_count, result.duration_ms)}</span>
                {result.truncated && <span className="v2-dim"> · {t.sqlTruncated}</span>}
                {result.rows.length > SHOWN && <span className="v2-dim"> · {t.sqlShown(SHOWN)}</span>}
              </span>
              <button
                type="button"
                className="v2-btn"
                disabled={result.rows.length === 0}
                onClick={() =>
                  download(`consulta-${stamp()}.csv`, tableToCsv(result.columns, result.rows.map((r) => r.map((v) => (typeof v === 'number' ? v : cell(v))))), 'text/csv;charset=utf-8')
                }
              >
                <DownloadSimple aria-hidden="true" />
                CSV
              </button>
            </div>
            {result.rows.length === 0 ? (
              <p className="v2-dim v2-small">{t.sqlNoRows}</p>
            ) : (
              <div className="v2-table-wrap">
                <table className="v2-sql-grid">
                  <thead>
                    <tr>
                      {result.columns.map((c) => (
                        <th key={c} scope="col" className="v2-mono">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, SHOWN).map((r, i) => (
                      <tr key={i} style={{ ['--i' as string]: Math.min(i, 20) }}>
                        {r.map((v, j) => (
                          <td key={j} className="v2-mono" data-num={typeof v === 'number'}>
                            {cell(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
