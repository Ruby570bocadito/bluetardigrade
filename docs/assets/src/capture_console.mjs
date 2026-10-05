// Captures the console screenshots used by the root README
// (docs/assets/console-*.png). Two modes:
//
// 1. REAL ENGINE (default). Nothing fabricates data: point it at a
//    console wired to a running engine.
//
//    Lab recipe used for past committed sets (loopback only):
//      1. go build -o <lab>/engine ./cmd/engine
//         go build -o <lab>/scenario ./scripts/dev-tests/scenario
//      2. engine run -addr 127.0.0.1:17777 -api 127.0.0.1:17778 -rules rules
//         -sequences sequences -beacons beacons.yaml -thresholds thresholds.yaml
//         -suppressions <file> -store <db> -lifecycle <file> -api-token <t>
//         -allow-kill -respond-operators <v2 file> -respond-audit <file>
//         (relative paths, and the engine started under
//         `unshare -r -u` with `hostname LAB-SOC-01`, so no local path or
//         machine name reaches a screenshot)
//      3. feed it with the scenario in a loop (plus -beacon / -burst rounds)
//         and a few POST /api/respond/kill attempts (executed and denied);
//      4. cd web/console && bun run build && ENGINE_API_URL=http://127.0.0.1:17778
//         SF_API_TOKEN=<t> bun run start
//      5. create at least one incident from the alert queue (select alerts,
//         "Añadir a incidente"), then run this script.
//
// 2. FIXTURES (`CONSOLE_CAPTURE_FIXTURES=1`). Same route-interception
//    approach as scripts/dev-tests/check_console_browser.mjs: the engine
//    responses are contract-true fixtures (OpenAPI shapes), LAB-* hosts,
//    source=simulate, so the console itself labels the window as demo
//    data. Exists so the capture set stays reproducible on hosts without
//    the Go toolchain.
//
// Scenario events and fixtures carry source=simulate, so the console
// labels the window as demo in the header: the captures keep that label
// on purpose.
//
// Env: CONSOLE_URL (default http://127.0.0.1:3000), CONSOLE_TEST_TOOLS
// (directory with playwright, default tools/console-tests),
// CONSOLE_CAPTURE_FIXTURES=1.

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const ASSETS = path.resolve(here, '..')
const tooling = process.env.CONSOLE_TEST_TOOLS || path.join(repo, 'tools/console-tests')
const { chromium } = createRequire(path.join(tooling, 'package.json'))('playwright')
const base = (process.env.CONSOLE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const FIXTURES = process.env.CONSOLE_CAPTURE_FIXTURES === '1'

// ------------------------------------------------------------- fixtures
// Engine API shapes per docs/api/openapi.yaml; hosts are LAB-*, sources
// are simulate. The console renders its demo-data label over this window.
function fixtureEngine(page) {
  const now = Date.now()
  const iso = (msAgo) => new Date(now - msAgo).toISOString()
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR
  const HOSTS = ['LAB-WKS-01', 'LAB-WKS-07', 'LAB-SRV-DC01', 'LAB-SRV-FILE', 'LAB-WKS-12']
  const USERS = ['LAB\\jmartin', 'LAB\\svc_backup', 'LAB\\admin.p', 'LAB\\mlopez']

  let seq = 0
  const RULE_TAGS = {
    'T1003-lsass-comsvcs': ['attack.t1003', 'attack.credential-access'],
    'T1059-powershell-encoded': ['attack.t1059.001', 'attack.execution'],
    'T1071-dns-beacon': ['attack.t1071.004', 'attack.command-and-control'],
    'T1055-process-injection': ['attack.t1055', 'attack.defense-evasion'],
    'T1112-registry-run': ['attack.t1060', 'attack.persistence'],
    'T1047-wmi-create': ['attack.t1047', 'attack.execution', 'attack.lateral-movement'],
    'T1560-archive-collect': ['attack.t1560', 'attack.collection'],
    'T1041-exfil-https': ['attack.t1041', 'attack.exfiltration'],
    'T1078-valid-accounts': ['attack.t1078', 'attack.initial-access'],
    'T1027-obfuscated-files': ['attack.t1027', 'attack.defense-evasion'],
    'T1218-signed-binary': ['attack.t1218', 'attack.defense-evasion'],
    'T1005-local-collections': ['attack.t1005', 'attack.collection'],
    'T1486-ransom-note': ['attack.t1486', 'attack.impact'],
    'T1021-smb-admin': ['attack.t1021.002', 'attack.lateral-movement'],
    'T1087-account-discovery': ['attack.t1087', 'attack.discovery'],
    'T1562-defender-off': ['attack.t1562.001', 'attack.defense-evasion'],
    'T1190-exposed-svc': ['attack.t1190', 'attack.initial-access'],
    'T1053-scheduled-task': ['attack.t1053', 'attack.persistence', 'attack.privilege-escalation'],
  }
  const alert = (over) => {
    seq++
    return {
      id: String(seq).padStart(16, '0'),
      timestamp: iso(seq * 3.5 * MIN),
      rule_id: 'rule-',
      rule_name: '',
      severity: 'medium',
      host: HOSTS[seq % HOSTS.length],
      user: USERS[seq % USERS.length],
      event_id: `ev-${seq}`,
      event_type: 'process.create',
      summary: '',
      source: 'sysmon',
      matched_on: [],
      status: seq % 3 === 0 ? 'acknowledged' : 'new',
      ...over,
      tags: RULE_TAGS[over.rule_id] ?? [],
    }
  }

  const alerts = [
    alert({ rule_id: 'T1003-lsass-comsvcs', rule_name: 'Volcado de LSASS via comsvcs.dll', severity: 'critical', event_type: 'process.access', summary: 'rundll32.exe accedió a lsass.exe con GrantAccess 0x1010 (comsvcs MiniDump)', timestamp: iso(4 * MIN), status: 'new' }),
    alert({ rule_id: 'T1059-powershell-encoded', rule_name: 'PowerShell con comando codificado', severity: 'high', summary: 'powershell.exe -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoA…', timestamp: iso(9 * MIN), status: 'new' }),
    alert({ rule_id: 'T1071-dns-beacon', rule_name: 'Beaconing DNS a dominio nuevo', severity: 'high', event_type: 'dns.query', summary: 'consultas regulares cada 30 s a cdn-metrics-elastic.net', timestamp: iso(15 * MIN), status: 'acknowledged' }),
    alert({ rule_id: 'T1055-process-injection', rule_name: 'Inyección en proceso remoto', severity: 'critical', event_type: 'process.access', summary: 'CreateRemoteThread sobre explorer.exe desde powershell.exe', timestamp: iso(21 * MIN), status: 'new' }),
    alert({ rule_id: 'T1112-registry-run', rule_name: 'Persistencia en Run del registro', severity: 'high', event_type: 'registry.set', summary: 'HKCU\\...\\Run → "C:\\Users\\Public\\updtool.exe"', timestamp: iso(28 * MIN), status: 'new' }),
    alert({ rule_id: 'T1047-wmi-create', rule_name: 'Ejecución remota con WMI', severity: 'high', event_type: 'process.create', summary: 'wmiprvse.exe lanzó cmd.exe /c whoami en LAB-SRV-FILE', timestamp: iso(36 * MIN), status: 'closed' }),
    alert({ rule_id: 'T1560-archive-collect', rule_name: 'Comprimido de colección masiva', severity: 'medium', event_type: 'file.write', summary: '7z.exe creó C:\\Users\\Public\\backup_2026.zip (1.2 GB)', timestamp: iso(44 * MIN), status: 'new' }),
    alert({ rule_id: 'T1041-exfil-https', rule_name: 'Exfiltración por canal HTTPS', severity: 'critical', event_type: 'net.connect', summary: '18 MB enviados a 203.0.113.66:443 en 4 min', timestamp: iso(52 * MIN), status: 'acknowledged' }),
    alert({ rule_id: 'T1078-valid-accounts', rule_name: 'Cuenta válida fuera de horario', severity: 'medium', summary: 'inicio de sesión de LAB\\admin.p a las 03:12 local', timestamp: iso(3 * HOUR), status: 'closed' }),
    alert({ rule_id: 'T1027-obfuscated-files', rule_name: 'Script ofuscado en cola de impresión', severity: 'medium', event_type: 'file.write', summary: 'jse.dll escrito por spoolsv.exe (primer proceso visto)', timestamp: iso(5 * HOUR), status: 'new' }),
    alert({ rule_id: 'T1218-signed-binary', rule_name: 'Binario firmado abusa de proxy', severity: 'low', event_type: 'process.create', summary: 'mshta.exe http://192.0.2.20/a.hta', timestamp: iso(9 * HOUR), status: 'closed' }),
    alert({ rule_id: 'T1005-local-collections', rule_name: 'Recolección de documentos del usuario', severity: 'medium', event_type: 'file.write', summary: 'lectura masiva de *.docx en Documentos por tar.exe', timestamp: iso(26 * HOUR), status: 'acknowledged' }),
    alert({ rule_id: 'T1486-ransom-note', rule_name: 'Nota de ransomware', severity: 'critical', event_type: 'file.write', summary: 'README-RESTORE.txt escrito en 41 rutas en 2 min', timestamp: iso(2 * DAY + 3 * HOUR), status: 'closed' }),
    alert({ rule_id: 'T1021-smb-admin', rule_name: 'Administrador remoto con SMB', severity: 'high', event_type: 'net.connect', summary: 'psexec.py hacia ADMIN$ en LAB-SRV-DC01', timestamp: iso(2 * DAY + 6 * HOUR), status: 'closed' }),
    alert({ rule_id: 'T1087-account-discovery', rule_name: 'Enumeración de cuentas del dominio', severity: 'low', event_type: 'process.create', summary: 'net.exe group /domain', timestamp: iso(3 * DAY + 2 * HOUR), status: 'closed' }),
    alert({ rule_id: 'T1562-defender-off', rule_name: 'Defensor en tiempo real desactivado', severity: 'high', event_type: 'registry.set', summary: 'DisableAntiSpyware = 1 en HKLM\\SOFTWARE\\Policies\\...', timestamp: iso(4 * DAY + 5 * HOUR), status: 'closed' }),
    alert({ rule_id: 'T1190-exposed-svc', rule_name: 'Servicio expuesto con fuzzing', severity: 'medium', source: 'suricata', event_type: 'ids.alert', summary: 'SIG 2024-11 "WEB-MISC exposure attempt" desde 198.51.100.7', timestamp: iso(5 * DAY + 7 * HOUR), status: 'closed' }),
    alert({ rule_id: 'T1053-scheduled-task', rule_name: 'Tarea programada nueva', severity: 'medium', event_type: 'process.create', summary: 'schtasks /create /tn "UpdChk" /sc hourly', timestamp: iso(6 * DAY + 4 * HOUR), status: 'closed' }),
  ]

  const rules = Object.entries(RULE_TAGS).map(([id, tags]) => ({
    id,
    name: alerts.find((a) => a.rule_id === id)?.rule_name ?? id,
    severity: alerts.find((a) => a.rule_id === id)?.severity ?? 'medium',
    event_type: alerts.find((a) => a.rule_id === id)?.event_type ?? 'process.create',
    mitre: id.split('-')[0].toUpperCase(),
    tactic: tags.find((t) => !t.startsWith('attack.t'))?.replace('attack.', '') ?? '',
    tags,
    conditions: [],
  }))

  const events = Array.from({ length: 34 }, (_, i) => {
    const kind = i % 6
    const e = { id: `evt-${1000 + i}`, timestamp: iso(i * 7 * 1000), host: HOSTS[i % HOSTS.length], source: i % 5 === 4 ? 'suricata' : 'sysmon' }
    if (kind === 0) return { ...e, type: 'process.create', process: { pid: 4000 + i * 7, ppid: 812, name: ['powershell.exe', 'cmd.exe', 'chrome.exe', '7z.exe'][i % 4], command_line: 'C:\\Windows\\system32\\cmd.exe /d /c whoami', image: 'C:\\Windows\\System32\\cmd.exe' }, user: USERS[i % USERS.length] }
    if (kind === 1) return { ...e, type: 'net.connect', network: { protocol: 'tcp', source_ip: '10.10.1.24', source_port: 50000 + i, destination_ip: '93.184.216.34', destination_port: 443, domain: i % 2 ? 'update.office.com' : 'cdn-metrics-elastic.net' }, process: { pid: 4820, name: 'msedge.exe' } }
    if (kind === 2) return { ...e, type: 'file.write', file: { path: 'C:\\Users\\Public\\artifacts\\module' + i + '.dll', extension: '.dll', size_bytes: 148_000 + i * 977, hashes: { sha256: '9f2c' + (1e10 + i).toString(16) } }, process: { pid: 2244, name: 'rundll32.exe' } }
    if (kind === 3) return { ...e, type: 'registry.set', registry: { key: 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', value_name: 'OneDriveSync' + (i % 3), operation: 'write' }, process: { pid: 1188, name: 'wscript.exe' } }
    if (kind === 4) return { ...e, type: 'ids.alert', attributes: { ids_signature: 'ET SCAN Suspicious inbound to port 445', ids_action: 'allowed', ids_verdict: 'alert' }, network: { source_ip: '198.51.100.7', destination_ip: '10.10.1.10', destination_port: 445 } }
    return { ...e, type: 'dns.query', network: { protocol: 'udp', source_ip: '10.10.1.24', destination_ip: '10.10.1.1', destination_port: 53, domain: ['mail-attachment.googleusercontent.com', 'stats.g.doubleclick.net', 'cdn-metrics-elastic.net'][i % 3] }, process: { pid: 4820, name: 'msedge.exe' } }
  })

  const stats = {
    uptime_s: 3 * DAY + 7 * HOUR + 920,
    events_total: 1_842_317,
    alerts_total: alerts.length,
    events_per_min: 412,
    dropped: 0,
    ingest_rejected: 3,
    identities: { 'LAB-WKS-01': 51_204, 'LAB-SRV-DC01': 44_870, 'LAB-WKS-07': 39_004 },
    by_severity: { critical: 4, high: 6, medium: 6, low: 2 },
    rules_count: rules.length,
    rules_types: ['process.create', 'process.access', 'file.write', 'registry.set', 'net.connect', 'dns.query', 'ids.alert'],
    events_buffered: 2048,
    webhook_sent: 132,
    webhook_failed: 0,
    webhook_dropped: 0,
    elastic_sent: 4021,
    elastic_failed: 0,
    splunk_sent: 0,
    splunk_failed: 0,
    notify_channels: [],
    suppressions_active: 2,
    correlator_states: 26,
    correlator_sequences: 13,
    correlator_cap: 8192,
    beacons_tracked: 2,
    beacons_cap: 4096,
    beacons_fired: 1,
    thresholds_defs: 6,
    thresholds_fired: 0,
    risk_hosts_tracked: 5,
    hot_hosts: [
      { host: 'LAB-WKS-01', score: 41.5, alerts: 7, last_seen: iso(30_000) },
      { host: 'LAB-SRV-FILE', score: 12.0, alerts: 3, last_seen: iso(2 * MIN) },
      { host: 'LAB-WKS-07', score: 6.4, alerts: 4, last_seen: iso(70_000) },
    ],
    store_enabled: true,
    store_events: 1_771_004,
    store_alerts: alerts.length,
    store_write_failures: 0,
  }

  const fleet = {
    enabled: true,
    hosts: HOSTS.map((host, i) => ({
      host,
      status: i === 4 ? 'silent' : i === 3 ? 'idle' : 'online',
      first_seen: iso(9 * DAY + i * HOUR),
      last_seen: iso((i === 4 ? 47 : 2 + i) * MIN),
      last_event_type: 'process.create',
      events: 90_000 - i * 9_123,
      events_last_5m: i === 4 ? 0 : 120 - i * 17,
      sources: i % 2 ? ['etw', 'dns'] : ['etw'],
      peers: [`10.10.1.${20 + i}:7777`],
      identity: `lab-${host.toLowerCase()}`,
      sensor: i === 4 ? undefined : {
        kind: 'etw-rust',
        version: '0.9.2',
        os: 'Windows 11 Pro 23H2 build 22631',
        capture: 'procesos, red, DNS, registro',
        run_mode: 'servicio de Windows',
        interval_s: 60,
        uptime_s: 2 * DAY + i * HOUR,
        spooled: 0,
        dropped: 0,
        last_heartbeat: iso((i === 3 ? 14 : 1 + i) * MIN),
      },
      silent_since: i === 4 ? iso(47 * MIN) : undefined,
    })),
    online: 3,
    silent: 1,
    idle: 1,
    heartbeat_grace_min_s: 600,
  }

  const enroll = {
    enabled: true,
    hint: 'alta por token activa',
    pending: 1,
    active: 4,
    usable_tokens: 1,
    writes: true,
    tokens: [
      { id: 'tok-01', label: 'Altas de la planta 2', max_uses: 5, uses: 2, created_at: iso(2 * DAY), expires_at: new Date(now + 5 * DAY).toISOString(), created_by: 'consola', status: 'active' },
    ],
    hosts: [
      { name: 'LAB-WKS-12', host: 'LAB-WKS-12', state: 'pending', token_id: 'tok-01', peer: '10.10.1.40:52114', enrolled_at: iso(38 * MIN), last_attempt: iso(38 * MIN) },
      { name: 'LAB-WKS-01', host: 'LAB-WKS-01', state: 'active', token_id: 'tok-01', peer: '10.10.1.20', enrolled_at: iso(6 * DAY), auto_approved: true },
    ],
  }

  const sequences = [
    { id: 'seq-cred', name: 'Campaña de robo de credenciales', description: 'Tres técnicas de volcado sobre el mismo equipo: comsvcs, procdump y colmena SAM.', severity: 'critical', window_seconds: 300, tags: ['attack.t1003', 'attack.credential-access'], steps: ['Volcado de LSASS via comsvcs.dll', 'Volcado de LSASS con procdump', 'Volcado del registro SAM'], scope: 'host' },
    { id: 'seq-intrusion', name: 'Campaña de intrusión completa', description: 'Descarga, persistencia, reconocimiento y exfiltración en la misma máquina.', severity: 'critical', window_seconds: 3600, tags: ['attack.t1059', 'attack.exfiltration'], steps: ['Descarga con certutil o bitsadmin', 'Persistencia en Run del registro', 'Exfiltración por canal HTTPS'], scope: 'host' },
    { id: 'seq-lateral', name: 'Movimiento lateral por SMB', description: 'Un mismo salto de administrador en varias máquinas con servicio SMB.', severity: 'high', window_seconds: 1800, tags: ['attack.t1021'], steps: ['Administrador remoto con SMB', 'Ejecución remota con WMI'], scope: 'user', min_hosts: 2 },
  ]

  const suppressions = {
    entries: [
      { rule_id: 'T1087-account-discovery', host: 'LAB-SRV-DC01', reason: 'Inventario semanal del equipo de sistemas (ticket 4471)', expires: new Date(now + 3 * DAY).toISOString() },
      { rule_id: 'T1078-valid-accounts', host: 'LAB-WKS-07', reason: 'Turno de noche del SOC, revisado en persona' },
    ],
  }

  const incidents = {
    persistent: true,
    incidents: [
      {
        id: 'inc-lab-cred',
        title: 'Volcado de credenciales en LAB-WKS-01',
        summary: 'Presunta campaña de robo de hashes con movimiento previo de reconocimiento. Contención pendiente de aprobación.',
        severity: 'critical',
        status: 'investigating',
        owner: 'a.rios',
        hosts: ['LAB-WKS-01', 'LAB-SRV-FILE'],
        alert_ids: [alerts[0].id, alerts[1].id, alerts[7].id],
        timeline: [
          { at: iso(55 * MIN), by: 'consola', action: 'created', detail: 'Incidente creado desde la cola de alertas' },
          { at: iso(40 * MIN), by: 'a.rios', action: 'status', detail: 'Estado → investigando' },
          { at: iso(12 * MIN), by: 'm.lopez', action: 'note', detail: 'El volcado coincide con la ventana del beacon DNS; pido retención ampliada del store.' },
        ],
        created_at: iso(55 * MIN),
        updated_at: iso(12 * MIN),
      },
    ],
  }

  const respondState = {
    armed: true,
    signal: 'SIGKILL',
    operators_count: 2,
    protected_count: 3,
    operators_path: 'C:\\ProgramData\\bluetardigrade\\respond-operators.yaml',
    protected_path: 'C:\\ProgramData\\bluetardigrade\\respond-protected.yaml',
    audit_path: 'C:\\ProgramData\\bluetardigrade\\respond-audit.jsonl',
    audit_size: 18_432,
    audit_ceiling: 67_108_864,
  }

  const respondAudit = {
    skipped: 0,
    truncated: false,
    records: [
      { ts: iso(58 * MIN), action_id: 'act-9f21', decision: 'executed', pid: 6612, process_name: 'dumpme.exe', resolved_name: 'C:\\Users\\Public\\dumpme.exe', operator: 'a.rios', rule_id: 'T1003-lsass-comsvcs', alert_id: alerts[0].id, reason: 'Volcado de LSASS confirmado; contención del host', host: 'LAB-WKS-01', signal: 'SIGKILL', mechanism: 'pidfd', source: 'api' },
      { ts: iso(2 * HOUR), action_id: 'act-9e77', decision: 'denied', code: 'protected', pid: 908, process_name: 'winlogon.exe', resolved_name: 'C:\\Windows\\System32\\winlogon.exe', operator: 'm.lopez', reason: 'Proceso protegido por política', host: 'LAB-WKS-07', signal: 'SIGKILL', mechanism: 'refused', source: 'api' },
      { ts: iso(5 * HOUR), action_id: 'act-9d10', decision: 'executed', pid: 4012, process_name: 'svchost_fake.exe', resolved_name: 'C:\\Users\\Public\\svchost_fake.exe', operator: 'a.rios', reason: 'Servicio falso con persistencia en Run', host: 'LAB-SRV-FILE', signal: 'SIGKILL', mechanism: 'pidfd', source: 'cli', followup: true },
    ],
  }

  const forensics = {
    alert: { ...alerts[0], enrich: { parent_name: 'winword.exe' } },
    captured_at: iso(4 * MIN),
    host: 'LAB-WKS-01',
    window: '5m before alert',
    timeline: [
      { id: 'ev-f1', timestamp: iso(5 * MIN), type: 'process.create', source: 'sysmon', host: 'LAB-WKS-01', process: { pid: 7448, ppid: 6104, name: 'winword.exe', command_line: '"C:\\Program Files\\Microsoft Office\\WINWORD.EXE" /n informe.docx' }, user: 'LAB\\jmartin' },
      { id: 'ev-f2', timestamp: iso(4.6 * MIN), type: 'process.create', source: 'sysmon', host: 'LAB-WKS-01', process: { pid: 8120, ppid: 7448, name: 'rundll32.exe', command_line: 'rundll32.exe comsvcs.dll,#1024 640 lsass.dmp full' }, user: 'LAB\\jmartin' },
      { id: 'ev-f3', timestamp: iso(4 * MIN), type: 'process.access', source: 'sysmon', host: 'LAB-WKS-01', process: { pid: 8120, name: 'rundll32.exe' }, target: { pid: 640, name: 'lsass.exe' }, access: { granted_access: '0x1010', call_trace: 'Unbacked|comsvcs' } },
      { id: 'ev-f4', timestamp: iso(3.5 * MIN), type: 'file.write', source: 'sysmon', host: 'LAB-WKS-01', file: { path: 'C:\\Users\\Public\\lsass.dmp', extension: '.dmp', size_bytes: 48_911_360, hashes: { sha256: 'b41d8cd98f00b204e9800998ecf8427e' } } },
    ],
    summary: { events: 4, process_creates: 2, network_connects: 0, file_writes: 1, registry_sets: 0, process_accesses: 1, other: 0, distinct_users: 1, distinct_images: ['winword.exe', 'rundll32.exe'] },
  }

  const stamp = iso(0)
  return async (page) => {
    await page.addInitScript(() => {
      class FixtureSource {
        static OPEN = 1
        readyState = 0
        listeners = new Map()
        constructor() { setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
        addEventListener(topic, fn) { this.listeners.set(topic, fn) }
        close() { this.readyState = 2 }
      }
      window.EventSource = FixtureSource
    })
    await page.route('**/api/engine/**', async (route) => {
      const u = new URL(route.request().url())
      const p = u.pathname.replace('/api/engine', '')
      let data
      if (p === '/api/stats') data = stats
      else if (p === '/api/events') data = events
      else if (p === '/api/alerts') data = alerts
      else if (p === '/api/rules') data = rules
      else if (p === '/api/sequences') data = sequences
      else if (p === '/api/suppressions') data = suppressions
      else if (p === '/api/fleet') data = fleet
      else if (p === '/api/enroll') data = enroll
      else if (p === '/api/incidents') data = incidents
      else if (p === '/api/respond/state') data = respondState
      else if (p === '/api/respond/audit') data = respondAudit
      else if (p === '/api/alerts/search') data = { items: alerts.slice(8), source: 'sqlite', has_more: false, next_cursor: '', page_cursor: '', scanned: 10, scan_limited: false }
      else if (p.startsWith('/api/alerts/') && p.endsWith('/forensics')) data = forensics
      else if (p.startsWith('/api/alerts/') && route.request().method() === 'POST') data = { alert_id: 'x', status: 'acknowledged', at: stamp }
      else { await route.fulfill({ status: 404, body: '' }); return }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    })
  }
}

// ------------------------------------------------------------------ shots
const SHOTS = [
  { file: 'console-panel.png', query: '', height: 1000 },
  { file: 'console-panel-light.png', query: '', height: 1000, theme: 'light' },
  { file: 'console-estado.png', query: '?view=estado', height: 1000 },
  { file: 'console-flujo.png', query: '?view=flujo', height: 1000 },
  { file: 'console-alertas.png', query: '?view=alertas', height: 1000, selectFirst: true },
  { file: 'console-seleccion.png', query: '?view=alertas', height: 1000, pickRows: 3 },
  { file: 'console-incidentes.png', query: '?view=incidentes', height: 1000 },
  { file: 'console-equipos.png', query: '?view=equipos', height: 1000 },
  { file: 'console-reglas.png', query: '?view=reglas', height: 1000 },
  { file: 'console-reglas-light.png', query: '?view=reglas', height: 1000, theme: 'light' },
  { file: 'console-cadenas.png', query: '?view=cadenas', height: 1000 },
  { file: 'console-supresiones.png', query: '?view=supresiones', height: 1000 },
  { file: 'console-respuesta-activa.png', query: '?view=respuesta', height: 1000 },
  { file: 'console-noc.png', query: '', height: 1000, noc: true },
]

const browser = await chromium.launch({ headless: true })
try {
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1600, height: shot.height }, deviceScaleFactor: 2, reducedMotion: 'reduce', locale: 'es-ES' })
    if (FIXTURES) await (await fixtureEngine(page))(page)
    await page.addInitScript(([theme]) => localStorage.setItem('bt-theme', theme ?? 'dark'), [shot.theme])
    await page.goto(base + '/' + shot.query)
    await page.locator('#console-main').waitFor()
    // let the first poll, the snapshot and the chart layouts land
    await page.waitForTimeout(5000)
    if (shot.selectFirst) {
      await page.locator('table tbody tr button').first().click()
      await page.getByRole('complementary', { name: 'Detalle de la alerta seleccionada' }).waitFor()
      await page.waitForTimeout(500)
    }
    if (shot.pickRows) {
      const boxes = page.getByRole('checkbox', { name: /^Seleccionar .+\(/ })
      for (let i = 0; i < shot.pickRows; i++) await boxes.nth(i).check()
      await page.getByRole('region', { name: 'Acciones sobre la selección' }).waitFor()
    }
    if (shot.noc) {
      await page.getByRole('button', { name: 'Abrir modo NOC' }).click()
      await page.getByRole('dialog', { name: 'Modo NOC' }).waitFor()
      await page.waitForTimeout(2500)
    }
    await page.screenshot({ path: path.join(ASSETS, shot.file) })
    console.log('shot: ' + shot.file)
    await page.close()
  }
} finally {
  await browser.close()
}
