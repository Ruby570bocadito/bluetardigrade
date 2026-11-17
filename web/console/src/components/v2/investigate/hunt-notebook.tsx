'use client'

// Hunt notebooks (boceto 9): a hypothesis (with its ATT&CK technique),
// the searches that test it — token queries over the engine history or
// SQL — each run in place with its result unfolding below, and the
// findings, which can go to a case as a note. Notebooks live in this
// browser; nothing here writes to the engine except that note.
import { useEffect, useMemo, useState } from 'react'
import { Plus, Play, Trash, X } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { engineCall } from '@/lib/engine-writes'
import { dbQuery } from '@/lib/db-query'
import { formatDateTime, formatTime, type SfEvent } from '@/lib/console-types'
import {
  eventTarget,
  filterEvents,
  historyPath,
  MAX_CELLS,
  newNotebook,
  parseQuery,
  readNotebooks,
  writeNotebooks,
  type HuntCell,
  type HuntNotebook,
} from '@/lib/v2/investigate-model'
import { Empty } from '../home/parts'
import { CasePicker } from './case-picker'
import { KindChip } from './parts'

type CellResult =
  | { kind: 'search'; count: number; sample: SfEvent[]; capped: boolean }
  | { kind: 'sql'; count: number; columns: string[]; rows: unknown[][] }
  | { kind: 'error'; message: string }

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

