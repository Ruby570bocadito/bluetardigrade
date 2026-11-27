'use client'

// Directorio · Objetos: the users, groups, computers and OUs of the
// engine's snapshot, searched by text on the engine's LOCAL copy (no LDAP
// filter ever leaves here), a page at a time, with the flags the snapshot
// already carries and the card of the object picked.
import { useEffect, useState } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { AD_DEFAULT_PAGE_SIZE, AD_KINDS, fetchADObjects, uacFlagLabels, type ADKind, type ADObject, type ADObjectsCounts, type ADObjectsPage } from '@/lib/directory'
import { Empty } from '../home/parts'
import { Notice } from '../settings/parts'

const COUNT_KEY: Record<ADKind, keyof ADObjectsCounts> = { user: 'users', group: 'groups', computer: 'computers', ou: 'ous' }

type Page = { kind: 'loading' } | { kind: 'ok'; page: ADObjectsPage } | { kind: 'down' } | { kind: 'error'; error: string }

function useUnix() {
  const { lang } = useI18n()
  return (sec: number, never: string) =>
    sec > 0 ? new Date(sec * 1000).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : never
}

function flagsOf(o: ADObject, labels: { disabled: string; noExpiry: string; delegation: string; noPreauth: string }): string[] {
  const flags = o.kind === 'user' || o.kind === 'computer' ? uacFlagLabels(o.user_account_control, labels) : []
  if (o.admin_count > 0) flags.push('adminCount')
  if (o.spn_count > 0 && o.kind === 'user') flags.push(`SPN ${o.spn_count}`)
  return flags
}

