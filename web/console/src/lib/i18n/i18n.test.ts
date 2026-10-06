import { describe, expect, test } from 'bun:test'
import { DICTS, LANG_STORAGE_KEY, resolveLang, storedLang, type Lang } from './index'
import { dictEs } from './dict-es'
import { PLAYBOOK_TEMPLATES } from '../incident-playbook'

// Parity walk: every key of the Spanish source must exist in the English
// dictionary with the same kind (string vs function), functions keep the
// same arity (each language does its own pluralization inside) and no
// string is empty. Compilation already enforces this via `Dict`; the walk
// re-checks it at runtime so an accidental `as any` or a widened dict
// cannot slip through.

function walk(esPath: string[], esValue: unknown, enValue: unknown): void {
  if (typeof esValue === 'function') {
    expect(typeof enValue, `en path ${esPath.join('.')} should be a function`).toBe('function')
    expect((enValue as (...args: unknown[]) => unknown).length, `arity drift at en ${esPath.join('.')}`).toBe(
      (esValue as (...args: unknown[]) => unknown).length,
    )
    return
  }
  if (typeof esValue === 'string') {
    expect(typeof enValue, `en path ${esPath.join('.')} should be a string`).toBe('string')
    expect((enValue as string).length > 0, `empty string at en ${esPath.join('.')}`).toBe(true)
    return
  }
  expect(esValue && typeof esValue === 'object', `unexpected leaf at ${esPath.join('.')}`).toBe(true)
  expect(enValue && typeof enValue === 'object', `en path ${esPath.join('.')} should be an object`).toBe(true)
  const esKeys = Object.keys(esValue as object).sort()
  const enKeys = Object.keys(enValue as object).sort()
  expect(enKeys, `key drift at en ${esPath.join('.')}`).toEqual(esKeys)
  for (const key of esKeys) {
    walk(
      [...esPath, key],
      (esValue as Record<string, unknown>)[key],
      (enValue as Record<string, unknown>)[key],
    )
  }
}

