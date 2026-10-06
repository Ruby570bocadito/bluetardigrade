// Functional DOM regression fixtures. No live engine or network is used.
// Run through check_console_dom.mjs; see the dev-tests README.
import { JSDOM } from 'jsdom'
import React from 'react'
import assert from 'node:assert/strict'
import { EngineProvider, useEngine } from '../../web/console/src/components/console/engine-provider'
import { AlertsView } from '../../web/console/src/components/console/alerts-view'
import { Dashboard } from '../../web/console/src/components/console/dashboard'
import { ForensicPanel } from '../../web/console/src/components/console/forensic-panel'
import { ReportPanel } from '../../web/console/src/components/console/report-panel'
import { ReportLibrary } from '../../web/console/src/components/console/report-library'
import { readReports, REPORT_KEY, saveReport } from '../../web/console/src/lib/soc-report'
import { SavedSearches } from '../../web/console/src/components/console/saved-searches'
import { alertSearchLens, SAVED_SEARCH_KEY } from '../../web/console/src/lib/saved-searches'
import type { TriageTarget } from '../../web/console/src/lib/operations'

const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost:3000', pretendToBeVisual:true})
for (const key of ['window','document','HTMLElement','HTMLFormElement','HTMLInputElement','HTMLSelectElement','HTMLButtonElement','Element','SVGElement','Node','DocumentFragment','Event','MouseEvent','CustomEvent','FocusEvent','MutationObserver']) {
  ;(globalThis as any)[key] = (dom.window as any)[key]
}
;(globalThis as any).getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
dom.window.matchMedia = (() => ({matches:true, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}})) as any
;(globalThis as any).requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
;(globalThis as any).cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)

class FakeSource {
  static OPEN = 1
  static instances: FakeSource[] = []
  readyState = 0
  closed = false
  listeners = new Map<string, Function[]>()
  onopen: Function | null = null
  onerror: Function | null = null
  constructor() {
    FakeSource.instances.push(this)
    queueMicrotask(() => {this.readyState=1; this.onopen?.()})
  }
  addEventListener(topic: string, fn: Function) {
    this.listeners.set(topic, [...(this.listeners.get(topic) ?? []), fn])
  }
  emit(topic: string, data: unknown) {
    for (const fn of this.listeners.get(topic) ?? []) fn({data:JSON.stringify(data)})
  }
  close() {this.closed=true; this.readyState=2}
}
;(globalThis as any).EventSource = FakeSource

