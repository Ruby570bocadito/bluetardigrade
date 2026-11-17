'use client'

// v2 · Incidentes: the cases of the SOC. The list by state on one side and
// the open case on the other, as a war room: live timer, owner and "take
// the case", the state as steps, and its activity, graph, response plan,
// alerts and report. A new case starts from the alerts not yet in one.
// On a tablet the case slides in as a drawer; on a phone it fills the
// screen, with the big "take the case" button within reach.
//
// The open case, the filter and the section live in the URL (incidente,
// estado, vista); `incidente` is the classic console's own key.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useIncidents } from '@/components/console/incidents-provider'
import { currentSearch, replaceOperatorState } from '@/lib/url-state'
import { setSearchParam } from '@/lib/v2/alerts-model'
import { filterIncidents, incidentFilterFromParam, statusCounts, type IncidentFilter } from '@/lib/v2/incidents-model'
import { Empty } from '../home/parts'
import { useMedia } from '../use-media'
import { CaseList } from './case-list'
import { CaseDetail, caseTabFromParam, type CaseTab } from './case-detail'
import { NewCase } from './new-case'
import { useCaseWrite } from './parts'

export function IncidentsView() {
  const { dict } = useI18n()
  const t = dict.v2.incidentsView
  const { incidents, available, loaded } = useIncidents()
  const { can } = useCaseWrite()
  const narrow = useMedia('(max-width: 1180px)')

  const [filter, setFilter] = useState<IncidentFilter>('active')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<CaseTab>('actividad')
  const [creating, setCreating] = useState(false)
  const [ready, setReady] = useState(false)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [banner, setBanner] = useState<{ id: string; title: string } | null>(null)

  useEffect(() => {
    const apply = () => {
      const params = new URLSearchParams(currentSearch())
      setFilter(incidentFilterFromParam(params.get('estado')))
      setSelectedId(params.get('incidente'))
      setTab(caseTabFromParam(params.get('vista')))
      setReady(true)
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  useEffect(() => {
    if (!ready) return
    replaceOperatorState((search) =>
      setSearchParam(
        setSearchParam(setSearchParam(search, 'incidente', selectedId), 'estado', filter === 'active' ? null : filter),
        'vista',
        tab === 'actividad' ? null : tab,
      ),
    )
  }, [ready, selectedId, filter, tab])

  // a case that appears after the first load is announced (unless it is ours)
  const known = useRef<Set<string> | null>(null)
  const mine = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!loaded) return undefined
    const ids = incidents.map((i) => i.id)
    if (known.current === null) {
      known.current = new Set(ids)
      return undefined
    }
    const arrived = incidents.filter((i) => !known.current!.has(i.id))
    ids.forEach((id) => known.current!.add(id))
    if (arrived.length === 0) return undefined
    setFresh(new Set(arrived.map((i) => i.id)))
    const foreign = arrived.find((i) => !mine.current.has(i.id))
    if (foreign) setBanner({ id: foreign.id, title: foreign.title })
    const id = window.setTimeout(() => {
      setFresh(new Set())
      setBanner(null)
    }, 8000)
    return () => window.clearTimeout(id)
  }, [incidents, loaded])

  const counts = useMemo(() => statusCounts(incidents), [incidents])
  const cases = useMemo(() => filterIncidents(incidents, filter), [incidents, filter])
  const selected = incidents.find((i) => i.id === selectedId) ?? null
  const panelOpen = creating || selected !== null
  const drawer = narrow
  const close = useCallback(() => {
    setSelectedId(null)
    setCreating(false)
  }, [])

  useEffect(() => {
    if (!panelOpen) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen, close])

  let list: React.ReactNode
  if (loaded && !available) list = <Empty title={dict.incidents.unavailableTitle} />
  else if (incidents.length === 0) list = <Empty title={t.emptyActive}>{t.emptyActiveHint}</Empty>
  else
    list = (
      <>
        <CaseList
          cases={cases}
          counts={counts}
          filter={filter}
          onFilter={(f) => setFilter(f)}
          selectedId={selectedId}
          onSelect={(id) => {
            setCreating(false)
            setSelectedId(id)
          }}
          fresh={fresh}
        />
        {cases.length === 0 && <Empty title={t.emptyFilter} />}
      </>
    )

  return (
    <div className="v2-triage v2-incidents" data-drawer={drawer} data-detail={panelOpen ? 'open' : 'closed'}>
      <section className="v2-panel v2-queue" aria-labelledby="v2-cases-title">
        <div className="v2-panel-head">
          <div>
            <h2 id="v2-cases-title">{t.casesTitle}</h2>
            <p>{t.casesCount(incidents.length)}</p>
          </div>
          {can && available && (
            <button
              type="button"
              className="v2-btn v2-btn-primary"
              onClick={() => {
                setSelectedId(null)
                setCreating(true)
              }}
            >
              {t.newCase}
            </button>
          )}
        </div>
        {banner && (
          <div className="v2-banner" role="status">
            <span>{t.banner(banner.title)}</span>
            <button
              type="button"
              className="v2-link"
              onClick={() => {
                setSelectedId(banner.id)
                setBanner(null)
              }}
            >
              {t.bannerOpen}
            </button>
          </div>
        )}
        {list}
      </section>
      {drawer && <div className="v2-scrim" aria-hidden="true" onClick={close} />}
      <aside className="v2-panel v2-detail" aria-label={dict.incidents.casesTitle} inert={drawer && !panelOpen ? true : undefined}>
        {creating ? (
          <NewCase
            onCancel={() => setCreating(false)}
            onCreated={(id) => {
              mine.current.add(id)
              setCreating(false)
              setFilter('active')
              setSelectedId(id)
            }}
          />
        ) : selected ? (
          <CaseDetail key={selected.id} incident={selected} tab={tab} onTab={setTab} onClose={close} autoFocus={drawer} />
        ) : (
          <Empty title={t.pickTitle}>{t.pickHint}</Empty>
        )}
      </aside>
    </div>
  )
}
