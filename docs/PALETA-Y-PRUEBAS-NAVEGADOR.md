# Paleta de comandos y pruebas de navegador

Ronda del 1 de octubre de 2026, preparada sobre `591411a` e integrada sobre
`6515a99`, conservando la búsqueda por ID de alerta añadida a la rama principal.
Complementa las
mejoras de CLI/dashboard e histórico anteriores y la ayuda de atajos y los
enlaces de alerta que ya estaban en la rama principal.

## Funciones entregadas

La cabecera de la consola incluye **Comandos**, accesible en escritorio y
móvil. **Ctrl+K / ⌘K** abre o cierra la paleta fuera de campos de edición.
El catálogo reúne las vistas de la consola, la actualización de datos del motor y la
ayuda de teclado. No modifica configuración, reglas ni respuesta activa.

La búsqueda trabaja solo sobre el catálogo local: reconoce mayúsculas,
tildes, palabras de descripciones y sinónimos del operador, y exige todas
las palabras introducidas. ↑/↓ cambia la opción, Enter ejecuta y Esc cierra.
Un resultado vacío no interpreta el texto como una acción o URL.

El catálogo de navegación sirve también a la sidebar y la ayuda, evitando
nombres o atajos divergentes. La actualización usa el provider compartido
y queda deshabilitada mientras hay una lectura en curso. La navegación
conserva otras lentes de URL y enfoca el contenido principal; elegir la
vista actual evita una entrada duplicada en el historial.

## Teclado, foco y accesibilidad

Paleta y ayuda usan un diálogo modal nativo con título y descripción. El
fondo queda inerte, Tab permanece dentro del modal y el foco se restaura al
cerrar. Escape y un gesto completo en el fondo cierran el diálogo. Arrastrar
desde dentro hacia fuera no lo cierra. El bloqueo de scroll se retira al
cerrar o desmontar. No se añaden animaciones de entrada obligatorias.

La búsqueda se presenta como combobox con listbox, opción seleccionada y
`aria-activedescendant`; un mensaje anuncia los resultados. Los comandos
deshabilitados se identifican por estado y texto.

La navegación global respeta eventos ya consumidos, repetición, composición,
campos editables y sus descendientes, comboboxes, listboxes, menús y otros
diálogos. Cambiar foco o abandonar la ventana borra el prefijo `g`, evitando
que una tecla posterior complete una navegación antigua.

## Errores corregidos

| Problema | Corrección |
|----------|------------|
| El foco inicial de ayuda podía salir al usar Shift+Tab | Modalidad nativa compartida con la paleta |
| El modal declaraba `aria-modal` sin hacer inerte el fondo | `showModal()` y cierre/limpieza explícitos |
| Los descendientes de campos editables y controles compuestos escapaban al guard | Inspección de ancestros y ámbito de teclado |
| Un prefijo `g` podía sobrevivir a un cambio de foco o a abrir ayuda | Reinicio del buffer antes de cada guard y en focus/blur |
| Eventos consumidos, composición o repetición podían activar acciones | Guard antes de interpretar la tecla |
| Volver a elegir la vista activa añadía historial redundante | Evitar push cuando la vista ya coincide |
| Al reabrir, el reinicio de búsqueda podía competir con una entrada nueva | Estado inicial al montar; la regresión espera la opción activa antes de ejecutar |
| El título cambiaba su marcado al hidratar con movimiento reducido, provocando React #418 | Mismo marcado de palabras en servidor/cliente; animación condicionada por CSS |

## Código y comprobación

| Archivo | Responsabilidad |
|---------|-----------------|
| [`console-commands.ts`](../web/console/src/lib/console-commands.ts) | Catálogo común y búsqueda normalizada |
| [`command-palette.tsx`](../web/console/src/components/console/command-palette.tsx) | Opciones, búsqueda, teclado y ejecución |
| [`console-dialog.tsx`](../web/console/src/components/console/console-dialog.tsx) | Modalidad, foco, fondo y limpieza |
| [`shortcuts-help.tsx`](../web/console/src/components/console/shortcuts-help.tsx) | Ayuda integrada con el mismo diálogo |
| [`keyboard-nav.ts`](../web/console/src/lib/keyboard-nav.ts) | Protección de campos, ámbitos y combinación de paleta |
| [`blur-text.tsx`](../web/console/src/components/reactbits/blur-text.tsx) y [`globals.css`](../web/console/src/app/globals.css) | Título sin divergencias de hidratación y movimiento reducido mediante CSS |
| [`check_console_browser.mjs`](../scripts/dev-tests/check_console_browser.mjs) | Regresión Chromium contra la aplicación compilada |

Las ocho pruebas nuevas del catálogo y la combinación de teclado se suman
a las existentes: **108/108** pasan con el adaptador temporal Node del
entorno local sobre la base integrada. TypeScript y las **18 regresiones DOM**
existentes pasan.
El YAML de CI, los enlaces locales y el formato del diff se comprueban antes
de publicar.

Esta ronda incorporó diez comprobaciones de navegador: foco inicial y opción
activa, Tab/Shift+Tab y restauración, búsqueda y lentes, resultado vacío,
flechas e historial, refresh en curso y cambio a ayuda, guards de teclado,
histórico y triaje por POST, escritorio y móvil. Usa la consola real, con
REST/SSE aislados como fixtures de prueba; las capturas se etiquetan como
evidencia de regresión, no como una sesión real de un sensor.
La [ronda posterior de triaje](INVESTIGACION-CLI-Y-TRIAJE.md) añade una
comprobación de accesos del dashboard y eleva el runner actual a once.

En la [ejecución de CI que descubrió el error de hidratación](https://github.com/Ruby570bocadito/security-framework/actions/runs/36881549412),
las diez interacciones pasaron y el guard de errores de página detectó
React #418 al cargar con movimiento reducido. Se corrigió el título sin
silenciar el error; el runner comprueba tanto la carga inicial como el final.

**Límite local:** Next.js sigue fallando con `ENOENT: uv_resident_set_memory`
en este entorno. Chromium se descargó desde su fuente oficial, pero el
proceso termina con `SIGTRAP` al arrancar aquí. No se declara una ejecución
local correcta de navegador ni del bundle. La CI ejecuta el runner tras
el build de producción, instala Chromium y conserva las capturas durante
siete días. Su resultado remoto debe comprobarse sobre el commit publicado.
(Actualización posterior: en entornos con Chromium operativo el runner y
las capturas del README sí corren localmente — receta y modo de fixtures
en [`docs/assets/README.md`](assets/README.md).)

Para reproducir: [`scripts/dev-tests/README.md`](../scripts/dev-tests/README.md#chromium-console-regression)
y `make console-browser`, después de compilar la consola. Playwright 1.63.0
vive en tooling de pruebas; no se añaden dependencias de ejecución ni se
altera `bun.lock`.

## Referencias y siguientes pasos

La interacción toma como referencia el
[patrón combobox de W3C](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
y el [elemento dialog de HTML](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element).
Las pruebas usan la [biblioteca oficial de Playwright](https://playwright.dev/docs/library).

Quedan ampliar cobertura a otros navegadores, más flujos de móvil e
investigaciones guardadas. El triaje real sigue perteneciendo a los endpoints
existentes del motor; esta ronda no amplía la superficie de escritura.
