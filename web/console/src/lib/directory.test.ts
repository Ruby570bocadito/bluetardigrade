import { afterEach, describe, expect, test } from 'bun:test'
import {
  adKind,
  adPageSize,
  coverageFrom,
  fetchADObjects,
  fetchADPosture,
  fetchADPostureHistory,
  fetchADStatus,
  findingById,
  PRIVILEGED_FINDING_ID,
  scoreTone,
  severityEntries,
  uacFlagLabels,
  UAC_DISABLED,
  UAC_DONT_EXPIRE_PASSWORD,
  UAC_DONT_REQUIRE_PREAUTH,
  UAC_TRUSTED_FOR_DELEGATION,
  type ADFinding,
  type ADPosture,
} from './directory'

const realFetch = globalThis.fetch
let sent: { url: string; init: RequestInit }[] = []

afterEach(() => {
  globalThis.fetch = realFetch
})

function respond(status: number, body: string) {
  sent = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status })
  }) as typeof fetch
}

describe('directory client (AD-1 surface)', () => {
  test('the object fetch carries kind, paging and a trimmed query', async () => {
    respond(200, JSON.stringify({ total: 2, offset: 50, objects: [] }))
    const res = await fetchADObjects('user', '  ada  ', 50, 50)
    expect(res.ok).toBe(true)
    expect(sent[0].url).toBe('/api/engine/api/ad/objects/user?limit=50&offset=50&q=ada')
  })

  test('an empty query sends no q parameter', async () => {
    respond(200, JSON.stringify({ total: 0, offset: 0, objects: [] }))
    await fetchADObjects('computer', '', 25, 0)
    expect(sent[0].url).toBe('/api/engine/api/ad/objects/computer?limit=25&offset=0')
  })

  test('the 501 of an unarmed engine travels with the arming hint', async () => {
    respond(501, '{"error":"the Active Directory connector is not armed: start the engine with -ad <config.yaml> (and -store, which holds the snapshot)"}')
    const res = await fetchADPosture()
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(501)
      expect(res.error).toContain('-ad')
    }
  })

  test('status and history hits hit their routes', async () => {
    respond(200, '{"connected":true}')
    await fetchADStatus()
    expect(sent[0].url).toBe('/api/engine/api/ad/status')
    respond(200, '{"points":[]}')
    await fetchADPostureHistory(30)
    expect(sent[0].url).toBe('/api/engine/api/ad/posture/history?limit=30')
  })
})

describe('directory lens helpers', () => {
  test('kinds fall back to user and page sizes to the documented default', () => {
    expect(adKind('group')).toBe('group')
    expect(adKind('ou')).toBe('ou')
    expect(adKind('bogus')).toBe('user')
    expect(adKind(undefined)).toBe('user')
    expect(adPageSize(100)).toBe(100)
    expect(adPageSize(7)).toBe(50)
  })

  test('uacFlagLabels annotates exactly the bits the console declares', () => {
    expect(uacFlagLabels(0)).toEqual([])
    expect(uacFlagLabels(UAC_DISABLED)).toEqual(['deshabilitada'])
    expect(uacFlagLabels(UAC_DISABLED | UAC_DONT_EXPIRE_PASSWORD)).toEqual(['deshabilitada', 'sin caducidad'])
    expect(uacFlagLabels(UAC_TRUSTED_FOR_DELEGATION | UAC_DONT_REQUIRE_PREAUTH)).toEqual(['delegación', 'sin preauth'])
  })

  test('severityEntries keeps engine order and drops zero rows', () => {
    const entries = severityEntries({ high: 2, critical: 1, low: 0, medium: 3 })
    expect(entries.map((e) => e.key)).toEqual(['critical', 'high', 'medium'])
    expect(entries.map((e) => e.value)).toEqual([1, 2, 3])
    expect(severityEntries({})).toEqual([])
  })

  test('scoreTone uses the console bands (high score is good)', () => {
    expect(scoreTone(95)).toBe('ok')
    expect(scoreTone(80)).toBe('ok')
    expect(scoreTone(79)).toBe('warn')
    expect(scoreTone(50)).toBe('warn')
    expect(scoreTone(0)).toBe('bad')
  })

  test('coverageFrom derives the AD-5 triple from engine numbers only', () => {
    const findings: ADFinding[] = [
      { id: 'krbtgt_password_age', title: 'x', severity: 'high', description: '', remediation: '', count: 1, objects: [], objects_truncated: false },
      {
        id: 'computers_without_sensor',
        title: 'Equipos sin sensor',
        severity: 'high',
        description: '',
        remediation: '',
        count: 3,
        objects: [{ dn: 'cn=w10,dc=lab', name: 'W10', detail: 'sin telemetría del sensor' }],
        objects_truncated: false,
      },
    ]
    const cov = coverageFrom(findings, { users: 10, groups: 4, computers: 9, ous: 2 }, 6)
    expect(cov).not.toBeNull()
    if (cov) {
      expect(cov.withoutSensor).toBe(3)
      expect(cov.inDirectory).toBe(9)
      expect(cov.withSensor).toBe(6)
      expect(cov.objects).toHaveLength(1)
    }
    // without the fleet stat the third leg stays null (no invented difference)
    const partial = coverageFrom(findings, { users: 10, groups: 4, computers: 9, ous: 2 }, null)
    expect(partial?.withSensor).toBeNull()
    // without the finding (or without snapshot counts) there is no coverage at all
    expect(coverageFrom([findings[0]], { users: 0, groups: 0, computers: 0, ous: 0 }, 1)).toBeNull()
    expect(coverageFrom(findings, undefined, 1)).toBeNull()
  })

  test('findingById locates the privileged-accounts finding the view builds on', () => {
    const findings: ADFinding[] = [
      { id: PRIVILEGED_FINDING_ID, title: 'Miembros efectivos', severity: 'high', description: '', remediation: '', count: 2, objects: [], objects_truncated: false },
    ]
    expect(findingById(findings, PRIVILEGED_FINDING_ID)?.title).toBe('Miembros efectivos')
    expect(findingById([], 'x')).toBeUndefined()
  })

  test('a ready:false posture (armed, no sync yet) decodes with null score', async () => {
    const EMPTY: ADPosture = { ready: false, generated_at: '', score: null, summary: {}, findings: [], objects_checked: 0, inactive_days: 30, krbtgt_max_age_days: 365 }
    respond(200, JSON.stringify(EMPTY))
    const res = await fetchADPosture()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.ready).toBe(false)
  })
})
