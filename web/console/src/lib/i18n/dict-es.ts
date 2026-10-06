// Spanish dictionary — the source of truth for every console string the
// i18n layer owns (IDEA-10). The copy here is byte-identical to what the
// console shipped before i18n: the browser battery pins several of these
// strings (`Puesta en marcha`, `Comandos de la consola`, `Atajos de
// teclado`, `Buscar comandos`), so "extract" means "copy exactly", never
// "rephrase". The English twin (dict-en.ts) is typed as Dict, so a missing
// or extra key fails compilation; the runtime test re-checks it.
//
// Out of scope on purpose: anything the engine says (rule names, hints,
// `enroll.hint`, report kinds). Engine data is never translated.

import type { ConsoleView } from '@/components/console/dashboard'

export const dictEs = {
  // View titles (the h1 the shell shows per view).
  views: {
    panel: { title: 'Panel de operaciones' },
    estado: { title: 'Estado de la plataforma' },
    flujo: { title: 'Flujo en vivo' },
    alertas: { title: 'Cola de alertas' },
    incidentes: { title: 'Incidentes' },
    equipos: { title: 'Equipos' },
    directorio: { title: 'Directorio activo' },
    informes: { title: 'Informes' },
    probador: { title: 'Probador de reglas' },
    ruido: { title: 'Informe de ruido' },
    simulacion: { title: 'Validación de detecciones' },
    reglas: { title: 'Reglas de detección' },
    cadenas: { title: 'Cadenas de kill chain' },
    inteligencia: { title: 'Inteligencia de amenazas' },
    supresiones: { title: 'Supresiones del operador' },
    respuesta: { title: 'Respuesta activa' },
    analista: { title: 'Analista IA' },
  },

  // Navigation destinations: label/group/description feed the sidebar, the
  // mobile nav, the command palette and the help sheet; keywords feed the
  // palette search only.
  nav: {
    panel: {
      label: 'Panel',
      group: 'Operación',
      description: 'Triaje pendiente, actividad y salud del motor',
      keywords: 'dashboard inicio métricas riesgo',
    },
    estado: {
      label: 'Estado',
      group: 'Operación',
      description: 'Motor, ingesta, colas, almacén y entrega externa en un vistazo',
      keywords: 'salud health plataforma estado motor ingesta cola almacen version sink siem',
    },
    flujo: {
      label: 'Flujo en vivo',
      group: 'Operación',
      description: 'Buscar telemetría y examinar eventos',
      keywords: 'eventos sensor procesos live feed',
    },
    alertas: {
      label: 'Alertas',
      group: 'Operación',
      description: 'Investigar, reconocer y cerrar detecciones',
      keywords: 'histórico historial triage triaje cola evidencia',
    },
    incidentes: {
      label: 'Incidentes',
      group: 'Operación',
      description: 'Casos que agrupan alertas, con estado, responsable y línea de tiempo',
      keywords: 'casos case incident investigacion',
    },
    equipos: {
      label: 'Equipos',
      group: 'Operación',
      description: 'Ficha de cada equipo: riesgo, alertas, procesos y conexiones',
      keywords: 'hosts host maquinas endpoints ficha',
    },
    informes: {
      label: 'Informes',
      group: 'Operación',
      description: 'Catálogo de informes del motor con descarga CSV/JSON y vista imprimible',
      keywords: 'reports informe resumen ejecutivo cobertura flota actividad csv json imprimir pdf',
    },
    reglas: {
      label: 'Reglas',
      group: 'Detección',
      description: 'Catálogo de reglas y condiciones cargadas',
      keywords: 'rules yaml mitre detecciones',
    },
    cadenas: {
      label: 'Cadenas',
      group: 'Detección',
      description: 'Secuencias y etapas de correlación',
      keywords: 'kill chain sequences correlador',
    },
    inteligencia: {
      label: 'Inteligencia',
      group: 'Detección',
      description: 'Listas de indicadores locales y línea base de procesos por equipo',
      keywords: 'intel ioc indicadores listas hash dominio ip baseline nuevo proceso amenazas',
    },
    supresiones: {
      label: 'Supresiones',
      group: 'Detección',
      description: 'Excepciones del operador y expiraciones',
      keywords: 'allowlist ruido falsos positivos',
    },
    probador: {
      label: 'Probador',
      group: 'Detección',
      description: 'Comprobar qué detecta un evento, sin generar alertas',
      keywords: 'test tester probar evento simular',
    },
    ruido: {
      label: 'Ruido',
      group: 'Detección',
      description: 'Procesos, dominios y detectores que más generan eventos o alertas',
      keywords: 'noise ruido procesos dns dominios top suprimir software conocido volumen',
    },
    simulacion: {
      label: 'Validación',
      group: 'Detección',
      description: 'Batería de validación de detecciones: escenarios, ejecución, historial y tendencia',
      keywords: 'simulacion scenarios validacion bateria laboratorio ataque matriz pass rate tendencia',
    },
    respuesta: {
      label: 'Respuesta activa',
      group: 'Respuesta',
      description: 'Consultar estado y auditoría de respuesta',
      keywords: 'respond c3 audit kill proceso',
    },
    directorio: {
      label: 'Directorio',
      group: 'Operación',
      description: 'Snapshot de Active Directory y postura del dominio: hallazgos, cobertura de sensores y objetos',
      keywords: 'ad active directory dominio ldap postura hallazgos cobertura sensores usuarios grupos equipos ad',
    },
    analista: {
      label: 'Analista IA',
      group: 'Asistencia',
      description: 'Asistencia para explicar e investigar alertas',
      keywords: 'ai chat modelo inteligencia',
    },
  },

  // Standalone palette commands (the navigation ones come from nav above).
  commands: {
    acciones: { group: 'Acciones' },
    refresh: {
      label: 'Actualizar datos del motor',
      description: 'Volver a consultar el estado y los búferes actuales',
      keywords: 'refresh recargar reconectar sincronizar recuperar',
    },
    noc: {
      label: 'Modo NOC',
      description: 'Pantalla completa rotativa para un monitor de sala',
      keywords: 'pantalla completa sala monitor wall pared',
    },
    onboarding: {
      label: 'Asistente de puesta en marcha',
      description: 'Acceso, certificado de ingesta, primer token de alta y comprobación del sensor',
      keywords: 'asistente wizard primera vez instalar puesta en marcha token alta certificado tls sensor administrador',
    },
    help: {
      label: 'Ayuda de teclado',
      description: 'Consultar los atajos de la consola',
      keywords: 'atajos shortcuts ayuda teclas',
    },
  },

  // Fixed chrome strings (sidebar, header, footer, badges' tooltips).
  chrome: {
    skipToContent: 'Ir al contenido',
    navLabel: 'Secciones de la consola',
    live: 'En vivo',
    connecting: 'Conectando',
    engineOffline: 'Motor offline',
    dataHonesty: 'Solo datos del pipeline real. La demo aparece etiquetada; sin eventos no se inventa telemetría.',
    shortcutsLine: 'Atajos:',
    onboardingOpen: 'Puesta en marcha',
    openCommands: 'Abrir comandos',
    commandsTitle: 'Comandos (Ctrl+K / ⌘K)',
    searchViewsCommands: 'Buscar vistas y comandos',
    demoBadge: 'La ventana recibida contiene datos de demostración',
    openNoc: 'Abrir modo NOC',
    nocTitle: 'Modo NOC: pantalla completa rotativa para un monitor de sala',
    utcTitle: 'Hora UTC',
    footerProduct: 'bluetardigrade · consola SOC',
    footerTagline: 'detección, investigación y respuesta para endpoints Windows',
    analystDown: 'servicio de analista sin conexión',
    selectionLabel: 'Selección de la cola',
    detectionTab: 'Detección',
  },

  // Counted tooltips and composed lines (functions so each language handles
  // its own plural forms).
  badges: {
    openAlerts: (n: number, critical: boolean): string =>
      `${n} alertas sin cerrar en la ventana${critical ? ', con críticas' : ''}`,
    silentHosts: (n: number): string => `${n} equipos sin señal de su sensor`,
    openIncidents: (n: number): string => `${n} incidentes sin cerrar`,
    atajo: (hint: string): string => `Atajo: ${hint}`,
    webhookOk: (sent: number): string => `Webhook: ${sent} alertas entregadas al conector externo`,
    webhookBad: (failed: number, dropped: number, sent: number): string =>
      `Webhook con problemas: ${failed} fallidas, ${dropped} descartadas, ${sent} entregadas`,
    webhookErr: (n: number): string => `${n} err`,
    webhookDropped: (n: number): string => `${n} desc`,
  },

  palette: {
    title: 'Comandos de la consola',
    close: 'Cerrar comandos',
    searchLabel: 'Buscar comandos',
    placeholder: 'Buscar una vista o acción…',
    listLabel: 'Comandos disponibles',
    available: (n: number): string => `${n} comandos disponibles`,
    refreshing: 'Actualización en curso',
    empty: 'Sin comandos para esta búsqueda. Prueba con «alertas», «reglas» o «actualizar».',
    hintLine: '↑ ↓ elegir · Enter ejecutar · Esc cerrar',
  },

  shortcuts: {
    title: 'Atajos de teclado',
    close: 'Cerrar la hoja de atajos',
    commandsHeading: 'Comandos',
    searchViews: 'Buscar vistas y acciones',
    thisSheet: 'Esta hoja',
    toggleRow: 'Abrir o cerrar',
    closeRow: 'Cerrar',
    prose: 'Los atajos de navegación se ignoran mientras escribes, durante la composición de texto y dentro de menús o ventanas abiertas.',
  },

  theme: {
    next: {
      system: 'Cambiar a seguir el sistema',
      light: 'Cambiar a tema claro',
      dark: 'Cambiar a tema oscuro',
    },
  },

  // The toggle always advertises the switch in the language the operator is
  // reading now, so both directions live in both dictionaries.
  lang: {
    toEn: 'Cambiar la consola a inglés',
    toEs: 'Cambiar la consola a español',
  },

  // First-run assistant (IDEA-11). Prose that wraps <code> spans is split
  // into fragments (…A/b/c) so the code stays out of the dictionary.
  onboarding: {
    title: 'Puesta en marcha',
    desc: 'Lo que una instalación nueva necesita, en cuatro pasos, con el estado que declara el motor. Nada se ejecuta en ningún equipo: el asistente solo lee el motor y usa las dos acciones de alta que ya ofrecía Equipos (crear un token y aprobar una máquina).',
    close: 'Cerrar el asistente',
    pills: {
      hecho: 'Hecho',
      aviso: 'Atención',
      info: 'Información',
      pendiente: 'Pendiente',
    },
    steps: {
      acceso: 'Acceso a la consola y administrador',
      certificado: 'Certificado TLS de ingesta',
      token: 'Primer token de alta',
      sensor: 'Comprobar el sensor',
    },
    acceso: {
      howNow: 'Cómo entra quien usa esta consola ahora:',
      effectiveRole: 'Rol efectivo:',
      roles: { admin: 'Administrador', analyst: 'Analista', viewer: 'Lector' },
      usersProseA: 'Para cuentas por persona (quién hizo cada cambio y con qué rol) crea una entrada con ',
      usersProseB: ' desde ',
      usersProseC: ', pégala en el fichero «users» de ',
      usersProseD: ' y rearranca la consola. La contraseña solo se guarda como hash PBKDF2.',
      infoProse: 'Las cuentas viven en el servicio de la consola, no en el motor; este paso queda como información hasta que exista una pantalla de ajustes (SET-1).',
    },
    certificado: {
      pending: 'El motor todavía no ha contestado al estado del alta de equipos; en cuanto responda, este paso muestra su señal real.',
      enabledA: 'El motor sirve el alta de equipos: su certificado de ingesta está en marcha. Para que un sensor remoto cifre la conexión, cópiale el certificado público del servidor y arranca el sensor con ',
      enabledB: ' (la ruta exacta la prepara el paso del token). Detalle: docs/FLOTA-REMOTA.md, «Certificado TLS del servidor».',
      disabledHint: 'El alta de equipos está apagada en el motor.',
      disabledProse: 'Es la señal del propio motor, copiada tal cual. En la instalación de Windows el certificado de ingesta se crea solo; a mano está guiado en docs/FLOTA-REMOTA.md, «Certificado TLS del servidor».',
      infoProse: 'La consola todavía no sirve ficheros para descargar (REP-3): el certificado se copia desde el servidor, y aquí no se declara hecho por encima de lo que el motor dice.',
    },
    token: {
      pending: 'El motor no ha respondido al estado del alta; sin respuesta, este paso no ofrece el formulario.',
      done: (n: number, expires: string | null): string =>
        `Hay ${n} token${n === 1 ? '' : 's'} de alta en uso${expires ? `; el más próximo caduca ${expires}` : ''}. Si pierdes el secreto de uno, crea otro: el motor solo guarda su huella.`,
    },
    sensor: {
      done: (n: number): string =>
        `${n} equipo${n === 1 ? '' : 's'} con sensor activo en el alta. La ficha de cada máquina (vista Equipos) muestra su riesgo, procesos y conexiones en vivo.`,
      avisoProse: 'El sensor arrancó y espera aprobación. Sus eventos están en el disco del equipo hasta que lo apruebes; nada se pierde.',
      pendienteProse: 'Crea el token en el paso anterior y ejecuta sus comandos en el equipo (o la instalación completa con install.ps1 -WithSensor en este servidor). En cuanto el sensor arranque, el equipo aparece como pendiente aquí y en Equipos, y este paso lo confirma.',
      noEnroll: 'El motor no ha respondido al alta de equipos: este paso no puede confirmar nada sin su respuesta.',
    },
    footer: {
      dontRepeat: 'No volver a proponerlo al abrir la consola',
      close: 'Cerrar',
      finish: 'Terminar la puesta en marcha',
    },
  },

  // NOC wall (full-screen rotation). Slide titles, controls, honest outage
  // prose and the big stats of the three slides. Numbers that need a locale
  // arrive pre-formatted as strings so the dictionary stays language-only.
  noc: {
    ariaLabel: 'Modo NOC',
    slides: {
      situacion: 'Situación',
      grafo: 'Grafo de investigación',
      cobertura: 'Cobertura y equipos',
    },
    screens: 'Pantallas',
    prev: 'Pantalla anterior',
    next: 'Pantalla siguiente',
    pause: 'Pausar rotación',
    resume: 'Reanudar rotación',
    exit: 'Salir',
    connectingTitle: 'Conectando con el motor',
    offlineTitle: 'Motor sin conexión',
    offlineProse: 'El modo NOC no muestra datos antiguos ni inventados; se recupera solo cuando el motor responda.',
    situation: {
      criticalOpen: 'Críticas sin cerrar',
      criticalHint: (pending: number, acknowledged: number): string => `${pending} nuevas · ${acknowledged} reconocidas`,
      eventsPerMin: 'Eventos por minuto',
      eventsHint: (total: string): string => `${total} desde el arranque`,
      alerts: 'Alertas',
      alertsHint: (n: number): string => `${n} en la ventana de la consola`,
      riskHosts: 'Equipos en riesgo',
      riskHint: (host: string, score: string): string => `máx ${host} · ${score}`,
      noRisk: 'sin riesgo activo',
      activityTitle: 'Actividad del sensor · últimos 4 minutos',
      activityAria: 'Actividad del sensor',
      severityTitle: 'Alertas por severidad',
      severityAria: 'Alertas por severidad',
    },
    graph: {
      title: (n: number): string => `Grafo de investigación · ${n} entidades`,
      ariaLabel: 'Grafo de investigación',
      empty: 'El grafo se dibuja con la primera alerta o conexión de red recibida.',
      canvasAria: (nodes: number, edges: number): string => `Grafo de investigación: ${nodes} entidades y ${edges} relaciones`,
    },
    coverage: {
      matrixTitle: (n: number): string => `Cobertura MITRE ATT&CK · ${n} de 14 tácticas con reglas`,
      matrixAria: 'Cobertura MITRE ATT&CK',
      hostsTitle: 'Equipos por táctica',
      hostsAria: 'Equipos por táctica',
      hostsEmpty: 'Sin tácticas observadas en la ventana.',
      rulesTitle: 'Reglas más activas',
      rulesAria: 'Reglas más activas',
      rulesEmpty: 'Sin detecciones en la ventana.',
      riskTitle: 'Equipos con más riesgo',
      riskAria: 'Equipos con más riesgo',
      riskEmpty: 'Ningún equipo acumula riesgo ahora mismo.',
      riskSeen: (alerts: number, seen: string): string => `${alerts} alertas · visto ${seen}`,
      destTitle: 'Destinos de red',
      destEmpty: 'Sin conexiones de red en el búfer.',
    },
  },

  // Alert triage queue (full view + compact dashboard widget). Everything
  // the engine attached to an alert (rule names, summaries, hosts, tags,
  // enrichment keys) is data and stays untranslated; this section is the
  // console chrome around it. The `by: 'consola'` value posted with a
  // triage decision is audit protocol data, not UI copy: it stays literal.
  alerts: {
    sectionAria: 'Alertas de detección',
    recentTitle: 'Alertas recientes',
    queueTitle: 'Cola de alertas',
    hintHistory: 'búsqueda en el motor',
    hintLive: (n: number): string => `de ${n} recibidas en vivo`,
    searchPlaceholder: 'buscar regla, host, usuario...',
    searchAria: 'Buscar en alertas',
    sevFilterAria: 'Filtrar por severidad',
    sevPlaceholder: 'Severidad',
    sevOptions: {
      all: 'todas',
      critical: 'crítica',
      high: 'alta',
      medium: 'media',
      low: 'baja',
      info: 'info',
    },
    // Severity names for the strip of this view. Views not swept yet keep
    // the shared SEVERITY_LABEL until their own round.
    sevLabels: {
      critical: 'Crítica',
      high: 'Alta',
      medium: 'Media',
      low: 'Baja',
      info: 'Info',
    },
    stateFilterAria: 'Filtrar por estado',
    stateOptions: {
      all: 'Todos los estados',
      open: 'Sin cerrar',
      new: 'Nuevas',
      acknowledged: 'Reconocidas',
      closed: 'Cerradas',
    },
    offlineTitle: 'Alertas no disponibles',
    offlineHintCompact: 'Recupera la conexión con el motor para ver las detecciones.',
    offlineHintFull: 'Recupera la conexión con el motor para consultar alertas.',
    emptyTitle: 'Sin alertas todavía',
    emptyHintCompact: 'Las detecciones aparecen en cuanto una regla evalúa telemetría sospechosa',
    emptyHintFull:
      'Las detecciones aparecen en cuanto una regla evalúa telemetría sospechosa. Verifica que el motor esté ingestando eventos de un sensor.',
    notifyIconAria: 'Notifica a canales externos',
    notifyChip: 'notifica a canales externos',
    scopeGroupAria: 'Origen de alertas',
    scopeLive: 'En vivo',
    scopeHistory: 'Histórico',
    pagesAria: 'Páginas del histórico',
    page: (n: number): string => `Página ${n}`,
    previous: 'Anterior',
    next: 'Siguiente',
    keepSearching: 'Seguir buscando',
    refreshHistory: 'Actualizar histórico',
    liveWindowHint: (n: number): string =>
      `Últimas ${n} recibidas por la consola; usa el histórico para buscar más atrás.`,
    historySourceSqlite: 'Histórico SQLite, sujeto a la retención configurada.',
    historySourceMemory: 'Solo memoria: últimas 256 alertas del motor. Activa -store para conservar el histórico.',
    historyPaging: '25 por página, más recientes por orden de recepción. Actualiza para incluir nuevas llegadas.',
    historyScanLimited: 'Se alcanzó el límite de lectura de esta consulta; continúa con «Seguir buscando».',
    linkedProseA: 'La alerta enlazada (',
    linkedProseB:
      ') no está en esta cola: el anillo en vivo guarda solo las últimas alertas y el histórico pagina por bloques. Usa la búsqueda o la paginación (el enlace resuelve en cuanto la alerta aparezca en la página cargada).',
    noResultsTitle: 'Sin resultados',
    noResultsHintScan: 'Continúa la búsqueda: todavía quedan registros por examinar.',
    noResultsHintLens: 'Ninguna alerta coincide con la búsqueda o el filtro actual',
    clearFilters: 'Limpiar filtros',
    tableCaption: 'Cola de alertas del motor: severidad, regla, equipo y hora. Selecciona una fila para ver el detalle.',
    selectAllAria: 'Seleccionar todas las alertas visibles',
    thSev: 'Sev',
    thAlert: 'Alerta',
    thHostUser: 'Equipo / Usuario',
    thTechnique: 'Técnica',
    thTime: 'Hora',
    thDetail: 'Detalle',
    selectRowAria: (rule: string, time: string): string => `Seleccionar ${rule} (${time})`,
    nd: 'n/d',
    showingPage: (n: number): string => `Mostrando ${n} alertas de esta página; no es el total del histórico.`,
    showingLive: (n: number, total: number): string => `Mostrando ${n} de ${total} alertas recibidas en vivo.`,
    detailAria: 'Detalle de la alerta seleccionada',
    stripAria: 'Alertas por severidad en la ventana en vivo',
    stripTitleOn: 'Filtrar la cola por esta severidad',
    stripTitleOff: 'Quitar el filtro de severidad',
    closeDetailAria: 'Cerrar detalle',
    ruleMessage: 'Mensaje de la regla',
    labels: {
      host: 'Equipo',
      user: 'Usuario',
      source: 'Fuente declarada',
      eventType: 'Tipo de evento',
      eventId: 'ID de evento',
      ruleId: 'ID de regla',
      matchedOn: 'Campos coincidentes',
    },
    sourceNotDeclared: 'no declarada',
    tagsHeading: 'Etiquetas',
    actionsHeading: 'Acciones declaradas por la regla',
    flowHeading: 'Flujo observado',
    attributesHeading: 'Observaciones declaradas por la fuente',
    attributesProse: 'Metadatos recibidos; no acreditan por sí solos autenticidad ni compromiso.',
    enrichmentHeading: 'Enriquecimiento',
    analyzeWithAi: 'Analizar con IA',
    graphTitle: 'Grafo de la alerta',
    graphAria: (rule: string, n: number): string => `Grafo de la alerta ${rule}: ${n} entidades relacionadas`,
    chipAcknowledged: 'reconocida',
    chipClosed: 'cerrada',
    lifecycleHeading: 'Ciclo de vida',
    noEngineId: 'sin id del motor',
    notePlaceholder: 'nota de triaje (opcional): qué se vio, qué se hizo...',
    noteAria: 'Nota de triaje',
    noIdProse: 'Este alerta no lleva id del motor (motor anterior a r6): el triaje requiere reiniciar el motor actualizado.',
    acknowledge: 'Reconocer',
    close: 'Cerrar',
    reopen: 'Reabrir',
    noDecisions: 'sin decisiones registradas',
    arrival: (sev: string, rule: string, host: string): string => `Nueva alerta ${sev}: ${rule} en ${host}`,
    filterSev: (sev: string): string => `severidad ${sev}`,
    filterState: (state: string): string => `estado ${state}`,
    filterQuery: (q: string): string => `búsqueda «${q}»`,
  },

  // Critical-alert notifier (header bell). Preference prose, switches and
  // the phrases the browser toast uses; the lib only concatenates engine
  // data (host, user, summary, rule names) — wording lives here.
  notify: {
    title: 'Avisos de alertas críticas',
    bellOn: 'Avisos de alertas críticas activados',
    bellOff: 'Avisos de alertas críticas desactivados',
    popoverLabel: 'Preferencias de avisos',
    prose: 'Solo para alertas críticas nuevas y sin cerrar, mientras esta pestaña esté abierta. La preferencia se guarda en este navegador.',
    browserToggle: 'Notificación del navegador',
    browserToggleAria: 'Notificación del navegador para alertas críticas',
    soundToggle: 'Sonido',
    soundToggleAria: 'Sonido para alertas críticas',
    denied: 'El navegador bloqueó las notificaciones para este sitio: permítelas en el icono del candado de la barra de direcciones.',
    unsupported: 'Este navegador no admite notificaciones; el sonido sí funciona.',
    storageError: 'No se pudo guardar la preferencia en este navegador; dura hasta recargar.',
    testSound: 'Probar sonido',
    toast: {
      one: (rule: string): string => `Alerta crítica: ${rule}`,
      many: (n: number): string => `${n} alertas críticas nuevas`,
      moreHosts: (n: number): string => `y ${n} ${n === 1 ? 'equipo' : 'equipos'} más`,
    },
  },

  // Incident cases (view Incidentes): the case list, the form, the case
  // detail (fields, exports, affected hosts, case alerts, graph, timeline).
  // Everything the engine stores in a case (title, summary, owner, notes,
  // timeline entries) is data and stays untranslated; this is the console
  // chrome around it.
  incidents: {
    sectionAria: 'Incidentes',
    unavailableTitle: 'Este motor no ofrece incidentes',
    unavailableHint: 'Actualiza la instalación (sf-update): los incidentes llegan con la versión del motor que incluye /api/incidents.',
    tiles: {
      open: 'Abiertos',
      openHint: 'sin asignar trabajo todavía',
      investigating: 'Investigando',
      investigatingHint: 'con analista trabajando',
      contained: 'Contenidos',
      containedHint: 'amenaza aislada, sin cerrar',
      closed: 'Cerrados',
      closedHintPersistent: 'guardados en el motor',
      closedHintMemory: 'solo en memoria del motor',
    },
    memoryBanner: 'El motor guarda los incidentes solo en memoria: se perderán al reiniciarlo. Arráncalo con -incidents para conservarlos.',
    casesTitle: 'Casos',
    newButton: 'Nuevo incidente',
    filterAria: 'Filtrar incidentes',
    filters: {
      active: 'Activos',
      all: 'Todos',
      closed: 'Cerrados',
    },
    emptyAllTitle: 'Ningún incidente todavía',
    emptyFilteredTitle: 'Ninguno con este filtro',
    emptyHint: 'Crea uno aquí o selecciona alertas en la cola y usa «Añadir a incidente».',
    caseMeta: (alerts: number, hosts: number, owner: string): string =>
      `${alerts} alertas · ${hosts} equipos${owner ? ` · ${owner}` : ''}`,
    pickTitle: 'Selecciona un incidente',
    pickHint: 'Verás sus alertas, los equipos afectados, el grafo de entidades y la línea de tiempo.',
    // Status names for this view (chip and select). Views not swept yet keep
    // the shared INCIDENT_STATUS_LABEL until their own round.
    statusLabels: {
      open: 'Abierto',
      investigating: 'Investigando',
      contained: 'Contenido',
      closed: 'Cerrado',
    },
    sevOptions: {
      critical: 'Crítica',
      high: 'Alta',
      medium: 'Media',
      low: 'Baja',
      info: 'Info',
    },
    form: {
      titleLabel: 'Título',
      severityLabel: 'Severidad',
      summaryLabel: 'Resumen (opcional)',
      cancel: 'Cancelar',
      creating: 'Creando…',
      submit: 'Crear incidente',
    },
    detailAria: (title: string): string => `Incidente ${title}`,
    exportAria: 'Exportar informe del incidente',
    analyze: 'Analizar con IA',
    analyzeTitle: 'El analista IA estudia el caso completo: agrupa las alertas por equipo y ventana, adjunta el bundle forense de la alerta más grave y cita la evidencia',
    reportMd: 'Informe .md',
    reportMdTitle: 'Descargar el informe en Markdown (para un ticket o una wiki)',
    reportPrint: 'Informe imprimible',
    reportPrintTitle: 'Descargar el informe como página imprimible, con el grafo (ábrela y usa Imprimir para obtener un PDF)',
    reportEngine: 'Informe del motor',
    reportEngineTitle: 'Abrir el informe de incidente del motor (REP-1): descarga CSV/JSON y vista imprimible',
    openedUpdated: (created: string, updated: string, closed: string | null): string =>
      `Abierto ${created} · actualizado ${updated}${closed ? ` · cerrado ${closed}` : ''}`,
    statusField: 'Estado',
    severityField: 'Severidad',
    ownerField: 'Responsable',
    ownerPlaceholder: 'sin asignar',
    summaryField: 'Resumen',
    summaryPlaceholder: 'Qué ha pasado, alcance y estado de la contención',
    hostsHeading: 'Equipos afectados',
    hostsEmpty: 'Sin equipos todavía: se añaden con las alertas.',
    alertsHeading: (n: number): string => `Alertas del caso (${n})`,
    alertsEmpty: 'Sin alertas: selecciónalas en la cola y usa «Añadir a incidente».',
    alertsOutside: (n: number): string =>
      `${n} ${n === 1 ? 'alerta ya no está' : 'alertas ya no están'} en la ventana en vivo; búscalas en Alertas → Histórico.`,
    graphTitle: 'Grafo del incidente',
    graphAria: (n: number): string => `Grafo del incidente: ${n} entidades`,
    graphSelectHint: 'Abrir la ficha del equipo',
    timelineHeading: 'Línea de tiempo',
    noteLabel: 'Nota del analista',
    notePlaceholder: 'Añade una nota: qué viste, qué hiciste, siguiente paso',
    addNote: 'Añadir nota',
  },

  // Response plan of a case (IDEA-3): template picker, checklist, evidence
  // and chronology. The three product templates are console content, so
  // their names, descriptions, steps (keyed by the template item id) and
  // evidence hints live here too; a runtime test keeps the ids bound to
  // lib/incident-playbook.ts. The note the template application writes into
  // the engine timeline is composed in the language of the moment (like the
  // arrival announcements). The exported .md/.html case report keeps its
  // own language decision (registered in the roadmap).
  playbook: {
    saveFailed: 'No se pudo guardar el plan.',
    readFailed: 'No se pudo leer el plan guardado en este navegador.',
    addEvidenceFailed: 'No se pudo añadir la evidencia.',
    evidenceRemoveFailed: 'No se pudo quitar la evidencia.',
    addMilestoneFailed: 'No se pudo añadir el hito.',
    milestoneRemoveFailed: 'No se pudo quitar el hito.',
    invalidDate: 'Hito: fecha no válida.',
    sectionAria: 'Plan de respuesta',
    sectionAriaName: (name: string): string => `Plan de respuesta: ${name}`,
    heading: 'Plan de respuesta',
    headingName: (name: string): string => `Plan de respuesta: ${name}`,
    intro: 'Aplica una plantilla para llevar la lista de comprobación, las evidencias y la cronología del caso. El plan vive en este navegador, no en el motor; al aplicarla queda una nota en la línea de tiempo del incidente.',
    stepsCount: (n: number): string => `${n} pasos`,
    apply: 'Aplicar',
    appliedNote: (name: string): string => `Plan de respuesta aplicado: ${name} (lista de comprobación en la consola).`,
    stepsDone: (done: number, total: number): string => `${done}/${total} pasos`,
    removePlan: 'Quitar el plan',
    removeConfirm: 'Confirmar: se borra de este navegador',
    progressAria: (done: number, total: number): string => `Progreso del plan: ${done} de ${total} pasos`,
    browserNote: 'El plan vive en este navegador (localStorage): no se envía al motor y no sigue al caso en otro equipo. Los botones de informe de la ficha lo incluyen al exportar.',
    evidenceHeading: (n: number): string => `Evidencias (${n})`,
    evidenceKindAria: 'Tipo de evidencia',
    evidenceLabelAria: 'Evidencia',
    evidencePlaceholder: 'qué es y de dónde sale',
    evidenceDetailPlaceholder: 'Detalle opcional: hash completo, cabeceras, contexto…',
    addEvidence: 'Añadir evidencia',
    evidenceEmpty: 'Sin evidencias registradas todavía.',
    removeEvidenceAria: (label: string): string => `Quitar la evidencia ${label}`,
    evidenceKinds: {
      file: 'Fichero o muestra',
      hash: 'Hash',
      url: 'URL o dominio',
      ip: 'IP o destino',
      account: 'Cuenta o identidad',
      note: 'Nota',
    },
    chronoHeading: (n: number): string => `Cronología del analista (${n})`,
    whenAria: 'Cuándo',
    whatAria: 'Qué pasó',
    whatPlaceholder: 'qué pasó en ese momento',
    addMilestone: 'Añadir hito',
    chronoEmpty: 'Sin hitos todavía: registra con hora lo que reconstruyas del caso.',
    removeMilestoneAria: (text: string): string => `Quitar el hito ${text}`,
    removeShort: 'Quitar',
    templates: {
      ransomware: {
        name: 'Ransomware',
        description: 'Cifrado en curso o consumado: contener rápido, preservar evidencia y decidir el restauro con datos.',
        evidenceHints: ['Nota de rescate', 'Muestra cifrada', 'Hash del binario', 'Destino de exfiltración', 'Cuenta usada'],
        items: {
          alcance: 'Delimita el alcance: equipos con cifrado, notas de rescate o escritura masiva de ficheros renombrados.',
          aislar: 'Aísla de la red los equipos afectados y corta los recursos compartidos mientras el cifrado siga activo.',
          evidencia: 'Preserva evidencia antes de apagar nada: captura memoria y el bundle forense de la alerta más grave del caso.',
          familia: 'Identifica la familia (nota, extensión, muestra) sin ejecutar nada del entorno del atacante.',
          'acceso-inicial': 'Remonta el acceso inicial: phishing, credenciales robadas o servicio expuesto; anota la primera alerta.',
          preparacion: 'Busca preparación previa: borrado de copias sombra, copias de seguridad eliminadas o servicios detenidos.',
          lateral: 'Rastrea el movimiento lateral: RDP, SMB y herramientas de administración remota con cuentas implicadas.',
          exfil: 'Comprueba exfiltración previa (picos de subida, nube) antes de decidir restaurar sin pagar.',
          persistencia: 'Revisa persistencia en equipos aún no cifrados: tareas, servicios, Run keys y cuentas nuevas.',
          restauro: 'Restaura solo con copias verificadas como limpias y rota las credenciales de las cuentas implicadas.',
          cierre: 'Registra los hitos en la cronología y notifica según el procedimiento (dirección, seguros, legal).',
        },
      },
      phishing: {
        name: 'Phishing',
        description: 'Correo malicioso recibido, abierto o con clic: del buzón al equipo y del clic a la credencial.',
        evidenceHints: ['Mensaje original (.eml)', 'URL maliciosa', 'Hash del adjunto', 'Dominio del remitente', 'Buzón afectado'],
        items: {
          mensaje: 'Consigue el mensaje original con cabeceras completas (.eml) sin reenviarlo entre buzones.',
          indicadores: 'Extrae indicadores: remitente, dominios, URLs y adjuntos; contrasta su reputación.',
          destinatarios: 'Busca a quién más llegó y quién lo abrió o hizo clic en la pasarela de correo.',
          adjunto: 'Si hay adjunto, calcula su hash y busca ese hash y su comportamiento en el histórico de alertas.',
          clics: 'Identifica los equipos de quienes clicaron y revisa sus alertas y eventos web/DNS.',
          credenciales: 'Si se introdujeron credenciales: revoca sesiones, restablece contraseñas y revisa el segundo factor.',
          ejecucion: 'En los equipos implicados, revisa procesos hijo, persistencia y tareas creadas tras el clic.',
          bloqueo: 'Bloquea remitente, dominio y URL en la pasarela; si una regla interna dio volumen, crea la supresión desde Ruido.',
          purga: 'Retira el mensaje de los buzones restantes si la pasarela permite la purga.',
          cierre: 'Cierra la cronología: quién clicó, qué se contuvo y el estado final de cada buzón.',
        },
      },
      'compromised-account': {
        name: 'Cuenta comprometida',
        description: 'Una identidad se usa fuera de su base: contener la cuenta, medir el alcance y buscar persistencia.',
        evidenceHints: ['IP de acceso', 'Dispositivo nuevo', 'Regla de buzón', 'Grupo modificado', 'Cuenta creada'],
        items: {
          contencion: 'Contén la cuenta: restablece la contraseña y revoca sesiones y tokens sin borrar la cuenta aún.',
          origenes: 'Identifica los orígenes de acceso: IPs, dispositivos y horas, comparados con la base habitual del usuario.',
          alcance: 'Determina qué era accesible con la cuenta: privilegios, grupos, buzones y recursos.',
          buzon: 'Revisa el buzón: reglas de reenvío, delegaciones y mensajes borrados.',
          privilegios: 'Busca cambios de privilegio hechos con la cuenta: grupos, políticas y servicios nuevos.',
          lateral: 'Busca movimiento lateral con la cuenta: inicios en otros equipos y uso de SMB, WMI o PsExec.',
          persistencia: 'Revisa persistencia creada con la cuenta: cuentas nuevas, tareas programadas y claves Run.',
          secretos: 'Si la cuenta es de servicio o administrativa, rota los secretos que alcanzaba y revisa dónde inició sesión.',
          vigilancia: 'Vigila la cuenta tras la contención: guarda la búsqueda de sus indicadores en Alertas.',
          cierre: 'Documenta en la cronología cada acceso y acción con hora, y el estado final de la cuenta.',
        },
      },
    },
  },
}

/** The full shape every language must implement (EN is typed with this). */
export type Dict = typeof dictEs
