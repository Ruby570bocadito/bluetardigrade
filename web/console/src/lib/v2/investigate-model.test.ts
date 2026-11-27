import { describe, expect, test } from 'bun:test'
import type { SfAlert, SfEvent } from '@/lib/console-types'
import {
  addToken,
  countNodes,
  detailRows,
  filterEvents,
  flattenForest,
  formatQuery,
  histogram,
  historyPath,
  hostCounts,
  kindOf,
  modeFromParam,
  networkFlows,
  newNotebook,
  parentIndex,
  parseQuery,
  processForest,
  rarity,
  readNotebooks,
  readSavedQueries,
  sourceFromParam,
  suggest,
  timeSpan,
  upsertSavedQuery,
  v2InvestigateLink,
  writeNotebooks,
  type QueryToken,
} from './investigate-model'

const T0 = Date.parse('2026-11-16T10:00:00Z')
const at = (s: number) => new Date(T0 + s * 1000).toISOString()

function proc(id: string, s: number, host: string, pid: number, ppid: number | undefined, name: string, cmd?: string, user = 'CORP\\ana'): SfEvent {
  return { id, timestamp: at(s), type: 'process.create', source: 'etw', host, user, process: { pid, ppid, name, command_line: cmd ?? name } }
}
function conn(id: string, s: number, host: string, pid: number, name: string, ip: string, port = 443): SfEvent {
  return { id, timestamp: at(s), type: 'network.connect', source: 'etw', host, user: 'CORP\\ana', process: { pid, name }, network: { protocol: 'tcp', source_ip: '10.0.0.5', destination_ip: ip, destination_port: port } }
}

const EVENTS: SfEvent[] = [
  proc('e1', 0, 'WS-014', 4000, 700, 'explorer.exe'),
  proc('e2', 10, 'WS-014', 4100, 4000, 'winword.exe', 'winword.exe /n factura.docm'),
  proc('e3', 20, 'WS-014', 4200, 4100, 'powershell.exe', 'powershell.exe -nop -w hidden -enc JAB'),
  proc('e4', 30, 'WS-014', 4300, 4200, 'rundll32.exe', 'rundll32.exe C:\\Users\\ana\\a.dll,Start'),
  conn('e5', 40, 'WS-014', 4200, 'powershell.exe', '185.220.101.47'),
  conn('e6', 100, 'WS-014', 4200, 'powershell.exe', '185.220.101.47'),
  conn('e7', 160, 'WS-014', 4200, 'powershell.exe', '185.220.101.47'),
  conn('e8', 220, 'WS-014', 4200, 'powershell.exe', '185.220.101.47'),
  conn('e9', 281, 'WS-014', 4200, 'powershell.exe', '185.220.101.47'),
  proc('e10', 5, 'SRV-DC01', 900, 500, 'svchost.exe', 'svchost.exe -k netsvcs', 'NT AUTHORITY\\SYSTEM'),
  proc('e11', 50, 'SRV-DC01', 950, 900, 'powershell.exe', 'powershell.exe Get-ADUser', 'CORP\\svc_backup'),
  conn('e12', 60, 'SRV-DC01', 900, 'svchost.exe', '13.107.4.50'),
  { id: 'e13', timestamp: at(70), type: 'file.create', source: 'etw', host: 'WS-014', user: 'CORP\\ana', process: { pid: 4300, name: 'rundll32.exe' }, file: { path: 'C:\\Users\\ana\\AppData\\x.tmp', hashes: { sha256: '9f2cabcdef00e41a' } } },
]

const ALERTS: SfAlert[] = [
  { id: 'a1', timestamp: at(31), rule_id: 'lolbin-rundll32', rule_name: 'Rundll32 lanzado por PowerShell', severity: 'high', host: 'WS-014', event_id: 'e4', event_type: 'process.create', summary: '', matched_on: [] },
  { id: 'a2', timestamp: at(282), rule_id: 'bcn-periodic-web', rule_name: 'Baliza C2', severity: 'critical', host: 'WS-014', event_id: 'e9', event_type: 'network.connect', summary: '', matched_on: [], network: { destination_ip: '185.220.101.47', destination_port: 443 } },
]

const q = (s: string) => parseQuery(s)

