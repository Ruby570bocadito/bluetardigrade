'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DECISIONS, readReports, REPORT_KEY, REPORT_UPDATED_EVENT, type SocReport } from '@/lib/soc-report'
import { ReportPanel } from './report-panel'

// Saved snapshots remain reachable after an alert leaves engine retention.
export function ReportLibrary() {
  const [items, setItems] = useState<SocReport[]>([])
  const [active, setActive] = useState<SocReport | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const refresh = () => { try { setItems(readReports(window.localStorage)); setError('') } catch { setError('No se pudo leer el registro local de informes.') } }
    const storage = (event: StorageEvent) => { if (event.key === REPORT_KEY || event.key === null) refresh() }
    refresh(); window.addEventListener('storage', storage); window.addEventListener(REPORT_UPDATED_EVENT, refresh)
    return () => { window.removeEventListener('storage', storage); window.removeEventListener(REPORT_UPDATED_EVENT, refresh) }
  }, [])
  return <details className="mb-3 min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
    <summary className="cursor-pointer text-xs text-zinc-300">Informes guardados ({items.length}/10)</summary>
    <p className="mt-2 text-xs text-zinc-500">Disponibles desde su snapshot local, aunque la alerta ya no esté en el motor. Guarda los cambios antes de cerrar el editor.</p>
    {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    {items.length === 0 && <p className="mt-2 text-xs text-zinc-500">No hay informes guardados en este navegador.</p>}
    <ul className="mt-2 space-y-2">{items.map((item) => <li key={item.alert_id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800 p-2"><div className="min-w-0"><p className="break-words text-xs text-zinc-300">{item.fields.title}</p><p className="break-all font-mono text-[10px] text-zinc-500">{item.alert_id} · {DECISIONS[item.fields.decision]} · revisión {item.revision}</p></div><Button variant="outline" size="sm" onClick={() => setActive(item)}>Abrir informe</Button></li>)}</ul>
    {active && <div className="mt-3 min-w-0"><Button variant="outline" size="sm" onClick={() => setActive(null)}>Cerrar editor guardado</Button><ReportPanel key={active.alert_id} alert={active.alert} initiallyOpen /></div>}
  </details>
}
