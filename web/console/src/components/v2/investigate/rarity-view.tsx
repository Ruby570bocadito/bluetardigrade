'use client'

// Stack counting (boceto 6): the values of a field across hosts, the ones
// seen on the fewest hosts and the fewest times on top, each with a bar of
// how widespread it is. A row opens its latest event; Buscar adds it to
// the query. The whole database can be counted with the SQL console.
import { useMemo, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { formatDateTime, type SfEvent } from '@/lib/console-types'
import { RARITY_FIELDS, rarity, type QueryToken, type RarityField } from '@/lib/v2/investigate-model'
import { Empty } from '../home/parts'

const SHOWN = 200

/** The SQL that counts a field over the whole evidence database. */
export function raritySql(field: RarityField): string {
  const expr: Record<RarityField, string> = {
    process: "json_extract(json, '$.process.name')",
    cmd: "json_extract(json, '$.process.command_line')",
    pair: "json_extract(json, '$.process.name')",
    dst: "json_extract(json, '$.network.destination_ip')",
    user: "json_extract(json, '$.user')",
  }
  return [
    `SELECT ${expr[field]} AS valor,`,
    '       COUNT(DISTINCT host) AS equipos,',
    '       COUNT(*) AS veces,',
    "       datetime(MIN(ts) / 1000000000, 'unixepoch') AS primera_vez",
    'FROM events',
    `WHERE ${expr[field]} IS NOT NULL`,
    'GROUP BY valor',
    'ORDER BY equipos ASC, veces ASC',
    'LIMIT 200',
  ].join('\n')
}

export function RarityView({
  events,
  onPivot,
  onSelect,
  selectedId,
  onSql,
}: {
  events: readonly SfEvent[]
  onPivot: (token: QueryToken) => void
  onSelect: (id: string) => void
  selectedId: string | null
  onSql: (sql: string) => void
}) {
  const { dict, lang } = useI18n()
  const t = dict.v2.investigateView
  const [field, setField] = useState<RarityField>('process')
  const { rows, totalHosts } = useMemo(() => rarity(events, field), [events, field])

  return (
    <div className="v2-rarity">
      <div className="v2-rarity-head">
        <div className="v2-tabs" role="tablist" aria-label={t.rarityAria}>
          {RARITY_FIELDS.map((f) => (
            <button key={f} type="button" role="tab" aria-selected={f === field} onClick={() => setField(f)}>
              {t.rarityFields[f]}
            </button>
          ))}
        </div>
        <button type="button" className="v2-btn" onClick={() => onSql(raritySql(field))}>
          {t.inSql}
        </button>
      </div>
      <p className="v2-dim v2-small">
        {t.rarityScope(events.length, totalHosts)}
        {totalHosts === 1 && ` ${t.raritySingleHost}`}
      </p>
      {rows.length === 0 ? (
        <Empty title={t.rarityEmpty} />
      ) : (
        <div className="v2-table-wrap">
          <table className="v2-rarity-table" key={field}>
            <thead>
              <tr>
                <th scope="col">{t.rarityCols.value}</th>
                <th scope="col">{t.rarityCols.spread}</th>
                <th scope="col">{t.rarityCols.count}</th>
                <th scope="col">{t.rarityCols.first}</th>
                <th scope="col">
                  <span className="v2-sr-only">{t.search}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, SHOWN).map((r, i) => (
                <tr
                  key={r.value}
                  tabIndex={0}
                  aria-selected={r.sampleId === selectedId}
                  data-rare={r.hosts.length === 1 && totalHosts > 1}
                  style={{ ['--i' as string]: Math.min(i, 24) }}
                  onClick={() => onSelect(r.sampleId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSelect(r.sampleId)
                  }}
                >
                  <td className="v2-mono v2-rarity-value" title={r.value}>
                    {r.value}
                  </td>
                  <td>
                    <span className="v2-rarity-bar" aria-hidden="true">
                      <i style={{ ['--w' as string]: `${(r.hosts.length / Math.max(1, totalHosts)) * 100}%` }} />
                    </span>
                    <span className="v2-small" title={r.hosts.join(', ')}>
                      {t.seenOn(r.hosts.length, totalHosts)}
                    </span>
                  </td>
                  <td className="v2-mono">{r.count}</td>
                  <td className="v2-mono v2-dim">{formatDateTime(r.first, lang)}</td>
                  <td>
                    <button
                      type="button"
                      className="v2-link"
                      onClick={(e) => {
                        e.stopPropagation()
                        onPivot(r.token)
                      }}
                    >
                      {t.search}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