let engineUp = true
let responseAvailable = true
let holdStats = false
let releaseStats: (() => void) | null = null
let ruleName = 'Original rule'
let snapshotEvents = [{id:'old-event', timestamp:new Date(Date.now()-239000).toISOString(),type:'process.create',source:'simulate',host:'LAB',process:{pid:1,name:'demo.exe'}}]
const alert = {id:'0123456789abcdef', timestamp:new Date().toISOString(),rule_id:'rule',rule_name:'Detection',severity:'critical',host:'LAB',event_id:'old-event',event_type:'process.create',summary:'demo evidence',matched_on:[],status:'acknowledged'}
const historicalAlert = {...alert,id:'fedcba9876543210',rule_name:'Historical evidence',status:'new',status_at:'',status_note:''}
const secondHistoricalAlert = {...historicalAlert,id:'bbbbbbbbbbbbbbbb',rule_name:'Second page evidence'}
let historySource='sqlite'
let historyMissing=false
let releaseSearch: (()=>void) | null = null
const historyRequests: string[]=[]
const stats = {
  uptime_s:100, events_total:1, alerts_total:1, events_per_min:1, dropped:0, ingest_rejected:0,
  by_severity:{critical:1}, rules_count:1, rules_types:['process.create'], events_buffered:1,
  webhook_sent:0,webhook_failed:0,webhook_dropped:0,suppressions_active:0,
  correlator_states:0,correlator_sequences:0,correlator_cap:0,risk_hosts_tracked:0,hot_hosts:[],
}
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  if (!engineUp) throw new Error('offline')
  const url = new URL(String(input),'http://localhost')
  const pathname = url.pathname.replace('/api/engine','')
  if (pathname === '/api/alerts/search') {
    historyRequests.push(url.search)
    if (historyMissing) return new Response('',{status:404})
    const cursor = url.searchParams.get('cursor') || ''
    const q = url.searchParams.get('q') || ''
    if (q === 'slow') await new Promise<void>(resolve=>{releaseSearch=resolve})
    const item = cursor === 'second-cursor' ? secondHistoricalAlert : historicalAlert
    const value = q === 'fast' ? {...item,rule_name:'Fast response'} : q === 'slow' ? {...item,rule_name:'Obsolete response'} : item
    const filter=url.searchParams.get('status')
    const items=filter && filter !== 'all' && (filter === 'open' ? item.status === 'closed' : item.status !== filter) ? [] : [value]
    return Response.json({items,source:historySource,has_more:!filter && cursor !== 'second-cursor',next_cursor:cursor==='second-cursor'?'':'second-cursor',page_cursor:cursor==='second-cursor'?'second-cursor':'first-anchor',scanned:1,scan_limited:false})
  }
  if (pathname === '/api/alerts/fedcba9876543210/status' && init?.method === 'POST') {
    const action=JSON.parse(String(init.body))
    const at=new Date().toISOString()
    Object.assign(historicalAlert,{status:action.status,status_note:action.note,status_at:at})
    return Response.json({alert_id:historicalAlert.id,status:action.status,note:action.note,by:action.by,at})
  }
  if (pathname === '/api/stats' && holdStats) {
    holdStats = false
    await new Promise<void>(resolve => {releaseStats=resolve})
  }
  if (pathname === '/api/stats') return Response.json(stats)
  if (pathname === '/api/events') return Response.json(snapshotEvents)
  if (pathname === '/api/alerts') return Response.json([alert])
  if (pathname === '/api/rules') return Response.json([{id:'rule',name:ruleName,severity:'critical',event_type:'process.create',tags:[],conditions:[]}])
  if (pathname === '/api/suppressions') return Response.json({entries:[]})
  if (pathname === '/api/sequences') return Response.json([])
  if (pathname === '/api/respond/state' && responseAvailable) return Response.json({armed:true,signal:'SIGKILL',operators_count:1,protected_count:1,audit_path:'demo',audit_size:0,audit_ceiling:100})
  if (pathname === '/api/respond/audit' && responseAvailable) return Response.json({records:[],skipped:0,truncated:false})
  return new Response('',{status:404})
}) as typeof fetch