function ObjectCard({ obj, onClose }: { obj: ADObject; onClose: () => void }) {
  const { dict } = useI18n()
  const t = dict.v2.directoryView
  const unix = useUnix()
  const flags = flagsOf(obj, dict.directory.flags)
  const attrs = Object.entries(obj.attributes ?? {})
  return (
    <aside className="v2-dir-card" aria-label={t.panelTitle}>
      <header>
        <div>
          <span className="v2-eyebrow">{dict.directory.kinds[obj.kind as ADKind] ?? obj.kind}</span>
          <h3>{obj.name}</h3>
        </div>
        <button type="button" className="v2-icon-btn" onClick={onClose} aria-label={t.close} title={t.close}>
          <X aria-hidden="true" />
        </button>
      </header>
      {flags.length > 0 && (
        <p className="v2-dir-flags">
          {flags.map((f) => (
            <span key={f} className="v2-tag">
              {f}
            </span>
          ))}
        </p>
      )}
      <dl className="v2-fields">
        <div>
          <dt>{t.fields.dn}</dt>
          <dd className="v2-mono v2-dir-wrap">{obj.dn}</dd>
        </div>
        {obj.sid && (
          <div>
            <dt>{t.fields.sid}</dt>
            <dd className="v2-mono v2-dir-wrap">{obj.sid}</dd>
          </div>
        )}
        {(obj.kind === 'user' || obj.kind === 'computer') && (
          <>
            <div>
              <dt>{t.fields.lastLogon}</dt>
              <dd>{unix(obj.last_logon_unix, t.never)}</dd>
            </div>
            <div>
              <dt>{t.fields.pwdSet}</dt>
              <dd>{unix(obj.pwd_last_set_unix, t.never)}</dd>
            </div>
          </>
        )}
        {obj.os && (
          <div>
            <dt>{t.fields.os}</dt>
            <dd>{obj.os}</dd>
          </div>
        )}
        <div>
          <dt>{t.fields.changed}</dt>
          <dd>{unix(obj.when_changed_unix, t.never)}</dd>
        </div>
      </dl>
      <h4 className="v2-eyebrow">{t.attributes}</h4>
      {attrs.length === 0 ? (
        <p className="v2-small v2-dim">{t.noAttributes}</p>
      ) : (
        <dl className="v2-dir-attrs">
          {attrs.map(([k, v]) => (
            <div key={k}>
              <dt className="v2-mono">{k}</dt>
              <dd className="v2-dir-wrap">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  )
}

export function ObjectsExplorer({ counts }: { counts: ADObjectsCounts }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.directoryView
  const e = dict.directory.explorer
  const unix = useUnix()
  const n = new Intl.NumberFormat(lang)
  const [kind, setKind] = useState<ADKind>('user')
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<Page>({ kind: 'loading' })
  const [picked, setPicked] = useState<ADObject | null>(null)

  useEffect(() => {
    const id = window.setTimeout(() => {
      setQ(text)
      setOffset(0)
    }, 300)
    return () => window.clearTimeout(id)
  }, [text])

  useEffect(() => {
    let alive = true
    setPage({ kind: 'loading' })
    void fetchADObjects(kind, q, AD_DEFAULT_PAGE_SIZE, offset).then((r) => {
      if (!alive) return
      if (r.ok) setPage({ kind: 'ok', page: { ...r.data, objects: Array.isArray(r.data.objects) ? r.data.objects : [] } })
      else setPage(r.status === 501 || r.status === 503 ? { kind: 'down' } : { kind: 'error', error: r.error })
    })
    return () => {
      alive = false
    }
  }, [kind, q, offset])

  const detail = (o: ADObject) =>
    o.kind === 'computer'
      ? o.os || '—'
      : o.kind === 'group'
        ? o.attributes?.member_count !== undefined
          ? dict.directory.members(o.attributes.member_count)
          : '—'
        : o.kind === 'user'
          ? `${t.fields.lastLogon}: ${unix(o.last_logon_unix, t.never)}`
          : '—'

  const total = page.kind === 'ok' ? page.page.total : 0
  const objects = page.kind === 'ok' ? page.page.objects : []

  return (
    <div className="v2-set-stack">
      <div className="v2-dir-explorer-bar">
        <div className="v2-seg" role="group" aria-label={t.objectsAria}>
          {AD_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={k === kind}
              onClick={() => {
                setKind(k)
                setOffset(0)
                setPicked(null)
              }}
            >
              {dict.directory.kinds[k]} <b className="v2-mono">{n.format(counts[COUNT_KEY[k]])}</b>
            </button>
          ))}
        </div>
        <label className="v2-search">
          <MagnifyingGlass aria-hidden="true" />
          <span className="v2-sr-only">{t.searchAria}</span>
          <input type="search" value={text} maxLength={200} placeholder={e.searchPlaceholder} onChange={(ev) => setText(ev.target.value)} />
        </label>
      </div>
      <p className="v2-small v2-dim">{e.headHint}</p>

      {page.kind === 'down' && <Empty title={e.snapshotDownTitle}>{dict.directory.posturePending.hint}</Empty>}
      {page.kind === 'error' && <Notice tone="error">{page.error}</Notice>}
      {page.kind === 'loading' && <p className="v2-small v2-dim">{t.loading}</p>}
      {page.kind === 'ok' && objects.length === 0 && (q ? <Empty title={e.noMatchesTitle}>{e.noMatchesHint}</Empty> : <Empty title={e.emptyTitle}>{e.emptyHint}</Empty>)}

      {page.kind === 'ok' && objects.length > 0 && (
        <div className="v2-dir-objects" data-picked={picked !== null}>
          <div className="v2-rep-tablewrap">
            <table className="v2-rep-table v2-dir-objtable">
              <caption className="v2-sr-only">{e.tableCaption}</caption>
              <thead>
                <tr>
                  <th>{e.cols.name}</th>
                  <th>{t.fields.dn}</th>
                  <th>{e.cols.detail}</th>
                  <th>{e.cols.changed}</th>
                </tr>
              </thead>
              <tbody>
                {objects.map((o) => {
                  const flags = flagsOf(o, dict.directory.flags)
                  return (
                    <tr key={o.dn} aria-selected={picked?.dn === o.dn}>
                      <td>
                        <button type="button" className="v2-dir-name" onClick={() => setPicked(picked?.dn === o.dn ? null : o)}>
                          {o.name}
                        </button>
                        {flags.length > 0 && (
                          <span className="v2-dir-flags">
                            {flags.map((f) => (
                              <span key={f} className="v2-tag">
                                {f}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="v2-mono v2-dir-dn" title={o.dn}>
                        {o.dn}
                      </td>
                      <td>{detail(o)}</td>
                      <td>{unix(o.when_changed_unix, t.never)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {picked ? <ObjectCard obj={picked} onClose={() => setPicked(null)} /> : <p className="v2-small v2-dim v2-dir-pick">{t.pick}</p>}
        </div>
      )}

      {page.kind === 'ok' && total > 0 && (
        <div className="v2-dir-pager">
          <span className="v2-small v2-dim">{e.range(offset + 1, Math.min(offset + objects.length, total), n.format(total))}</span>
          <button type="button" className="v2-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - AD_DEFAULT_PAGE_SIZE))}>
            {e.prev}
          </button>
          <button type="button" className="v2-btn" disabled={offset + objects.length >= total} onClick={() => setOffset(offset + AD_DEFAULT_PAGE_SIZE)}>
            {e.next}
          </button>
        </div>
      )}
    </div>
  )
}
