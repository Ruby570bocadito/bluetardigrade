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
}

/** The full shape every language must implement (EN is typed with this). */
export type Dict = typeof dictEs