describe('query', () => {
  test('fields in either language, quoted phrases, negation and plain text', () => {
    expect(q('host:WS-014 usuario:CORP\\ana "-enc" -proceso:svchost.exe C:\\Windows')).toEqual([
      { field: 'host', value: 'WS-014', negate: false },
      { field: 'user', value: 'CORP\\ana', negate: false },
      { field: null, value: '-enc', negate: false },
      { field: 'process', value: 'svchost.exe', negate: true },
      { field: null, value: 'C:\\Windows', negate: false },
    ])
    expect(q('type:process.create port:443 linea:"-nop -w hidden"')).toEqual([
      { field: 'type', value: 'process.create', negate: false },
      { field: 'port', value: '443', negate: false },
      { field: 'cmd', value: '-nop -w hidden', negate: false },
    ])
    expect(q('   ')).toEqual([])
  })

  test('written back in the console language, quoting what needs it', () => {
    const tokens = q('host:WS-014 user:ana "-enc" -cmd:"a b"')
    expect(formatQuery(tokens, 'es')).toBe('host:WS-014 usuario:ana "-enc" -linea:"a b"')
    expect(formatQuery(tokens, 'en')).toBe('host:WS-014 user:ana "-enc" -cmd:"a b"')
    expect(q(formatQuery(tokens, 'es'))).toEqual(tokens)
  })

  test('a pivot never doubles a token', () => {
    const t: QueryToken = { field: 'host', value: 'ws-014', negate: false }
    expect(addToken(q('host:WS-014'), t)).toHaveLength(1)
    expect(addToken(q('host:WS-014'), { ...t, field: 'user' })).toHaveLength(2)
  })

  test('matching: exact host and type, kinds, numbers, parents, network, hashes, text and negation', () => {
    const ids = (s: string) => filterEvents(EVENTS, q(s)).map((e) => e.id)
    expect(ids('host:ws-014 tipo:proceso')).toEqual(['e1', 'e2', 'e3', 'e4'])
    expect(ids('host:WS-01')).toEqual([])
    expect(ids('pid:4200 -tipo:red')).toEqual(['e3'])
    expect(ids('padre:winword')).toEqual(['e3'])
    expect(ids('padre:4100')).toEqual(['e3'])
    expect(ids('destino:185.220.101.47:443 host:WS-014')).toEqual(['e5', 'e6', 'e7', 'e8', 'e9'])
    expect(ids('hash:9f2cab')).toEqual(['e13'])
    expect(ids('"-enc"')).toEqual(['e3'])
    expect(ids('powershell -host:WS-014')).toEqual(['e11'])
    expect(ids('type:network.connect ip:13.107')).toEqual(['e12'])
  })

  test('the history request narrows only by what the engine can match', () => {
    const now = Date.parse('2026-11-16T12:00:00Z')
    const path = historyPath(q('host:WS-014 tipo:proceso pid:4200 usuario:ana linea:"-nop -w" -proceso:svchost.exe'), '1h', now)
    const p = new URLSearchParams(path.split('?')[1])
    expect(path.startsWith('/api/events?')).toBe(true)
    expect(p.get('host')).toBe('WS-014')
    expect(p.get('type')).toBeNull() // a kind word is matched here, not by the engine
    expect(p.get('q')).toBe('-nop -w')
    expect(p.get('since')).toBe('2026-11-16T11:00:00.000Z')
    expect(p.get('limit')).toBe('1000')
    const all = new URLSearchParams(historyPath(q('type:network.connect pid:4200'), 'all', now).split('?')[1])
    expect(all.get('type')).toBe('network.connect')
    expect(all.get('q')).toBeNull()
    expect(all.get('since')).toBeNull()
  })

  test('suggestions: values of a field by frequency, or fields by their key', () => {
    const s = suggest(EVENTS, 'proceso:power', 'es')
    expect(s.values[0]).toEqual({ field: 'process', value: 'powershell.exe', count: 7 })
    expect(s.fields).toEqual([])
    expect(suggest(EVENTS, 'pu', 'es').fields).toEqual(['port'])
    expect(suggest(EVENTS, 'po', 'en').fields).toEqual(['port'])
    expect(suggest(EVENTS, 'SRV', 'es').values.map((v) => v.value)).toContain('SRV-DC01')
  })
})