describe('i18n dictionaries', () => {
  test('en implements the full es shape (keys, kinds, arity, non-empty)', () => {
    walk([], dictEs, DICTS.en)
  })

  test('both languages resolve for every Lang key', () => {
    for (const lang of ['es', 'en'] as const) expect(DICTS[lang]).toBeTypeOf('object')
  })

  test('battery-pinned Spanish strings stay byte-identical', () => {
    expect(dictEs.onboarding.title).toBe('Puesta en marcha')
    expect(dictEs.chrome.onboardingOpen).toBe('Puesta en marcha')
    expect(dictEs.palette.title).toBe('Comandos de la consola')
    expect(dictEs.palette.searchLabel).toBe('Buscar comandos')
    expect(dictEs.shortcuts.title).toBe('Atajos de teclado')
  })

  test('english copy is a real translation, not the spanish source', () => {
    expect(DICTS.en.onboarding.title).toBe('Set up')
    expect(DICTS.en.chrome.live).toBe('Live')
    expect(DICTS.en.views.alertas.title).toBe('Alert queue')
  })

  test('phase 2 sweep (noc + notify) keeps the spanish copy byte-identical', () => {
    expect(dictEs.noc.ariaLabel).toBe('Modo NOC')
    expect(dictEs.noc.slides.situacion).toBe('Situación')
    expect(dictEs.noc.slides.grafo).toBe('Grafo de investigación')
    expect(dictEs.noc.slides.cobertura).toBe('Cobertura y equipos')
    expect(dictEs.noc.exit).toBe('Salir')
    expect(dictEs.noc.offlineTitle).toBe('Motor sin conexión')
    expect(dictEs.noc.situation.criticalOpen).toBe('Críticas sin cerrar')
    expect(dictEs.noc.coverage.riskSeen(3, '10:05')).toBe('3 alertas · visto 10:05')
    expect(dictEs.notify.title).toBe('Avisos de alertas críticas')
    expect(dictEs.notify.testSound).toBe('Probar sonido')
    expect(dictEs.notify.toast.many(5)).toBe('5 alertas críticas nuevas')
  })

  test('phase 2 english copy is a real translation of noc and notify', () => {
    expect(DICTS.en.noc.ariaLabel).toBe('NOC mode')
    expect(DICTS.en.noc.slides.cobertura).toBe('Coverage and hosts')
    expect(DICTS.en.noc.situation.criticalHint(2, 1)).toBe('2 new · 1 acknowledged')
    expect(DICTS.en.noc.coverage.riskSeen(3, '10:05')).toBe('3 alerts · seen 10:05')
    expect(DICTS.en.notify.title).toBe('Critical alert notifications')
    expect(DICTS.en.notify.toast.one('r')).toBe('Critical alert: r')
    expect(DICTS.en.notify.toast.moreHosts(2)).toBe('and 2 more hosts')
  })

  test('phase 3 sweep (alerts queue) keeps the spanish copy byte-identical', () => {
    // Strings the browser battery pins as selectors — they must not move.
    expect(dictEs.alerts.searchAria).toBe('Buscar en alertas')
    expect(dictEs.alerts.acknowledge).toBe('Reconocer')
    expect(dictEs.alerts.close).toBe('Cerrar')
    expect(dictEs.alerts.previous).toBe('Anterior')
    expect(dictEs.alerts.next).toBe('Siguiente')
    expect(dictEs.alerts.scopeHistory).toBe('Histórico')
    // Anchas de la vista completa y del widget compacto.
    expect(dictEs.alerts.sectionAria).toBe('Alertas de detección')
    expect(dictEs.alerts.queueTitle).toBe('Cola de alertas')
    expect(dictEs.alerts.recentTitle).toBe('Alertas recientes')
    expect(dictEs.alerts.offlineTitle).toBe('Alertas no disponibles')
    expect(dictEs.alerts.emptyTitle).toBe('Sin alertas todavía')
    expect(dictEs.alerts.clearFilters).toBe('Limpiar filtros')
    expect(dictEs.alerts.reopen).toBe('Reabrir')
    expect(dictEs.alerts.tableCaption).toBe(
      'Cola de alertas del motor: severidad, regla, equipo y hora. Selecciona una fila para ver el detalle.',
    )
    expect(dictEs.alerts.hintLive(7)).toBe('de 7 recibidas en vivo')
    expect(dictEs.alerts.page(2)).toBe('Página 2')
    expect(dictEs.alerts.showingLive(3, 12)).toBe('Mostrando 3 de 12 alertas recibidas en vivo.')
    expect(dictEs.alerts.selectRowAria('Regla X', '10:05')).toBe('Seleccionar Regla X (10:05)')
    expect(dictEs.alerts.arrival('critical', 'R', 'H-1')).toBe('Nueva alerta critical: R en H-1')
    expect(dictEs.alerts.linkedProseA + 'id' + dictEs.alerts.linkedProseB).toBe(
      'La alerta enlazada (id) no está en esta cola: el anillo en vivo guarda solo las últimas alertas y el histórico pagina por bloques. Usa la búsqueda o la paginación (el enlace resuelve en cuanto la alerta aparezca en la página cargada).',
    )
  })

  test('phase 3 english copy is a real translation of the alerts queue', () => {
    expect(DICTS.en.alerts.queueTitle).toBe('Alert queue')
    expect(DICTS.en.alerts.searchAria).toBe('Search alerts')
    expect(DICTS.en.alerts.acknowledge).toBe('Acknowledge')
    expect(DICTS.en.alerts.stateOptions.acknowledged).toBe('Acknowledged')
    expect(DICTS.en.alerts.sevLabels.critical).toBe('Critical')
    expect(DICTS.en.alerts.hintLive(7)).toBe('of 7 received live')
    expect(DICTS.en.alerts.page(2)).toBe('Page 2')
    expect(DICTS.en.alerts.showingLive(3, 12)).toBe('Showing 3 of 12 alerts received live.')
    expect(DICTS.en.alerts.selectRowAria('Rule X', '10:05')).toBe('Select Rule X (10:05)')
    expect(DICTS.en.alerts.arrival('critical', 'R', 'H-1')).toBe('New critical alert: R on H-1')
    expect(DICTS.en.alerts.nd).toBe('n/a')
  })

  test('phase 4 sweep (incidents view) keeps the spanish copy byte-identical', () => {
    expect(dictEs.incidents.sectionAria).toBe('Incidentes')
    expect(dictEs.incidents.unavailableTitle).toBe('Este motor no ofrece incidentes')
    expect(dictEs.incidents.tiles.open).toBe('Abiertos')
    expect(dictEs.incidents.tiles.closedHintPersistent).toBe('guardados en el motor')
    expect(dictEs.incidents.casesTitle).toBe('Casos')
    expect(dictEs.incidents.newButton).toBe('Nuevo incidente')
    expect(dictEs.incidents.filters.active).toBe('Activos')
    expect(dictEs.incidents.emptyAllTitle).toBe('Ningún incidente todavía')
    expect(dictEs.incidents.pickTitle).toBe('Selecciona un incidente')
    expect(dictEs.incidents.statusLabels).toEqual({ open: 'Abierto', investigating: 'Investigando', contained: 'Contenido', closed: 'Cerrado' })
    expect(dictEs.incidents.sevOptions.critical).toBe('Crítica')
    expect(dictEs.incidents.form.submit).toBe('Crear incidente')
    expect(dictEs.incidents.exportAria).toBe('Exportar informe del incidente')
    expect(dictEs.incidents.analyze).toBe('Analizar con IA')
    expect(dictEs.incidents.reportPrint).toBe('Informe imprimible')
    expect(dictEs.incidents.hostsHeading).toBe('Equipos afectados')
    expect(dictEs.incidents.graphTitle).toBe('Grafo del incidente')
    expect(dictEs.incidents.timelineHeading).toBe('Línea de tiempo')
    expect(dictEs.incidents.addNote).toBe('Añadir nota')
    expect(dictEs.incidents.caseMeta(3, 2, 'ana')).toBe('3 alertas · 2 equipos · ana')
    expect(dictEs.incidents.caseMeta(3, 2, '')).toBe('3 alertas · 2 equipos')
    expect(dictEs.incidents.alertsHeading(5)).toBe('Alertas del caso (5)')
    expect(dictEs.incidents.alertsOutside(1)).toBe('1 alerta ya no está en la ventana en vivo; búscalas en Alertas → Histórico.')
    expect(dictEs.incidents.alertsOutside(4)).toBe('4 alertas ya no están en la ventana en vivo; búscalas en Alertas → Histórico.')
    expect(dictEs.incidents.graphAria(7)).toBe('Grafo del incidente: 7 entidades')
    expect(dictEs.incidents.openedUpdated('10:00', '10:05', '10:10')).toBe('Abierto 10:00 · actualizado 10:05 · cerrado 10:10')
    expect(dictEs.incidents.openedUpdated('10:00', '10:05', null)).toBe('Abierto 10:00 · actualizado 10:05')
  })

  test('phase 4 english copy is a real translation of the incidents view', () => {
    expect(DICTS.en.incidents.sectionAria).toBe('Incidents')
    expect(DICTS.en.incidents.unavailableTitle).toBe('This engine does not offer incidents')
    expect(DICTS.en.incidents.tiles.open).toBe('Open')
    expect(DICTS.en.incidents.casesTitle).toBe('Cases')
    expect(DICTS.en.incidents.newButton).toBe('New incident')
    expect(DICTS.en.incidents.statusLabels.contained).toBe('Contained')
    expect(DICTS.en.incidents.form.submit).toBe('Create incident')
    expect(DICTS.en.incidents.analyze).toBe('Analyze with AI')
    expect(DICTS.en.incidents.reportPrint).toBe('Printable report')
    expect(DICTS.en.incidents.hostsHeading).toBe('Affected hosts')
    expect(DICTS.en.incidents.ownerPlaceholder).toBe('unassigned')
    expect(DICTS.en.incidents.caseMeta(3, 2, 'ana')).toBe('3 alerts · 2 hosts · ana')
    expect(DICTS.en.incidents.caseMeta(3, 2, '')).toBe('3 alerts · 2 hosts')
    expect(DICTS.en.incidents.alertsHeading(5)).toBe('Case alerts (5)')
    expect(DICTS.en.incidents.alertsOutside(1)).toBe('1 alert is no longer in the live window; look for them in Alerts → History.')
    expect(DICTS.en.incidents.alertsOutside(4)).toBe('4 alerts are no longer in the live window; look for them in Alerts → History.')
    expect(DICTS.en.incidents.graphAria(7)).toBe('Incident graph: 7 entities')
    expect(DICTS.en.incidents.openedUpdated('10:00', '10:05', '10:10')).toBe('Opened 10:00 · updated 10:05 · closed 10:10')
    expect(DICTS.en.incidents.openedUpdated('10:00', '10:05', null)).toBe('Opened 10:00 · updated 10:05')
  })

  test('phase 4 sweep (playbook) keeps the spanish copy byte-identical', () => {
    expect(dictEs.playbook.sectionAria).toBe('Plan de respuesta')
    expect(dictEs.playbook.heading).toBe('Plan de respuesta')
    expect(dictEs.playbook.apply).toBe('Aplicar')
    expect(dictEs.playbook.removePlan).toBe('Quitar el plan')
    expect(dictEs.playbook.removeConfirm).toBe('Confirmar: se borra de este navegador')
    expect(dictEs.playbook.addEvidence).toBe('Añadir evidencia')
    expect(dictEs.playbook.addMilestone).toBe('Añadir hito')
    expect(dictEs.playbook.removeShort).toBe('Quitar')
    expect(dictEs.playbook.evidenceKinds.file).toBe('Fichero o muestra')
    expect(dictEs.playbook.evidenceKinds.account).toBe('Cuenta o identidad')
    expect(dictEs.playbook.stepsCount(11)).toBe('11 pasos')
    expect(dictEs.playbook.stepsDone(2, 11)).toBe('2/11 pasos')
    expect(dictEs.playbook.progressAria(2, 11)).toBe('Progreso del plan: 2 de 11 pasos')
    expect(dictEs.playbook.evidenceHeading(4)).toBe('Evidencias (4)')
    expect(dictEs.playbook.chronoHeading(0)).toBe('Cronología del analista (0)')
    expect(dictEs.playbook.removeEvidenceAria('nota')).toBe('Quitar la evidencia nota')
    expect(dictEs.playbook.removeMilestoneAria('hito')).toBe('Quitar el hito hito')
    expect(dictEs.playbook.sectionAriaName('Phishing')).toBe('Plan de respuesta: Phishing')
    expect(dictEs.playbook.appliedNote('Phishing')).toBe('Plan de respuesta aplicado: Phishing (lista de comprobación en la consola).')
  })

  test('phase 4 english copy is a real translation of the playbook', () => {
    expect(DICTS.en.playbook.sectionAria).toBe('Response plan')
    expect(DICTS.en.playbook.apply).toBe('Apply')
    expect(DICTS.en.playbook.removePlan).toBe('Remove the plan')
    expect(DICTS.en.playbook.addEvidence).toBe('Add evidence')
    expect(DICTS.en.playbook.addMilestone).toBe('Add milestone')
    expect(DICTS.en.playbook.evidenceKinds.file).toBe('File or sample')
    expect(DICTS.en.playbook.evidenceKinds.account).toBe('Account or identity')
    expect(DICTS.en.playbook.stepsDone(2, 11)).toBe('2/11 steps')
    expect(DICTS.en.playbook.progressAria(2, 11)).toBe('Plan progress: 2 of 11 steps')
    expect(DICTS.en.playbook.removeEvidenceAria('note')).toBe('Remove the evidence note')
    expect(DICTS.en.playbook.removeMilestoneAria('milestone')).toBe('Remove the milestone milestone')
    expect(DICTS.en.playbook.sectionAriaName('Phishing')).toBe('Response plan: Phishing')
    expect(DICTS.en.playbook.appliedNote('Phishing')).toBe('Response plan applied: Phishing (checklist in the console).')
  })

  test('playbook dict templates stay bound to the product templates (ids, texts, hints)', () => {
    for (const lang of ['es', 'en'] as const) {
      const dict = DICTS[lang].playbook.templates
      for (const t of PLAYBOOK_TEMPLATES) {
        const copy = dict[t.id]
        expect(Object.keys(copy.items).sort(), `${lang} item ids for ${t.id}`).toEqual(t.items.map((i) => i.id).sort())
        expect(copy.evidenceHints).toHaveLength(t.evidenceHints.length)
      }
    }
    // the Spanish copy of the templates is byte-identical to the product
    // templates the exported reports still carry (source of truth: dict-es)
    for (const t of PLAYBOOK_TEMPLATES) {
      const copy = dictEs.playbook.templates[t.id]
      expect(copy.name).toBe(t.name)
      expect(copy.description).toBe(t.description)
      expect(copy.evidenceHints).toEqual(t.evidenceHints)
      for (const item of t.items) expect(copy.items[item.id]).toBe(item.text)
    }
    // the English copy is a real translation, not the spanish source
    expect(DICTS.en.playbook.templates.ransomware.name).toBe('Ransomware')
    expect(DICTS.en.playbook.templates['compromised-account'].name).toBe('Compromised account')
    expect(DICTS.en.playbook.templates.ransomware.description).not.toBe(dictEs.playbook.templates.ransomware.description)
    expect(DICTS.en.playbook.templates.ransomware.items.alcance).not.toBe(dictEs.playbook.templates.ransomware.items.alcance)
  })

  test('phase 5 (settings + AD-6) keeps the spanish copy byte-identical', () => {
    expect(dictEs.settings.sectionAria).toBe('Ajustes de la consola')
    expect(dictEs.settings.noWriteApi).toBe('Todavía no hay API de escritura para esto: se declara al arrancar el motor o el servicio de la consola.')
    expect(dictEs.settings.general.heading).toBe('General')
    expect(dictEs.settings.general.langEs).toBe('Español')
    expect(dictEs.settings.ingesta.openHosts).toBe('Abrir Equipos')
    expect(dictEs.settings.ingesta.usableTokens(2)).toBe('2 tokens de alta usables')
    expect(dictEs.settings.ingesta.pendingHosts(1)).toBe('1 máquina espera aprobación')
    expect(dictEs.settings.integraciones.quiet).toBe('Sin actividad: conector no declarado o nada entregado todavía.')
    expect(dictEs.settings.cuentas.roles.viewer).toBe('Lector')
    expect(dictEs.settings.apariencia.themes.system).toBe('Seguir el sistema')
    // the AD-6 form chrome, the honest states and the write-only password
    expect(dictEs.settings.ad.heading).toBe('Active Directory')
    expect(dictEs.settings.ad.notArmed).toBe('El conector de Active Directory no está armado')
    expect(dictEs.settings.ad.probeOnly).toBe('Guardar requiere el conector armado: el botón de guardar está desactivado y la prueba es la única acción disponible.')
    expect(dictEs.settings.ad.passwordHint).toBe('Se escribe en su sobre de credenciales; nunca se muestra ni viaja de vuelta. Vacío = conservar la guardada.')
    expect(dictEs.settings.ad.probe).toBe('Probar conexión')
    expect(dictEs.settings.ad.save).toBe('Guardar cambios')
    expect(dictEs.settings.ad.dirtyChip).toBe('Cambios sin aplicar')
    expect(dictEs.settings.ad.dayNames).toEqual(['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'])
    expect(dictEs.settings.ad.probeKinds.user).toBe('Usuarios')
    expect(dictEs.settings.ad.probeRead(1)).toBe('1 leído')
    expect(dictEs.settings.ad.probeAtLeast(200)).toBe('al menos 200')
    expect(dictEs.settings.ad.probeTls('1.3', 'TLS_AES_128_GCM_SHA256')).toBe('TLS 1.3 · TLS_AES_128_GCM_SHA256')
    expect(dictEs.settings.ad.invalidFields(1)).toBe('Hay 1 campo numérico con un valor que no se puede aplicar: revísalos antes de enviar.')
  })

  test('phase 5 english copy is a real translation of the settings page', () => {
    expect(DICTS.en.settings.sectionAria).toBe('Console settings')
    expect(DICTS.en.settings.general.heading).toBe('General')
    expect(DICTS.en.settings.ingesta.openHosts).toBe('Open Hosts')
    expect(DICTS.en.settings.ingesta.usableTokens(2)).toBe('2 usable enrollment tokens')
    expect(DICTS.en.settings.ingesta.pendingHosts(1)).toBe('1 machine awaiting approval')
    expect(DICTS.en.settings.cuentas.roles.viewer).toBe('Viewer')
    expect(DICTS.en.settings.apariencia.themes.system).toBe('Follow the system')
    expect(DICTS.en.settings.ad.notArmed).toBe('The Active Directory connector is not armed')
    expect(DICTS.en.settings.ad.probe).toBe('Test connection')
    expect(DICTS.en.settings.ad.save).toBe('Save changes')
    expect(DICTS.en.settings.ad.dirtyChip).toBe('Unapplied changes')
    expect(DICTS.en.settings.ad.dayNames).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    expect(DICTS.en.settings.ad.probeKinds.ou).toBe('Organizational units')
    expect(DICTS.en.settings.ad.probeRead(1)).toBe('1 read')
    expect(DICTS.en.settings.ad.probeAtLeast(200)).toBe('at least 200')
    expect(DICTS.en.settings.ad.probeTls('1.3', 'TLS_AES_128_GCM_SHA256')).toBe('TLS 1.3 · TLS_AES_128_GCM_SHA256')
    expect(DICTS.en.settings.ad.invalidFields(1)).toBe('1 numeric field carries a value that cannot be applied: review it before sending.')
    expect(DICTS.en.settings.ad.invalidFields(2)).toBe('2 numeric fields carry a value that cannot be applied: review them before sending.')
  })
})

