'use client'

// v2 · Directorio: the Active Directory snapshot the engine syncs over
// LDAPS (-ad) and the posture it computes on it — the connector's state,
// the score with its findings and trend, the findings in full, the
// objects of the snapshot and the domain computers without a sensor.
// Read-only: the engine never receives an LDAP filter from here and the
// connector's settings live in Ajustes. Honest states: not armed (501),
// no access (403), first sync still running.
import { useCallback, useEffect, useState } from 'react'
import { ArrowClockwise } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { currentSearch, replaceOperatorState } from '@/lib/url-state'
import { setSearchParam } from '@/lib/v2/alerts-model'
import { fetchADPosture, fetchADPostureHistory, fetchADStatus, type ADPosture, type ADPosturePoint, type ADStatus } from '@/lib/directory'
import { DIRECTORY_TABS, directoryTabFromParam, type DirectoryTab } from '@/lib/v2/directory-model'
import { v2SettingsLink } from '@/lib/v2/settings-model'
import { Empty } from '../home/parts'
import { Notice } from '../settings/parts'
import { Coverage } from './coverage'
import { Findings } from './findings'
import { ObjectsExplorer } from './objects'
import { useWhen } from './parts'
import { Posture } from './posture'

type Load =
  | { kind: 'loading' }
  | { kind: 'unarmed' }
  | { kind: 'restricted' }
  | { kind: 'error'; error: string }
  | { kind: 'ok'; status: ADStatus; posture: ADPosture | null; history: ADPosturePoint[] }

function ConnectorStrip({ status, onRefresh, busy }: { status: ADStatus; onRefresh: () => void; busy: boolean }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.directoryView
  const c = dict.directory.connector
  const when = useWhen()
  const n = new Intl.NumberFormat(lang)
  return (
    <section className="v2-panel v2-dir-strip" aria-label={t.connectorAria}>
      <span className="v2-dir-conn" data-ok={status.connected}>
        <i aria-hidden="true" />
        {status.connected ? t.connected : t.disconnected}
      </span>
      <span className="v2-dir-pill">{t.lastSync(when(status.last_success_at, c.noneYet))}</span>
      <span className="v2-dir-pill">{t.nextSync(status.next_sync_at ? when(status.next_sync_at, c.stopped) : c.stopped)}</span>
      <span className="v2-dir-counts">
        <b className="v2-mono">{n.format(status.objects.users)}</b> {t.counts.users} · <b className="v2-mono">{n.format(status.objects.groups)}</b> {t.counts.groups} ·{' '}
        <b className="v2-mono">{n.format(status.objects.computers)}</b> {t.counts.computers} · <b className="v2-mono">{n.format(status.objects.ous)}</b> {t.counts.ous}
      </span>
      {status.truncated && <span className="v2-dir-pill" data-warn="true">{c.truncatedBadge}</span>}
      <button type="button" className="v2-btn v2-dir-refresh" onClick={onRefresh} disabled={busy}>
        <ArrowClockwise aria-hidden="true" />
        {t.refresh}
      </button>
      {status.last_error && (
        <p className="v2-small v2-warn v2-dir-error">
          {c.lastError}
          <span className="v2-mono">{status.last_error}</span>
        </p>
      )}
    </section>
  )
}

export function DirectoryView() {
  const { dict } = useI18n()
  const t = dict.v2.directoryView
  const d = dict.directory
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<DirectoryTab>('postura')
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const apply = () => {
      setTab(directoryTabFromParam(new URLSearchParams(currentSearch()).get('vista')))
      setReady(true)
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  useEffect(() => {
    if (!ready) return
    replaceOperatorState((search) => setSearchParam(search, 'vista', tab === 'postura' ? null : tab))
  }, [ready, tab])

  const fetchAll = useCallback(async () => {
    setBusy(true)
    const st = await fetchADStatus()
    if (!st.ok) {
      setBusy(false)
      setLoad(st.status === 501 ? { kind: 'unarmed' } : st.status === 403 ? { kind: 'restricted' } : { kind: 'error', error: st.error })
      return
    }
    const [posture, history] = await Promise.all([fetchADPosture(), fetchADPostureHistory(100)])
    setBusy(false)
    setLoad({
      kind: 'ok',
      status: st.data,
      posture: posture.ok ? posture.data : null,
      history: history.ok && Array.isArray(history.data.points) ? history.data.points : [],
    })
  }, [])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const go = (next: DirectoryTab) => {
    setTab(next)
    window.scrollTo({ top: 0 })
  }

  if (load.kind === 'loading') return <p className="v2-small v2-dim">{t.loading}</p>
  if (load.kind === 'unarmed') {
    return (
      <section className="v2-panel">
        <Empty title={d.unarmedTitle}>
          {t.unarmedHint}{' '}
          <a className="v2-link" href={v2SettingsLink('directorio')}>
            {t.openSettings}
          </a>
        </Empty>
      </section>
    )
  }
  if (load.kind === 'restricted') {
    return (
      <section className="v2-panel">
        <Empty title={dict.v2.settingsView.states.restricted}>{dict.v2.settingsView.restrictedHint}</Empty>
      </section>
    )
  }
  if (load.kind === 'error') {
    return (
      <section className="v2-panel">
        <Notice tone="error">
          {d.errorTitle}: {load.error}
        </Notice>
      </section>
    )
  }

  const { status, posture, history } = load
  const findings = posture?.ready ? posture.findings : []
  const body =
    !ready ? null : !posture?.ready && tab !== 'objetos' ? (
      <Empty title={d.posturePending.title}>{d.posturePending.hint}</Empty>
    ) : tab === 'postura' && posture ? (
      <Posture posture={posture} history={history} onOpen={go} />
    ) : tab === 'hallazgos' ? (
      <Findings findings={findings} />
    ) : tab === 'objetos' ? (
      <ObjectsExplorer counts={status.objects} />
    ) : (
      <Coverage findings={findings} status={status} />
    )

  return (
    <div className="v2-directory">
      <ConnectorStrip status={status} onRefresh={() => void fetchAll()} busy={busy} />
      <div className="v2-tabs v2-det-tabs" role="tablist" aria-label={t.tabsAria}>
        {DIRECTORY_TABS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={v === tab} onClick={() => go(v)}>
            {t.tabs[v]}
          </button>
        ))}
      </div>
      <section className="v2-panel v2-det-panel" aria-label={t.tabs[tab]}>
        {body}
      </section>
    </div>
  )
}
