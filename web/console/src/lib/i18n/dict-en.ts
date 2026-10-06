// English dictionary — typed as Dict (the shape of the Spanish source), so
// any key drift fails `bunx tsc --noEmit`; the runtime test re-checks it.
// The same rule as the ES side applies: engine-provided text is never
// translated here, only console copy.

import type { Dict } from './dict-es'

export const dictEn: Dict = {
  views: {
    panel: { title: 'Operations panel' },
    estado: { title: 'Platform status' },
    flujo: { title: 'Live feed' },
    alertas: { title: 'Alert queue' },
    incidentes: { title: 'Incidents' },
    equipos: { title: 'Hosts' },
    directorio: { title: 'Active Directory' },
    informes: { title: 'Reports' },
    probador: { title: 'Rule tester' },
    ruido: { title: 'Noise report' },
    simulacion: { title: 'Detection validation' },
    reglas: { title: 'Detection rules' },
    cadenas: { title: 'Kill chain sequences' },
    inteligencia: { title: 'Threat intelligence' },
    supresiones: { title: 'Operator suppressions' },
    respuesta: { title: 'Active response' },
    analista: { title: 'AI analyst' },
  },

  nav: {
    panel: {
      label: 'Dashboard',
      group: 'Operation',
      description: 'Pending triage, activity and engine health',
      keywords: 'dashboard overview metrics risk inicio panel',
    },
    estado: {
      label: 'Status',
      group: 'Operation',
      description: 'Engine, ingest, queues, store and external delivery at a glance',
      keywords: 'health platform status engine ingest queue store sink siem version',
    },
    flujo: {
      label: 'Live feed',
      group: 'Operation',
      description: 'Search telemetry and inspect events',
      keywords: 'events sensor processes live feed telemetry',
    },
    alertas: {
      label: 'Alerts',
      group: 'Operation',
      description: 'Investigate, acknowledge and close detections',
      keywords: 'history alerts queue triage evidence alertas',
    },
    incidentes: {
      label: 'Incidents',
      group: 'Operation',
      description: 'Cases grouping alerts, with status, owner and timeline',
      keywords: 'cases incident investigation casos',
    },
    equipos: {
      label: 'Hosts',
      group: 'Operation',
      description: 'Per-host record: risk, alerts, processes and connections',
      keywords: 'hosts machines endpoints machines record equipos',
    },
    informes: {
      label: 'Reports',
      group: 'Operation',
      description: 'Engine report catalog with CSV/JSON download and printable view',
      keywords: 'reports executive summary coverage fleet activity csv json print pdf informes',
    },
    reglas: {
      label: 'Rules',
      group: 'Detection',
      description: 'Loaded rule and condition catalog',
      keywords: 'rules yaml mitre detections reglas',
    },
    cadenas: {
      label: 'Sequences',
      group: 'Detection',
      description: 'Correlation sequences and stages',
      keywords: 'kill chain sequences correlator cadenas',
    },
    inteligencia: {
      label: 'Intel',
      group: 'Detection',
      description: 'Local indicator lists and per-host process baselines',
      keywords: 'intel ioc indicators lists hash domain ip baseline new process threats',
    },
    supresiones: {
      label: 'Suppressions',
      group: 'Detection',
      description: 'Operator exceptions and expirations',
      keywords: 'allowlist noise false positives supresiones',
    },
    probador: {
      label: 'Tester',
      group: 'Detection',
      description: 'Check what an event would trigger, without raising alerts',
      keywords: 'test tester event simulate probador',
    },
    ruido: {
      label: 'Noise',
      group: 'Detection',
      description: 'Processes, domains and detectors generating the most events or alerts',
      keywords: 'noise processes dns domains top suppress known software volume ruido',
    },
    simulacion: {
      label: 'Validation',
      group: 'Detection',
      description: 'Detection validation battery: scenarios, runs, history and trend',
      keywords: 'simulation scenarios validation battery lab attack matrix pass rate trend',
    },
    respuesta: {
      label: 'Active response',
      group: 'Response',
      description: 'Query response status and audit trail',
      keywords: 'respond audit kill process respuesta',
    },
    directorio: {
      label: 'Directory',
      group: 'Operations',
      description: 'Active Directory snapshot and domain posture: findings, sensor coverage and objects',
      keywords: 'ad active directory domain ldap posture findings coverage users groups computers',
    },
    analista: {
      label: 'AI analyst',
      group: 'Assist',
      description: 'Assistance to explain and investigate alerts',
      keywords: 'ai chat model assistant analyst analista',
    },
  },

  commands: {
    acciones: { group: 'Actions' },
    refresh: {
      label: 'Refresh engine data',
      description: 'Query the current state and buffers again',
      keywords: 'refresh reload reconnect sync recover recargar',
    },
    noc: {
      label: 'NOC mode',
      description: 'Full-screen rotation for a wall monitor',
      keywords: 'noc full screen wall monitor sala pantalla pared',
    },
    onboarding: {
      label: 'Setup assistant',
      description: 'Access, ingest certificate, first enrollment token and sensor check',
      keywords: 'wizard setup assistant first run install token enrollment certificate tls sensor admin asistente',
    },
    help: {
      label: 'Keyboard help',
      description: 'List the console shortcuts',
      keywords: 'shortcuts help keys atajos ayuda',
    },
  },

  chrome: {
    skipToContent: 'Skip to content',
    navLabel: 'Console sections',
    live: 'Live',
    connecting: 'Connecting',
    engineOffline: 'Engine offline',
    dataHonesty: 'Real pipeline data only. Demo data is labeled; with no events, no telemetry is invented.',
    shortcutsLine: 'Shortcuts:',
    onboardingOpen: 'Set up',
    openCommands: 'Open commands',
    commandsTitle: 'Commands (Ctrl+K / ⌘K)',
    searchViewsCommands: 'Search views and commands',
    demoBadge: 'The received window contains demonstration data',
    openNoc: 'Open NOC mode',
    nocTitle: 'NOC mode: full-screen rotation for a wall monitor',
    utcTitle: 'UTC time',
    footerProduct: 'bluetardigrade · SOC console',
    footerTagline: 'detection, investigation and response for Windows endpoints',
    analystDown: 'analyst service offline',
    selectionLabel: 'Queue selection',
    detectionTab: 'Detection',
  },

  badges: {
    openAlerts: (n, critical) => `${n} open alerts in the window${critical ? ', with critical ones' : ''}`,
    silentHosts: (n) => `${n} hosts without sensor signal`,
    openIncidents: (n) => `${n} open incidents`,
    atajo: (hint) => `Shortcut: ${hint}`,
    webhookOk: (sent) => `Webhook: ${sent} alerts delivered to the external connector`,
    webhookBad: (failed, dropped, sent) => `Webhook failing: ${failed} failed, ${dropped} dropped, ${sent} delivered`,
    webhookErr: (n) => `${n} failed`,
    webhookDropped: (n) => `${n} drop`,
  },

  palette: {
    title: 'Console commands',
    close: 'Close commands',
    searchLabel: 'Search commands',
    placeholder: 'Search for a view or action…',
    listLabel: 'Available commands',
    available: (n) => `${n} commands available`,
    refreshing: 'Refresh in progress',
    empty: 'No commands match this search. Try “alerts”, “rules” or “refresh”.',
    hintLine: '↑ ↓ choose · Enter run · Esc close',
  },

  shortcuts: {
    title: 'Keyboard shortcuts',
    close: 'Close the shortcuts sheet',
    commandsHeading: 'Commands',
    searchViews: 'Search views and actions',
    thisSheet: 'This sheet',
    toggleRow: 'Toggle',
    closeRow: 'Close',
    prose: 'Navigation shortcuts are ignored while you type, during text composition and inside open menus or dialogs.',
  },

  theme: {
    next: {
      system: 'Switch to follow the system',
      light: 'Switch to light theme',
      dark: 'Switch to dark theme',
    },
  },

  lang: {
    toEn: 'Switch the console to English',
    toEs: 'Switch the console to Spanish',
  },

  onboarding: {
    title: 'Set up',
    desc: 'What a fresh installation needs, in four steps, with the state the engine reports. Nothing is executed on any host: the assistant only reads the engine and uses the two enrollment actions Hosts already offered (create a token and approve a machine).',
    close: 'Close the assistant',
    pills: {
      hecho: 'Done',
      aviso: 'Warning',
      info: 'Info',
      pendiente: 'Pending',
    },
    steps: {
      acceso: 'Console access and administrator',
      certificado: 'Ingest TLS certificate',
      token: 'First enrollment token',
      sensor: 'Check the sensor',
    },
    acceso: {
      howNow: 'How people sign in to this console right now:',
      effectiveRole: 'Effective role:',
      roles: { admin: 'Administrator', analyst: 'Analyst', viewer: 'Viewer' },
      usersProseA: 'For per-person accounts (who made each change and with which role) create an entry with ',
      usersProseB: ' from ',
      usersProseC: ', paste it into the “users” file of ',
      usersProseD: ' and restart the console. The password is stored only as a PBKDF2 hash.',
      infoProse: 'Accounts live in the console service, not in the engine; this step stays informational until a settings screen exists (SET-1).',
    },
    certificado: {
      pending: 'The engine has not answered the host enrollment state yet; as soon as it does, this step shows its real signal.',
      enabledA: 'The engine serves host enrollment: its ingest certificate is live. For a remote sensor to encrypt the connection, copy the server public certificate to it and start the sensor with ',
      enabledB: ' (the token step prepares the exact path). Details: docs/FLOTA-REMOTA.md, “Certificado TLS del servidor”.',
      disabledHint: 'Host enrollment is turned off in the engine.',
      disabledProse: 'This is the engine signal, copied verbatim. In the Windows installation the ingest certificate is created automatically; the manual path is documented in docs/FLOTA-REMOTA.md, “Certificado TLS del servidor”.',
      infoProse: 'The console does not serve files for download yet (REP-3): the certificate is copied from the server, and this step never claims more than what the engine reports.',
    },
    token: {
      pending: 'The engine has not answered the enrollment state; without an answer, this step offers no form.',
      done: (n, expires) =>
        `${n} enrollment token${n === 1 ? '' : 's'} in use${expires ? `; the next one expires ${expires}` : ''}. If you lose one's secret, create another: the engine only stores its fingerprint.`,
    },
    sensor: {
      done: (n) =>
        `${n} host${n === 1 ? '' : 's'} with an active enrolled sensor. Each machine's record (Hosts view) shows its risk, processes and live connections.`,
      avisoProse: 'The sensor started and is waiting for approval. Its events are queued on the host disk until you approve it; nothing is lost.',
      pendienteProse: 'Create the token in the previous step and run its commands on the host (or the full install.ps1 -WithSensor installation on this server). As soon as the sensor starts, the host shows up as pending here and in Hosts, and this step confirms it.',
      noEnroll: 'The engine has not answered host enrollment: this step cannot confirm anything without its answer.',
    },
    footer: {
      dontRepeat: "Don't offer it again when the console opens",
      close: 'Close',
      finish: 'Finish setup',
    },
  },

  // NOC wall (full-screen rotation). Slide titles, controls, honest outage
  // prose and the big stats of the three slides. Numbers that need a locale
  // arrive pre-formatted as strings so the dictionary stays language-only.
  noc: {
    ariaLabel: 'NOC mode',
    slides: {
      situacion: 'Situation',
      grafo: 'Investigation graph',
      cobertura: 'Coverage and hosts',
    },
    screens: 'Screens',
    prev: 'Previous screen',
    next: 'Next screen',
    pause: 'Pause rotation',
    resume: 'Resume rotation',
    exit: 'Exit',
    connectingTitle: 'Connecting to the engine',
    offlineTitle: 'Engine offline',
    offlineProse: 'NOC mode never shows stale or invented data; it recovers by itself as soon as the engine responds.',
    situation: {
      criticalOpen: 'Open criticals',
      criticalHint: (pending, acknowledged): string => `${pending} new · ${acknowledged} acknowledged`,
      eventsPerMin: 'Events per minute',
      eventsHint: (total): string => `${total} since startup`,
      alerts: 'Alerts',
      alertsHint: (n): string => `${n} in the console window`,
      riskHosts: 'Hosts at risk',
      riskHint: (host, score): string => `max ${host} · ${score}`,
      noRisk: 'no active risk',
      activityTitle: 'Sensor activity · last 4 minutes',
      activityAria: 'Sensor activity',
      severityTitle: 'Alerts by severity',
      severityAria: 'Alerts by severity',
    },
    graph: {
      title: (n): string => `Investigation graph · ${n} entities`,
      ariaLabel: 'Investigation graph',
      empty: 'The graph draws itself with the first alert or network connection received.',
      canvasAria: (nodes, edges): string => `Investigation graph: ${nodes} entities and ${edges} relationships`,
    },
    coverage: {
      matrixTitle: (n): string => `MITRE ATT&CK coverage · ${n} of 14 tactics with rules`,
      matrixAria: 'MITRE ATT&CK coverage',
      hostsTitle: 'Hosts per tactic',
      hostsAria: 'Hosts per tactic',
      hostsEmpty: 'No tactics observed in the window.',
      rulesTitle: 'Most active rules',
      rulesAria: 'Most active rules',
      rulesEmpty: 'No detections in the window.',
      riskTitle: 'Highest-risk hosts',
      riskAria: 'Highest-risk hosts',
      riskEmpty: 'No host is accumulating risk right now.',
      riskSeen: (alerts, seen): string => `${alerts} alerts · seen ${seen}`,
      destTitle: 'Network destinations',
      destEmpty: 'No network connections in the buffer.',
    },
  },

  // Critical-alert notifier (header bell). Preference prose, switches and
  // the phrases the browser toast uses; the lib only concatenates engine
  // data (host, user, summary, rule names) — wording lives here.
  notify: {
    title: 'Critical alert notifications',
    bellOn: 'Critical alert notifications on',
    bellOff: 'Critical alert notifications off',
    popoverLabel: 'Notification preferences',
    prose: 'Only for new, still-open critical alerts, while this tab stays open. The preference is saved in this browser.',
    browserToggle: 'Browser notification',
    browserToggleAria: 'Browser notification for critical alerts',
    soundToggle: 'Sound',
    soundToggleAria: 'Sound for critical alerts',
    denied: 'The browser blocked notifications for this site: allow them from the padlock icon in the address bar.',
    unsupported: 'This browser does not support notifications; sound still works.',
    storageError: 'The preference could not be saved in this browser; it lasts until reload.',
    testSound: 'Test sound',
    toast: {
      one: (rule): string => `Critical alert: ${rule}`,
      many: (n): string => `${n} new critical alerts`,
      moreHosts: (n): string => `and ${n} more ${n === 1 ? 'host' : 'hosts'}`,
    },
  },
}