describe('the event', () => {
  test('kinds from the engine type', () => {
    expect(['process.create', 'network.connect', 'dns.query', 'file.create', 'registry.set', 'image.load', 'email.received'].map((type) => kindOf({ type }))).toEqual([
      'process', 'network', 'dns', 'file', 'registry', 'image', 'other',
    ])
  })

  test('detail rows pivot on what can scope a search, the parent by name', () => {
    const rows = detailRows(EVENTS[2], parentIndex(EVENTS))
    const parent = rows.find((r) => r.key === 'parent')
    expect(parent?.value).toBe('winword.exe (4100)')
    expect(parent?.pivot).toEqual({ field: 'process', value: 'winword.exe', negate: false })
    expect(rows.find((r) => r.key === 'cmd')?.pivot?.field).toBe('cmd')
    expect(rows.find((r) => r.key === 'source')?.pivot).toBeUndefined()
    const net = detailRows(EVENTS[4], parentIndex(EVENTS))
    expect(net.find((r) => r.key === 'dst')).toEqual({ key: 'dst', value: '185.220.101.47:443', mono: true, pivot: { field: 'ip', value: '185.220.101.47', negate: false } })
    expect(detailRows(EVENTS[0], parentIndex(EVENTS)).find((r) => r.key === 'ppid')?.value).toBe('700')
  })

  test('histogram and span', () => {
    const span = timeSpan(EVENTS)!
    expect(span).toEqual({ from: T0, to: T0 + 281_000 })
    const h = histogram(EVENTS, span.from, span.to, 3)
    expect(h.reduce((a, b) => a + b, 0)).toBe(EVENTS.length)
    expect(h).toEqual([9, 2, 2])
    expect(timeSpan([])).toBeNull()
  })
})

describe('process tree', () => {
  const roots = processForest(EVENTS, ALERTS, 'ws-014')

  test('parents chain by PID and time; an unseen parent is a bare PID', () => {
    expect(roots).toHaveLength(1)
    expect(roots[0]).toMatchObject({ pid: 700, name: 'pid 700', seen: false })
    const chain = flattenForest(roots, () => true).map(({ node, depth }) => `${depth}:${node.name}`)
    expect(chain).toEqual(['0:pid 700', '1:explorer.exe', '2:winword.exe', '3:powershell.exe', '4:rundll32.exe'])
    expect(countNodes(roots)).toBe(5)
  })

  test('alerts hang from their process and light the path up to the root', () => {
    const flat = flattenForest(roots, () => true).map((x) => x.node)
    expect(flat.every((n) => n.hot)).toBe(true)
    const rundll = flat.find((n) => n.name === 'rundll32.exe')!
    expect(rundll.alerts.map((a) => a.id)).toEqual(['a1'])
    expect(rundll.activity.file).toBe(1)
    const ps = flat.find((n) => n.name === 'powershell.exe')!
    expect(ps.alerts.map((a) => a.id)).toEqual(['a2'])
    expect(ps.activity.network).toBe(5)
  })

  test('only the asked host; a quiet branch is not hot', () => {
    const dc = processForest(EVENTS, ALERTS, 'SRV-DC01')
    const flat = flattenForest(dc, () => true).map((x) => x.node)
    expect(flat.map((n) => n.name)).toEqual(['pid 500', 'svchost.exe', 'powershell.exe'])
    expect(flat.some((n) => n.hot)).toBe(false)
    expect(flattenForest(dc, () => false)).toHaveLength(1)
  })

  test('a reused PID belongs to the process alive at that time', () => {
    const events = [
      proc('p1', 0, 'H', 10, 1, 'old.exe'),
      proc('p2', 5, 'H', 20, 10, 'child-of-old.exe'),
      proc('p3', 50, 'H', 10, 1, 'new.exe'),
      proc('p4', 60, 'H', 30, 10, 'child-of-new.exe'),
    ]
    const flat = flattenForest(processForest(events, [], 'H'), () => true).map(({ node, depth }) => `${depth}:${node.name}`)
    expect(flat).toEqual(['0:pid 1', '1:old.exe', '2:child-of-old.exe', '1:new.exe', '2:child-of-new.exe'])
  })
})

