// Functional DOM regression fixtures. No live engine or network is used.
// Run through check_console_dom.mjs; see the dev-tests README.
import { JSDOM } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'
import assert from 'node:assert/strict'
import { EngineProvider, useEngine } from '../../web/console/src/components/console/engine-provider'
import { AlertsView } from '../../web/console/src/components/console/alerts-view'
import { Dashboard } from '../../web/console/src/components/console/dashboard'

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
function Probe() {state=useEngine(); return null}
const root = createRoot(document.getElementById('root')!)
root.render(<React.StrictMode><EngineProvider><Probe/><Dashboard onAnalyze={()=>{}} onNavigate={(view)=>{navigated=view}}/></EngineProvider></React.StrictMode>)
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

  await until(()=>document.querySelector('[role="img"]')?.getAttribute('aria-label')?.includes('0 eventos del búfer') ?? false)
  console.log('PASS: activity ages out without incoming events')

  const queueButton=[...document.querySelectorAll('button')].find(button=>button.textContent?.includes('Abrir cola'))
  queueButton!.click()
  assert.equal(navigated,'alertas')
  console.log('PASS: operation action navigates to the alert queue')

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
  assert.ok(document.body.textContent!.includes('Telemetría no disponible'))
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

  root.unmount()
  assert.ok(FakeSource.instances.every(s=>s.closed))
  dom.window.close()
  console.log('PASS: unmount closes every live channel')
}
main().catch(error=>{console.error(error);root.unmount();dom.window.close();process.exitCode=1})