let state: ReturnType<typeof useEngine>
let navigated = ''
let triageTarget: TriageTarget | null = null
function Probe() {state=useEngine(); return null}
// Initialize React's browser event support after jsdom globals exist.
const { createRoot } = require('react-dom/client') as typeof import('react-dom/client')
const root = createRoot(document.getElementById('root')!)
root.render(<React.StrictMode><EngineProvider><Probe/><Dashboard onAnalyze={()=>{}} onNavigate={(view)=>{navigated=view}} onTriage={(target)=>{triageTarget=target}}/></EngineProvider></React.StrictMode>)
const delay = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms))
async function until(fn:()=>boolean, timeout=7000) {
  const end=Date.now()+timeout
  while (!fn()) {
    if (Date.now()>end) throw new Error('DOM check timed out')
    await delay(20)
  }
}
async function main() {
  await until(()=>state?.status==='live' && state.streamStatus==='live')
  assert.ok(document.body.textContent!.includes('Motor operativo'))
  assert.equal(state!.alerts.length,1)
  const source=FakeSource.instances.at(-1)!
  source.emit('alert', {...alert,status:undefined})
  await delay(30)
  assert.equal(state!.alerts.length,1)
  assert.equal(state!.alerts[0].status,'acknowledged')
  assert.equal(state!.stats!.alerts_total,1)
  console.log('PASS: live dashboard and replay preserve counters and triage')

  ruleName='Reloaded rule'
  await until(()=>state!.rules[0]?.name===ruleName)
  console.log('PASS: polled catalogue follows hot reload')

  // the activity chart lives in the 'Equipos y actividad' tab of the panel
  const tabButton=(label:string)=>[...document.querySelectorAll('[role="tab"]')].find(b=>b.textContent?.trim()===label)!
  tabButton('Equipos y actividad').click()
  await until(()=>document.querySelector('[role="img"]')?.getAttribute('aria-label')?.includes('0 eventos del búfer') ?? false)
  console.log('PASS: activity ages out without incoming events')
  tabButton('Resumen').click()
  await delay(30)

  const queueButton=[...document.querySelectorAll('button')].find(button=>button.textContent?.includes('Abrir cola'))
  queueButton!.click()
  assert.equal(navigated,'alertas')
  console.log('PASS: operation action navigates to the alert queue')

  for (const [label,target] of [['Ver críticas sin cerrar','critical'],['Ver alertas nuevas','new'],['Ver alertas reconocidas','acknowledged'],['Ver alertas cerradas','closed']] as const) {
    const action=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith(label+':') || b.getAttribute('aria-label')?.startsWith(label+' ') || b.textContent?.trim()===label)!
    assert.equal(action.disabled,false)
    action.click()
    assert.equal(triageTarget,target)
  }
  console.log('PASS: dashboard triage shortcuts use the counted lifecycle and severity')

  responseAvailable=false
  state!.refresh()
  await until(()=>state!.respondState===null && !state!.refreshing)
  console.log('PASS: optional 404 clears previously armed state')

  holdStats=true
  state!.refresh()
  await until(()=>releaseStats!==null && state!.refreshing)
  const event={...snapshotEvents[0],id:'during-sync',timestamp:new Date().toISOString()}
  source.emit('event',event)
  source.emit('alert',{...alert,status:undefined})
  releaseStats!()
  await until(()=>!state!.refreshing && state!.events.some(e=>e.id==='during-sync'))
  assert.equal(state!.alerts[0].status,'acknowledged')
  console.log('PASS: REST snapshot retains incoming events and triage during alert replay')

  holdStats=true
  releaseStats=null
  state!.refresh()
  await until(()=>releaseStats!==null && state!.refreshing)
  source.emit('alert_lifecycle',{alert_id:alert.id,status:'closed',note:'reviewed',by:'fixture',at:new Date().toISOString()})
  source.emit('alert',{...alert,status:undefined})
  releaseStats!()
  await until(()=>!state!.refreshing)
  assert.equal(state!.alerts[0].status,'closed')
  assert.equal(state!.alerts[0].status_note,'reviewed')
  console.log('PASS: lifecycle decisions received during sync supersede older snapshot status')

  source.onerror?.()
  await until(()=>state!.streamStatus==='retrying')
  assert.ok(document.body.textContent!.includes('El canal en vivo está reconectando'))
  console.log('PASS: live-channel failure is visible while API remains reachable')

  engineUp=false
  await until(()=>state!.status==='down')
  assert.equal(state!.events.length,0)
  assert.equal(state!.alerts.length,0)
  assert.equal(state!.rules.length,0)
  assert.equal(state!.stats,null)
  assert.equal(document.querySelectorAll('[aria-label="Sin datos"]').length,6)
  assert.equal((document.querySelector('[aria-label^="Ver alertas nuevas"]') as HTMLButtonElement).disabled,true)
  assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Ver críticas sin cerrar')!.disabled,true)
  tabButton('Equipos y actividad').click()
  await delay(30)
  assert.ok(document.body.textContent!.includes('Telemetría no disponible'))
  tabButton('Resumen').click()
  await delay(30)
  console.log('PASS: outage clears stale telemetry and renders unavailable KPIs')

  engineUp=true
  stats.uptime_s=1
  snapshotEvents=[]
  state!.refresh()
  await until(()=>state!.status==='live' && !state!.refreshing)
  assert.equal(state!.events.length,0)
  console.log('PASS: manual recovery loads the restarted engine snapshot')

  root.render(<React.StrictMode><EngineProvider><Probe/><AlertsView/></EngineProvider></React.StrictMode>)
  const button=(label:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===label)!
  await until(()=>Boolean(button('Histórico')))
  button('Histórico').click()
  await until(()=>Boolean(button('Historical evidence')))
  assert.ok(document.body.textContent!.includes('Histórico SQLite'))
  assert.ok(window.location.search.includes('historial=1'))
  button('Siguiente').click()
  await until(()=>Boolean(button('Second page evidence')))
  button('Anterior').click()
  await until(()=>Boolean(button('Historical evidence')))
  assert.equal(new URLSearchParams(historyRequests.at(-1)).get('cursor'),'first-anchor')
  console.log('PASS: historical pages navigate back using the pinned first-page cursor')

  button('Historical evidence').click()
  await until(()=>Boolean(button('Reconocer')))
  button('Reconocer').click()
  await until(()=>!button('Reconocer') && Boolean(button('Cerrar')))
  assert.equal(state!.lifecycleUpdates.at(-1)?.alert_id,historicalAlert.id)
  assert.ok(document.body.textContent!.includes('reconocida'))
  console.log('PASS: historical triage uses the POST acknowledgement without requiring a working SSE channel')

  const setLens=(search:string)=>{window.history.replaceState({},'',search);window.dispatchEvent(new window.PopStateEvent('popstate'))}
  button('Siguiente').click()
  await until(()=>Boolean(button('Second page evidence')))
  setLens('?view=alertas&historial=1&estado=closed')
  await until(()=>!state!.refreshing && document.body.textContent!.includes('Sin resultados'))
  assert.equal((document.querySelector('[aria-label="Filtrar por estado"]') as HTMLSelectElement).value,'closed')
  setLens('?view=alertas&historial=1')
  await until(()=>Boolean(button('Historical evidence')))
  console.log('PASS: lifecycle deep links and history changes restore the filter without losing source selection')

  setLens('?view=alertas&historial=1&q=slow')
  await until(()=>releaseSearch!==null)
  setLens('?view=alertas&historial=1&q=fast')
  await until(()=>Boolean(button('Fast response')))
  releaseSearch!()
  await delay(80)
  assert.ok(!document.body.textContent!.includes('Obsolete response'))
  console.log('PASS: an obsolete delayed search cannot overwrite a newer filter result')

  setLens('?view=alertas&historial=1')
  await until(()=>Boolean(button('Historical evidence')))
  const at=new Date(Date.now()+1000).toISOString()
  Object.assign(historicalAlert,{status:'closed',status_at:at})
  Object.assign(secondHistoricalAlert,{status:'closed',status_at:at})
  source.emit('alert_lifecycle',{alert_id:historicalAlert.id,status:'closed',at})
  source.emit('alert_lifecycle',{alert_id:secondHistoricalAlert.id,status:'closed',at})
  await until(()=>state!.lifecycleUpdates.some(e=>e.alert_id===secondHistoricalAlert.id))
  await until(()=>document.body.textContent!.includes('cerrada'))
  button('Siguiente').click()
  await until(()=>Boolean(button('Second page evidence')))
  assert.ok(document.body.textContent!.includes('cerrada'))
  console.log('PASS: batched lifecycle frames update historical rows outside the live buffer')

  historySource='memory'
  button('Actualizar histórico').click()
  await until(()=>document.body.textContent!.includes('Solo memoria: últimas 256 alertas'))
  console.log('PASS: memory-only history states its retention limit explicitly')

  historyMissing=true
  button('Actualizar histórico').click()
  await until(()=>document.body.textContent!.includes('Este motor no ofrece búsqueda paginada'))
  assert.ok(!button('Historical evidence'))
  console.log('PASS: older engines show an actionable search capability error without stale rows')

  const forensicToggle=()=>document.querySelector<HTMLButtonElement>('[aria-label="Línea de tiempo forense"]')!
  root.render(<ForensicPanel alertId={alert.id} />)
  await until(()=>Boolean(forensicToggle()))
  let forensicMode: 'error' | 'bundle' | 'hold' = 'error'
  let releaseForensic: (()=>void) | null = null
  const forensicReads: string[] = []
  const snapshot = (id:string) => ({
    alert:{id,rule_name:'Frozen alert',matched_on:['process.name'],enrich:{parent_name:'winword.exe'}},
    captured_at:'2026-10-01T12:00:00Z', host:'LAB', window:'5m before alert',
    timeline:[{id:'frozen-event',timestamp:'2026-10-01T11:59:00Z',type:'process.create',host:'LAB',source:'sysmon',process:{pid:1,name:'cmd.exe',command_line:`${id} evidence`},enrichment:{parent_name:'winword.exe'}}],
    summary:{events:1,process_creates:1,network_connects:0,file_writes:0,registry_sets:0,process_accesses:0,other:0,distinct_users:0,distinct_images:null},
  })
  globalThis.fetch = (async (input:any) => {
    const id = String(input).match(/\/alerts\/([0-9a-f]{16})\/forensics$/)?.[1]
    assert.ok(id, 'forensic fixture must only read addressed evidence')
    forensicReads.push(id)
    const mode=forensicMode
    if (mode === 'hold') await new Promise<void>(resolve=>{releaseForensic=resolve})
    return mode === 'error' ? new Response('',{status:500}) : Response.json(snapshot(id))
  }) as typeof fetch
  assert.equal(forensicReads.length,0,'collapsed evidence must not fetch')
  forensicToggle().click()
  await until(()=>Boolean(button('Reintentar evidencia')))
  forensicMode='bundle'
  button('Reintentar evidencia').click()
  await until(()=>Boolean(document.querySelector('[aria-label="Descargar evidencia JSON"]')))
  assert.equal(forensicReads.length,2)
  const region=document.querySelector('[role="region"][aria-labelledby]')!
  assert.equal(region.getAttribute('aria-busy'),'false')
  console.log('PASS: forensic evidence is lazy, labels its region and retries a failed query')

  const downloads:Array<{name:string;blob:Blob}>=[]
  const realCreate=URL.createObjectURL, realRevoke=URL.revokeObjectURL
  const realClick=dom.window.HTMLAnchorElement.prototype.click
  let exportBlob:Blob
  let revocations=0
  URL.createObjectURL=(blob:Blob)=>{exportBlob=blob;return 'blob:fixture-forensic'}
  URL.revokeObjectURL=()=>{revocations++}
  dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:exportBlob})}
  try {
    ;(document.querySelector('[aria-label="Descargar evidencia JSON"]') as HTMLButtonElement).click()
    ;(document.querySelector('[aria-label="Descargar evidencia JSONL"]') as HTMLButtonElement).click()
    assert.equal(downloads.length,2)
    const json=JSON.parse(await downloads[0].blob.text())
    const jsonl=(await downloads[1].blob.text()).trimEnd().split('\n').map(line=>JSON.parse(line))
    assert.equal(json.alert.enrich.parent_name,'winword.exe')
    assert.equal(json.timeline[0].source,'sysmon')
    assert.deepEqual({...jsonl[0].bundle,timeline:jsonl.slice(1).map(row=>row.event)},json)
    assert.equal(downloads[0].name,`forensic-${alert.id}.json`)
    assert.equal(downloads[1].name,`forensic-${alert.id}.jsonl`)
    assert.equal(revocations,2)
    assert.equal(document.querySelectorAll('a[download]').length,0)
  } finally {
    URL.createObjectURL=realCreate;URL.revokeObjectURL=realRevoke
    dom.window.HTMLAnchorElement.prototype.click=realClick
  }
  console.log('PASS: forensic export buttons download complete JSON/JSONL and clean their temporary URLs')

  root.render(<ForensicPanel alertId={historicalAlert.id} />)
  await until(()=>forensicToggle()?.getAttribute('aria-expanded')==='false')
  assert.equal(document.querySelector('[aria-label="Descargar evidencia JSON"]'),null)
  forensicMode='error'
  forensicToggle().click()
  await until(()=>Boolean(button('Reintentar evidencia')))
  forensicToggle().click()
  await until(()=>forensicToggle()?.getAttribute('aria-expanded')==='false')
  forensicMode='bundle'
  forensicToggle().click()
  await until(()=>Boolean(document.querySelector('[aria-label="Descargar evidencia JSON"]')))
  assert.equal(forensicReads.at(-1),historicalAlert.id)
  console.log('PASS: changing alerts resets evidence, and reopening a failed panel really re-queries')

  root.render(<ForensicPanel alertId={alert.id} />)
  await until(()=>forensicToggle()?.getAttribute('aria-expanded')==='false')
  forensicMode='hold'
  forensicToggle().click()
  await until(()=>releaseForensic!==null)
  root.render(<ForensicPanel alertId={historicalAlert.id} />)
  await until(()=>forensicToggle()?.getAttribute('aria-expanded')==='false')
  forensicMode='bundle'
  forensicToggle().click()
  await until(()=>document.body.textContent!.includes(`${historicalAlert.id} evidence`))
  releaseForensic!()
  await delay(40)
  assert.ok(!document.body.textContent!.includes(`${alert.id} evidence`))
  console.log('PASS: a delayed forensic response cannot replace the newly selected alert\'s evidence')

  window.localStorage.clear()
  let huntQuery = 'fresh typing before URL debounce'
  let applied = ''
  const renderSearches = () => root.render(<SavedSearches kind="alerts" getLens={() => alertSearchLens('critical','open','history',huntQuery)} onApply={(lens)=>{applied=JSON.stringify(lens)}} />)
  renderSearches()
  const savedToggle=()=>[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Búsquedas guardadas'))!
  await until(()=>Boolean(savedToggle()))
  savedToggle().click()
  const nameInput=()=>document.querySelector<HTMLInputElement>('input[id$="-name"]')!
  await until(()=>Boolean(nameInput()))
  const typeName=(value:string)=>{
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(nameInput(),value)
    nameInput().dispatchEvent(new dom.window.Event('input',{bubbles:true}))
  }
  typeName('Critical hunt')
  await until(()=>!button('Guardar filtros actuales').disabled)
  button('Guardar filtros actuales').click()
  await until(()=>document.body.textContent!.includes('Búsqueda guardada.'))
  let saved=JSON.parse(window.localStorage.getItem(SAVED_SEARCH_KEY)!).items
  const huntId=saved[0].id
  assert.equal(saved[0].lens.q,huntQuery)
  huntQuery='updated filter'
  typeName('CRITICAL HUNT')
  await until(()=>!button('Guardar filtros actuales').disabled)
  button('Guardar filtros actuales').click()
  await until(()=>document.body.textContent!.includes('Búsqueda actualizada.'))
  saved=JSON.parse(window.localStorage.getItem(SAVED_SEARCH_KEY)!).items
  assert.equal(saved.length,1)
  assert.equal(saved[0].id,huntId)
  assert.equal(saved[0].lens.q,huntQuery)
  console.log('PASS: saved hunts capture fresh filters and update names without duplicating identity')

  ;(document.querySelector('[aria-label="Aplicar búsqueda CRITICAL HUNT"]') as HTMLButtonElement).click()
  await until(()=>Boolean(applied))
  assert.equal(JSON.parse(applied).q,huntQuery)
  await until(()=>savedToggle().getAttribute('aria-expanded')==='false')
  savedToggle().click()
  await until(()=>Boolean(nameInput()))
  const outside={id:'c'.repeat(32),name:'<img src=x>',lens:alertSearchLens('high','all','live','another tab')}
  window.localStorage.setItem(SAVED_SEARCH_KEY,JSON.stringify({version:1,items:[outside]}))
  window.dispatchEvent(new dom.window.StorageEvent('storage',{key:SAVED_SEARCH_KEY}))
  await until(()=>document.body.textContent!.includes(outside.name))
  assert.equal(document.querySelector('img'),null)
  ;(document.querySelector('[aria-label="Eliminar búsqueda <img src=x>"]') as HTMLButtonElement).click()
  await until(()=>document.body.textContent!.includes('Búsqueda eliminada.'))
  assert.deepEqual(JSON.parse(window.localStorage.getItem(SAVED_SEARCH_KEY)!).items,[])
  console.log('PASS: saved hunts apply filters, follow other tabs, render names as text and delete their own records')

  const realSet=dom.window.Storage.prototype.setItem
  dom.window.Storage.prototype.setItem=function(){throw new Error('fixture storage quota')}
  try {
    typeName('Storage failure')
    await until(()=>!button('Guardar filtros actuales').disabled)
    button('Guardar filtros actuales').click()
    await until(()=>document.body.textContent!.includes('No se pudo guardar'))
    assert.deepEqual(JSON.parse(window.localStorage.getItem(SAVED_SEARCH_KEY)!).items,[])
    assert.ok(!document.body.textContent!.includes('Búsqueda guardada.'))
  } finally {dom.window.Storage.prototype.setItem=realSet}
  console.log('PASS: a storage failure is recoverable and never reports a successful save')

  const corrupted='{invalid fixture'
  window.localStorage.setItem(SAVED_SEARCH_KEY,corrupted)
  window.dispatchEvent(new dom.window.StorageEvent('storage',{key:SAVED_SEARCH_KEY}))
  await until(()=>document.body.textContent!.includes('No se pudieron leer'))
  typeName('Do not overwrite')
  await until(()=>!button('Guardar filtros actuales').disabled)
  button('Guardar filtros actuales').click()
  await delay(30)
  assert.equal(window.localStorage.getItem(SAVED_SEARCH_KEY),corrupted)
  console.log('PASS: incompatible saved state is not silently overwritten')

  window.localStorage.clear()
  const reportAlert={...alert,status:'new' as const,source:'suricata',attributes:{ids_action:'allowed',ids_verdict:'drop'},network:{source_ip:'10.0.0.1',destination_port:443},severity:'high' as const}
  root.render(<ReportPanel alert={reportAlert} initiallyOpen />)
  const findings=()=>document.querySelector<HTMLTextAreaElement>('textarea[id$="-findings"]')!
  await until(()=>Boolean(findings()))
  Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(findings(),'Human fixture findings')
  findings().dispatchEvent(new dom.window.Event('input',{bubbles:true}))
  await delay(30)
  root.render(<ReportPanel alert={{...reportAlert,status:'closed'}} initiallyOpen />)
  await delay(30)
  assert.equal(findings().value,'Human fixture findings')
  assert.ok(document.body.textContent!.includes('Cambios sin guardar'))
  console.log('PASS: lifecycle updates cannot reset an unsaved report draft')
  button('Guardar informe').click()
  await until(()=>document.body.textContent!.includes('Informe guardado en este navegador.'))
  assert.equal(readReports(window.localStorage)[0].alert.status,'new')
  assert.equal(readReports(window.localStorage)[0].alert.attributes!.ids_verdict,'drop')
  console.log('PASS: report saves human findings and frozen source evidence without changing triage')
  downloads.length=0
  URL.createObjectURL=(blob:Blob)=>{exportBlob=blob;return 'blob:fixture-report'}
  URL.revokeObjectURL=()=>{}
  dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:exportBlob})}
  try {
    button('Exportar Markdown').click(); button('Exportar JSON').click()
    await until(()=>downloads.length===2)
    const result=JSON.parse(await downloads[1].blob.text())
    assert.equal(result.fields.findings,'Human fixture findings')
    assert.equal(result.alert.source,'suricata')
    assert.equal(downloads[1].name,`soc-${reportAlert.id}.json`)
  } finally {URL.createObjectURL=realCreate;URL.revokeObjectURL=realRevoke;dom.window.HTMLAnchorElement.prototype.click=realClick}
  console.log('PASS: report downloads contain exactly the current human fields and observed evidence')
  const stale=readReports(window.localStorage)[0]
  saveReport(window.localStorage,{...stale,fields:{...stale.fields,findings:'Other tab'}},stale.revision)
  window.dispatchEvent(new dom.window.StorageEvent('storage',{key:REPORT_KEY}))
  await until(()=>document.body.textContent!.includes('cambió en otra pestaña'))
  button('Guardar informe').click()
  await until(()=>document.querySelector('[role="alert"]')?.textContent?.includes('otra pestaña') ?? false)
  assert.equal(readReports(window.localStorage)[0].fields.findings,'Other tab')
  button('Cargar versión guardada').click()
  await until(()=>findings().value==='Other tab')
  console.log('PASS: stale tab drafts cannot overwrite a detected newer report revision')
  dom.window.Storage.prototype.setItem=function(){throw new Error('fixture report quota')}
  try { button('Guardar informe').click(); await until(()=>Boolean(document.querySelector('[role="alert"]'))); assert.equal(readReports(window.localStorage)[0].revision,2) }
  finally {dom.window.Storage.prototype.setItem=realSet}
  console.log('PASS: report storage errors remain visible and preserve the saved revision')
  root.render(<ReportLibrary />)
  await until(()=>document.body.textContent!.includes('Informes guardados (1/10)'))
  ;(document.querySelector('summary') as HTMLElement).click()
  button('Abrir informe').click()
  await until(()=>Boolean(findings()))
  assert.equal(findings().value,'Other tab')
  button('Eliminar versión local').click()
  await until(()=>document.body.textContent!.includes('Informes guardados (0/10)'))
  assert.deepEqual(readReports(window.localStorage),[])
  console.log('PASS: orphan snapshots can be reopened and removed without the engine alert')
  window.localStorage.setItem(REPORT_KEY,'{corrupt report fixture')
  root.render(<ReportPanel alert={reportAlert} initiallyOpen />)
  await until(()=>Boolean(findings()))
  button('Guardar informe').click()
  await delay(30)
  assert.equal(window.localStorage.getItem(REPORT_KEY),'{corrupt report fixture')
  assert.ok(document.querySelector('[role="alert"]'))
  console.log('PASS: corrupt report stores are not silently replaced')

  root.unmount()
  assert.ok(FakeSource.instances.every(s=>s.closed))
  dom.window.close()
  console.log('PASS: unmount closes every live channel')
}
main().catch(error=>{console.error(error);root.unmount();dom.window.close();process.exitCode=1})