describe('lenses', () => {
  test('hosts by event count', () => {
    expect(hostCounts(EVENTS)).toEqual([{ host: 'WS-014', count: 10 }, { host: 'SRV-DC01', count: 3 }])
  })

  test('rarity: the values seen on the fewest hosts come first', () => {
    const r = rarity(EVENTS, 'process')
    expect(r.totalHosts).toBe(2)
    // one host and one sighting; among equals the newest comes first
    expect(r.rows.slice(0, 2).map((x) => [x.value, x.hosts.length, x.count])).toEqual([['winword.exe', 1, 1], ['explorer.exe', 1, 1]])
    expect(r.rows[r.rows.length - 1]).toMatchObject({ value: 'powershell.exe', hosts: ['SRV-DC01', 'WS-014'], count: 7 })
    const pairs = rarity(EVENTS, 'pair').rows.map((x) => x.value)
    expect(pairs).toContain('winword.exe › powershell.exe')
    expect(pairs).toContain('svchost.exe › powershell.exe')
    expect(rarity(EVENTS, 'dst').rows.map((x) => x.value)).toEqual(['13.107.4.50:443', '185.220.101.47:443'])
  })

  test('flows: a steady cadence is regular and the engine beacon alert is attached', () => {
    const flows = networkFlows(EVENTS, ALERTS)
    expect(flows[0]).toMatchObject({ host: 'WS-014', process: 'powershell.exe', dst: '185.220.101.47:443', count: 5, regular: true })
    expect(flows[0].alert?.id).toBe('a2')
    expect(Math.round(flows[0].meanMs!)).toBe(60250)
    expect(flows[0].cv!).toBeLessThan(0.12)
    expect(flows[1]).toMatchObject({ dst: '13.107.4.50:443', count: 1, regular: false, meanMs: undefined, cv: undefined })
    const jittery = networkFlows([0, 5, 60, 62, 200, 201].map((s, i) => conn(`j${i}`, s, 'H', 1, 'x.exe', '1.2.3.4')), [])
    expect(jittery[0].regular).toBe(false)
  })

  test('flows: an earlier run is not averaged in, and an alert finds its destination through its event', () => {
    const early = [0, 0.3, 0.6, 0.9, 1.2].map((s, i) => conn(`r1-${i}`, s, 'H', 1, 'x.exe', '1.2.3.4'))
    const late = Array.from({ length: 8 }, (_, i) => conn(`r2-${i}`, 7200 + i * 2, 'H', 1, 'x.exe', '1.2.3.4'))
    const other = conn('o1', 7300, 'H', 1, 'x.exe', '5.6.7.8')
    const bcn: SfAlert = { ...ALERTS[1], id: 'b', host: 'H', event_id: 'r2-7', network: undefined }
    const flows = networkFlows([...early, ...late, other], [bcn])
    const main = flows.find((f) => f.dst === '1.2.3.4:443')!
    expect(main.count).toBe(13)
    expect(main.session).toHaveLength(8)
    expect(Math.round(main.meanMs!)).toBe(2000)
    expect(main.regular).toBe(true)
    expect(main.alert?.id).toBe('b')
    expect(flows.find((f) => f.dst === '5.6.7.8:443')?.alert).toBeUndefined()
  })
})

describe('storage', () => {
  const store = (value: string | null) => ({ getItem: () => value })

  test('saved queries: only well-formed entries survive; a name is replaced, newest first', () => {
    expect(readSavedQueries(store('not json'))).toEqual([])
    expect(readSavedQueries(store(JSON.stringify([{ id: 'a', name: 'PS', q: 'proceso:powershell.exe' }, { id: 1, name: 'x', q: '' }, null])))).toEqual([
      { id: 'a', name: 'PS', q: 'proceso:powershell.exe' },
    ])
    const list = upsertSavedQuery([{ id: 'a', name: 'PS', q: 'x' }, { id: 'b', name: 'DC', q: 'host:SRV-DC01' }], 'ps', 'proceso:powershell.exe', 'c')
    expect(list.map((x) => x.id)).toEqual(['c', 'b'])
  })

  test('notebooks round-trip and drop what is malformed', () => {
    let saved = ''
    const nb = newNotebook('n1', '  Persistencia con tareas programadas ', 'T1053.005', '2026-11-16T10:00:00Z')
    nb.cells.push({ id: 'c1', kind: 'search', text: 'proceso:schtasks.exe' }, { id: 'c2', kind: 'sql', text: 'SELECT 1' })
    nb.findings.push({ id: 'f1', text: 'Tarea creada en WS-014', at: '2026-11-16T10:05:00Z' })
    expect(writeNotebooks({ setItem: (_k, v) => void (saved = v) }, [nb])).toBe(true)
    const back = readNotebooks(store(saved))
    expect(back).toEqual([{ ...nb, title: 'Persistencia con tareas programadas' }])
    const broken = JSON.stringify([{ id: 'n2', title: 'x', technique: 'T1', created: 'a', updated: 'b', cells: [{ id: 'c', kind: 'shell', text: 'rm' }], findings: [{}] }, { title: 'sin id' }])
    expect(readNotebooks(store(broken))).toEqual([{ id: 'n2', title: 'x', technique: 'T1', created: 'a', updated: 'b', cells: [], findings: [] }])
  })
})

describe('url', () => {
  test('modes, sources and links', () => {
    expect(modeFromParam('arbol')).toBe('arbol')
    expect(modeFromParam('nada')).toBe('flujo')
    expect(sourceFromParam('historico')).toBe('historico')
    expect(sourceFromParam(null)).toBe('vivo')
    expect(v2InvestigateLink('host:WS-014')).toBe('/v2/investigar?q=host%3AWS-014')
    expect(v2InvestigateLink('', 'red')).toBe('/v2/investigar?modo=red')
  })
})
