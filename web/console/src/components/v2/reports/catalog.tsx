'use client'

// Informes · Catálogo: the reports this engine computes (from its own
// catalog: a kind it cannot compute does not appear) and the ones the
// console builds from its data, each with what it says, its window or
// the case it needs, its formats, and where its numbers come from.
import { useEffect, useState } from 'react'
import { CaretRight, FileText } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { fetchReportCatalog, type ReportCatalogEntry } from '@/lib/reports'
import type { ReportsTab } from '@/lib/v2/reports-model'
import { Empty } from '../home/parts'

const KIND_TAB: Record<string, ReportsTab> = { executive: 'ejecutivo', soc: 'soc', fleet: 'flota', incident: 'incidente' }

export function Catalog({ storeEnabled, onOpen }: { storeEnabled: boolean | null; onOpen: (tab: ReportsTab) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.reportsView
  const [entries, setEntries] = useState<ReportCatalogEntry[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    void fetchReportCatalog().then((res) => {
      if (!alive) return
      if (res.ok) setEntries(res.data.reports ?? [])
      else setError(res.error)
    })
    return () => {
      alive = false
    }
  }, [])

  const consoleCards: { key: keyof typeof t.consoleKinds; tab: ReportsTab; formats: string[] }[] = [
    { key: 'analista', tab: 'analista', formats: ['Markdown', 'JSON', 'PDF'] },
    { key: 'caso', tab: 'incidente', formats: ['Markdown', 'HTML'] },
    { key: 'exportar', tab: 'exportar', formats: ['JSONL', 'CSV'] },
  ]

  return (
    <div className="v2-cat">
      <section aria-labelledby="v2-cat-engine">
        <h2 id="v2-cat-engine">{t.catTitle}</h2>
        <p className="v2-small v2-dim">{t.catHint}</p>
        {storeEnabled !== null && <p className="v2-small v2-rep-store">{storeEnabled ? t.storeOn : t.storeOff}</p>}
        {error ? (
          <p className="v2-small v2-warn">{t.error(error)}</p>
        ) : entries === null ? (
          <p className="v2-small v2-dim">{t.loading}</p>
        ) : entries.length === 0 ? (
          <Empty title={t.notAvailable} />
        ) : (
          <ul className="v2-cat-grid">
            {entries.map((e, i) => {
              const known = t.kinds[e.kind]
              const tab = KIND_TAB[e.kind]
              return (
                <li key={e.kind} className="v2-cat-card" style={{ ['--i' as string]: i }}>
                  <header>
                    <FileText aria-hidden="true" />
                    <h3>{known?.title ?? e.title}</h3>
                  </header>
                  <p className="v2-small">{known?.desc ?? e.description}</p>
                  <div className="v2-cat-meta">
                    {e.params.window ? (
                      <span className="v2-tags">
                        {(['24h', '7d', '30d'] as const).map((w) => (
                          <span key={w} className="v2-tag">
                            {t.windows[w]}
                          </span>
                        ))}
                      </span>
                    ) : e.params.id ? (
                      <span className="v2-tag">{t.catNeedsCase}</span>
                    ) : null}
                    <span className="v2-small v2-dim">
                      {t.catFormats}: {[...e.formats.map((f) => f.toUpperCase()), ...(tab && tab !== 'incidente' ? ['PDF'] : [])].join(' · ')}
                    </span>
                  </div>
                  {tab && (
                    <button type="button" className="v2-btn" onClick={() => onOpen(tab)}>
                      {t.catOpen}
                      <CaretRight aria-hidden="true" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="v2-cat-console">
        <h2 id="v2-cat-console">{t.catConsole}</h2>
        <p className="v2-small v2-dim">{t.catConsoleHint}</p>
        <ul className="v2-cat-grid">
          {consoleCards.map((c, i) => (
            <li key={c.key} className="v2-cat-card" data-console="true" style={{ ['--i' as string]: i + 4 }}>
              <header>
                <FileText aria-hidden="true" />
                <h3>{t.consoleKinds[c.key].title}</h3>
              </header>
              <p className="v2-small">{t.consoleKinds[c.key].desc}</p>
              <div className="v2-cat-meta">
                <span className="v2-small v2-dim">
                  {t.catFormats}: {c.formats.join(' · ')}
                </span>
              </div>
              <button type="button" className="v2-btn" onClick={() => onOpen(c.tab)}>
                {t.catOpen}
                <CaretRight aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