function store(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function Cell({
  cell,
  onChange,
  onRemove,
  onOpenInFlow,
}: {
  cell: HuntCell
  onChange: (text: string) => void
  onRemove: () => void
  onOpenInFlow: (q: string) => void
}) {
  const { dict, lang } = useI18n()
  const t = dict.v2.investigateView
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CellResult | null>(null)

  const run = async () => {
    const text = cell.text.trim()
    if (!text || running) return
    setRunning(true)
    if (cell.kind === 'search') {
      const tokens = parseQuery(text)
      const res = await engineCall<SfEvent[]>('GET', historyPath(tokens, 'all', Date.now()), undefined, {}, 20000)
      if (!res.ok) setResult({ kind: 'error', message: res.error })
      else {
        const data = Array.isArray(res.data) ? res.data : []
        const hits = filterEvents(data, tokens)
        setResult({ kind: 'search', count: hits.length, sample: hits.slice(0, 5), capped: data.length >= 1000 })
      }
    } else {
      const res = await dbQuery({ sql: text, max_rows: 200, timeout_ms: 15000 })
      if (!res.ok) setResult({ kind: 'error', message: res.status === 403 || res.status === 404 ? `${t.sqlOff}. ${t.sqlOffHint}` : res.error })
      else setResult({ kind: 'sql', count: res.data.row_count, columns: res.data.columns, rows: res.data.rows.slice(0, 5) })
    }
    setRunning(false)
  }

  return (
    <li className="v2-nb-cell" data-kind={cell.kind}>
      <div className="v2-nb-cell-head">
        <span className="v2-tag">{t.nbCellKinds[cell.kind]}</span>
        <div className="v2-actions">
          <button type="button" className="v2-btn v2-btn-primary" onClick={() => void run()} disabled={running || !cell.text.trim()}>
            <Play aria-hidden="true" />
            {running ? t.sqlRunning : t.nbRun}
          </button>
          <button type="button" className="v2-icon-btn" onClick={onRemove} aria-label={t.nbRemoveCell}>
            <Trash aria-hidden="true" />
          </button>
        </div>
      </div>
      <textarea
        className="v2-input v2-textarea v2-mono"
        rows={cell.kind === 'sql' ? 4 : 1}
        value={cell.text}
        placeholder={cell.kind === 'sql' ? t.nbCellPlaceholderSql : t.nbCellPlaceholderSearch}
        aria-label={t.nbCellKinds[cell.kind]}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void run()
          }
        }}
      />
      <div className="v2-nb-result" data-open={!!result}>
        <div>
          {result?.kind === 'error' && <p className="v2-error">{result.message}</p>}
          {result?.kind === 'search' && (
            <>
              <p className="v2-small">
                <b className="v2-mono">{t.nbResultCount(result.count)}</b>
                {result.capped && <span className="v2-dim"> · {t.truncated(1000)}</span>}
                <button type="button" className="v2-link" onClick={() => onOpenInFlow(cell.text)}>
                  {t.nbOpenInFlow}
                </button>
              </p>
              <ul className="v2-tl-list">
                {result.sample.map((e) => (
                  <li key={e.id}>
                    <span className="v2-nb-row">
                      <span className="v2-mono v2-dim">{formatTime(e.timestamp, lang)}</span>
                      <span className="v2-mono">{e.host}</span>
                      <KindChip ev={e} />
                      <span className="v2-mono v2-tl-what">{eventTarget(e) || e.type}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {result?.kind === 'sql' && (
            <>
              <p className="v2-small">
                <b className="v2-mono">{t.nbResultCount(result.count)}</b>
              </p>
              {result.rows.length > 0 && (
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
                      {result.rows.map((r, i) => (
                        <tr key={i}>
                          {r.map((v, j) => (
                            <td key={j} className="v2-mono">
                              {v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  )
}

export function HuntNotebook({ onOpenInFlow, onNotice }: { onOpenInFlow: (q: string) => void; onNotice: (message: string) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.investigateView
  const [books, setBooks] = useState<HuntNotebook[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [technique, setTechnique] = useState('')
  const [finding, setFinding] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const s = store()
    const list = s ? readNotebooks(s) : []
    setBooks(list)
    setCurrentId(list[0]?.id ?? null)
  }, [])

  const save = (next: HuntNotebook[]) => {
    setBooks(next)
    const s = store()
    if (s) writeNotebooks(s, next)
  }
  const current = useMemo(() => books.find((b) => b.id === currentId) ?? null, [books, currentId])
  const patch = (fn: (b: HuntNotebook) => HuntNotebook) => {
    if (!current) return
    save(books.map((b) => (b.id === current.id ? { ...fn(b), updated: new Date().toISOString() } : b)))
  }
  const addCell = (kind: HuntCell['kind']) => patch((b) => ({ ...b, cells: [...b.cells, { id: uid(), kind, text: '' }].slice(0, MAX_CELLS) }))

  useEffect(() => setConfirmDelete(false), [currentId])

  return (
    <div className="v2-nb">
      <aside className="v2-nb-side">
        <div className="v2-nb-side-head">
          <h3>{t.nbTitle}</h3>
          <button type="button" className="v2-btn v2-btn-primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t.nbNew}
          </button>
        </div>
        {creating && (
          <form
            className="v2-nb-new"
            onSubmit={(e) => {
              e.preventDefault()
              if (!title.trim()) return
              const nb = newNotebook(uid(), title, technique, new Date().toISOString())
              save([nb, ...books])
              setCurrentId(nb.id)
              setCreating(false)
              setTitle('')
              setTechnique('')
            }}
          >
            <label className="v2-field">
              {t.nbHypothesis}
              <input className="v2-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.nbHypothesisPlaceholder} maxLength={140} autoFocus />
            </label>
            <label className="v2-field">
              {t.nbTechnique}
              <input className="v2-input v2-mono" value={technique} onChange={(e) => setTechnique(e.target.value.toUpperCase())} placeholder="T1053.005" maxLength={16} />
            </label>
            <div className="v2-actions">
              <button type="submit" className="v2-btn v2-btn-primary" disabled={!title.trim()}>
                {t.nbCreate}
              </button>
              <button type="button" className="v2-btn" onClick={() => setCreating(false)}>
                {t.nbCancel}
              </button>
            </div>
          </form>
        )}
        {books.length === 0 && !creating ? (
          <p className="v2-dim v2-small">{t.nbNoneHint}</p>
        ) : (
          <ul className="v2-nb-list">
            {books.map((b) => (
              <li key={b.id}>
                <button type="button" aria-current={b.id === currentId ? 'true' : undefined} onClick={() => setCurrentId(b.id)}>
                  <strong>{b.title}</strong>
                  <span className="v2-dim v2-small">
                    {b.technique && <span className="v2-mono">{b.technique} · </span>}
                    {t.nbCounts(b.cells.length, b.findings.length)} · {formatDateTime(b.updated, lang)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="v2-dim v2-small">{t.nbSavedLocal}</p>
      </aside>

      <div className="v2-nb-main">
        {!current ? (
          <Empty title={t.nbNone}>{t.nbNoneHint}</Empty>
        ) : (
          <>
            <header className="v2-nb-hypo">
              <span className="v2-dim v2-small">{t.nbHypothesis}</span>
              <h2>{current.title}</h2>
              {current.technique && <span className="v2-tag v2-mono">{current.technique}</span>}
              <button
                type="button"
                className="v2-link v2-nb-delete"
                onClick={() => {
                  if (!confirmDelete) return setConfirmDelete(true)
                  const rest = books.filter((b) => b.id !== current.id)
                  save(rest)
                  setCurrentId(rest[0]?.id ?? null)
                }}
              >
                {confirmDelete ? t.nbDeleteConfirm : t.nbDelete}
              </button>
            </header>

            <section>
              <h3>{t.nbCells}</h3>
              {current.cells.length === 0 && <p className="v2-dim v2-small">{t.nbCells0}</p>}
              <ol className="v2-nb-cells">
                {current.cells.map((c) => (
                  <Cell
                    key={c.id}
                    cell={c}
                    onChange={(text) => patch((b) => ({ ...b, cells: b.cells.map((x) => (x.id === c.id ? { ...x, text: text.slice(0, 8192) } : x)) }))}
                    onRemove={() => patch((b) => ({ ...b, cells: b.cells.filter((x) => x.id !== c.id) }))}
                    onOpenInFlow={onOpenInFlow}
                  />
                ))}
              </ol>
              <div className="v2-actions">
                <button type="button" className="v2-btn" onClick={() => addCell('search')} disabled={current.cells.length >= MAX_CELLS}>
                  <Plus aria-hidden="true" />
                  {t.nbAddSearch}
                </button>
                <button type="button" className="v2-btn" onClick={() => addCell('sql')} disabled={current.cells.length >= MAX_CELLS}>
                  <Plus aria-hidden="true" />
                  {t.nbAddSql}
                </button>
              </div>
            </section>

            <section>
              <h3>{t.nbFindings}</h3>
              {current.findings.length === 0 ? (
                <p className="v2-dim v2-small">{t.nbNoFindings}</p>
              ) : (
                <ul className="v2-nb-findings">
                  {current.findings.map((f) => (
                    <li key={f.id}>
                      <p>{f.text}</p>
                      <span className="v2-dim v2-small v2-mono">{formatDateTime(f.at, lang)}</span>
                      <div className="v2-actions">
                        <CasePicker compact note={t.nbFindingNote(current.title, f.text)} onDone={onNotice} />
                        <button
                          type="button"
                          className="v2-icon-btn"
                          aria-label={t.nbRemoveCell}
                          onClick={() => patch((b) => ({ ...b, findings: b.findings.filter((x) => x.id !== f.id) }))}
                        >
                          <X aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="v2-nb-finding-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  const text = finding.trim()
                  if (!text) return
                  patch((b) => ({ ...b, findings: [...b.findings, { id: uid(), text: text.slice(0, 2000), at: new Date().toISOString() }].slice(-50) }))
                  setFinding('')
                }}
              >
                <input className="v2-input" value={finding} onChange={(e) => setFinding(e.target.value)} placeholder={t.nbFindingPlaceholder} aria-label={t.nbFindingPlaceholder} maxLength={2000} />
                <button type="submit" className="v2-btn" disabled={!finding.trim()}>
                  {t.nbAddFinding}
                </button>
              </form>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