describe('language resolution', () => {
  test('a validated stored choice always wins', () => {
    expect(resolveLang('en', 'es-ES')).toBe('en')
    expect(resolveLang('es', 'en-US')).toBe('es')
  })

  test('without storage the browser preference decides', () => {
    expect(resolveLang(null, 'en-GB')).toBe('en')
    expect(resolveLang(undefined, 'en')).toBe('en')
    expect(resolveLang(null, 'es-AR')).toBe('es')
    expect(resolveLang(null, 'fr-FR')).toBe('es')
    expect(resolveLang(null, undefined)).toBe('es')
  })

  test('unknown stored values fall to the browser branch', () => {
    expect(resolveLang('de', 'en-US')).toBe('en')
    expect(resolveLang('{"injected":true}', 'es')).toBe('es')
    expect(resolveLang('en-US', 'es-ES')).toBe('es')
  })

  test('storedLang reads validated storage and survives blocked storage', () => {
    expect(storedLang({ getItem: (key: string) => (key === LANG_STORAGE_KEY ? 'en' : null) }, 'es-ES')).toBe('en')
    expect(storedLang({ getItem: () => 'garbage' }, 'es-ES')).toBe('es')
    expect(
      storedLang(
        {
          getItem: () => {
            throw new Error('blocked')
          },
        },
        'en-US',
      ),
    ).toBe('en')
    expect(storedLang(null, 'es-ES')).toBe('es')
    expect(storedLang(undefined, undefined)).toBe('es')
  })
})

describe('language toggle framing', () => {
  test('each language advertises the switch in the language being read', () => {
    const pairs: Array<[Lang, string, string]> = [
      ['es', DICTS.es.lang.toEn, DICTS.es.lang.toEs],
      ['en', DICTS.en.lang.toEn, DICTS.en.lang.toEs],
    ]
    for (const [lang, toEn, toEs] of pairs) {
      expect(typeof toEn).toBe('string')
      expect(typeof toEs).toBe('string')
      expect(lang === 'es' ? toEn : toEs).toMatch(/inglés|English|español|Spanish/)
    }
  })
})
