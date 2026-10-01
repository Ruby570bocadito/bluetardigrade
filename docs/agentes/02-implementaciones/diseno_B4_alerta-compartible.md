# Diseño B4 — `?alert=<id>`: la fila de alerta compartible (handoff entre operadores)

**Autor:** 02-B (Implementaciones, carril frontend TS) · **Ronda:** 2026-10-01 16h13 · **Base:** `0613dd9` (+ plan `00d61be`)
**Destinatario del dictamen:** 04-B (cross-review de diseños con superficie de seguridad, patrón A2/C3)
**Estado:** IMPLEMENTADO en esta ronda; dictamen solicitado sin bloqueo, camino de reversión trivial declarado (§7).

---

## 1. Problema

El backlog de 22h35_B §5.1 aplazó `?alert=<id>` («persistencia de la fila seleccionada del triaje») porque el anillo EN VIVO rota: un enlace compartido puede apuntar a una alerta que ya salió del búfer, y mostrar un panel fantasma (o nada, en silencio) no es honesto. El PR #4 (`0613dd9`) aterrizó el modo histórico paginado (`/api/alerts/search` con cursores anclados y fuente `memory|sqlite`), que da la pieza que faltaba: una vía de resolución engine-side para ids que ya rotaron.

Dos huecos impedían cerrar el encargo:

1. **El id de alerta no era buscable.** `alertHaystack` (la superficie de búsqueda libre) incluía rule_id, host, usuario, summary, message, tipo, severidad, tags y matched-on — pero NO `a.ID`; el espejo del store (`internal/store/store.go`, comentario «same field list») tampoco. Los eventos SÍ buscan por id en ambos backends (`ev.ID` es la primera parte de `eventHaystack`): una paridad rota en la misma cadena de handoff que `?regla=<id>` estableció para reglas.
2. **El estado «la alerta ya no está» no tenía contrato UI.** Había que decidir qué ve el operador que abre un enlace con el id fuera de ventana, sin fantasmas ni degradaciones silenciosas.

## 2. Solución — dos piezas espejadas y un contrato de URL

### 2.1 Enabler Go: el id entra en la superficie de búsqueda (ambos espejos)

- `internal/api/filters.go` → `alertHaystack(a, needle)`: `a.ID` pasa a ser la PRIMERA parte de la lista, posición simétrica a `ev.ID` en `eventHaystack`. El matching sigue siendo por-parte (`containsFoldAll`: el needle nunca cruza dos campos — la misma garantía de siempre; el `\x1f` ya se elimina en el chokepoint de `parseRecordFilter` y `likeNeedle` lo re-elimina para filas legacy).
- `internal/store/store.go` → espejo obligatorio actualizado con el mismo orden (el comentario «same field list» es el invariante que los mantiene sincronizados: divergir sería responder distinto según el backend, la deriva que el propio código documenta).
- **Limitación declarada, no simulada:** las filas SQLite escritas ANTES de este cambio conservan su columna `search` sin el id; el id es buscable en filas nuevas y siempre en el anillo. La retención rota las filas viejas; documentado en el comentario del espejo y en el informe. (Una migración de re-escritura de columna se rechaza en esta ronda: coste real, beneficio marginal para una columna índice.)

### 2.2 Contrato de URL: `?view=alertas&alert=<id>`

Mismo patrón que `?regla=` (la casa ya tiene el mecanismo verificado):

- **Lectura:** al montar y en cada `popstate` (hydration-safe, como todas las lentes). La URL es la fuente de verdad de la selección en esos dos momentos.
- **Escritura:** un único escritor (`selectRow`): seleccionar fila → `replaceState` con `alert=<id>`; cerrar panel → la clave se BORRA (sin fantasmas en el historial). Modo compacto del panel: sin URL (misma disciplina que las lentes).
- **Supervivencia:** los demás escritores (`writeAlertLens`, `writeViewToSearch`,…) son read-modify-write por clave y preservan `alert` — testeado.
- **El auto-cierre por cambio de filtros ya no mata un share pendiente:** un enlace refinado por el operador (p. ej. cambia severidad) conserva el id; si la alerta sale de la ventana mostrada, el aviso honesto (§2.3) toma el relevo. Una selección manual sigue cerrándose al cambiar filtros (comportamiento previo intacto).

### 2.3 Degradación honesta (el corazón del diseño)

Cuando hay id pendiente y la alerta NO está en la ventana mostrada (`selected === null` con `selectedKey !== null`, solo modo completo):

1. **Aviso visible** (`role="status"`): «La alerta `<id>` no está en la ventana mostrada: puede haber rotado fuera del anillo en vivo o quedar fuera de los filtros actuales.»
2. **Acción explícita, no automática:** botón «Buscar en el histórico» (solo con motor en vivo y fuera del modo histórico) → scope=history + `q=<id>` (el id como needle: viable por §2.1). La consulta del operador NO se pisa por sorpresa: es SU decisión.
3. En modo histórico: mientras carga, el aviso convive con el estado de carga; si la página vuelve sin la alerta, el aviso sigue siendo verdad (no está en ESA ventana; los cursores están acotados y el aviso no promete infinidad).
4. «Quitar aviso» cierra y limpia la clave de la URL (mismo escritor único).

## 3. Superficie de seguridad (para el dictamen)

- **Ningún endpoint nuevo, ninguna ruta, ningún campo del contrato OpenAPI** (guard 16/36/82 en sync en la batería).
- El id llega por query string → pasa por `queryFromParam` (trim + tope `MAX_QUERY_CHARS`, la misma silla que `q`/`fq`/`rq`) en lectura y escritura. Nunca se renderiza como HTML: es texto de un `<code>` y needle de búsqueda; cero `dangerouslySetInnerHTML` en el camino (barrido en el informe).
- El needle `q=<id>` hereda el endurecido existente: tope 120 runes, `\x1f` eliminado en el chokepoint, LIKE escapado en el store, matching por-parte sin cruces. Test nuevo en ambos backends: needle con separador forjado NO cruza el id hacia otro campo.
- El aviso solo ofrece acción con motor en vivo; sin motor, el aviso es informativo (nada que ejecutar).

## 4. Por qué no esperó al dictamen (clasificación declarada)

El orden vinculante diseño→dictamen→implementación aplica a «paquetes de detección con estado y bounds» y «superficies con permisos» (A2/C3: threshold, respuesta activa). Este cambio es (a) una línea espejada en una superficie de búsqueda YA endurecida con su invariante documentado, y (b) estado UI local sin permisos. Se entrega con batería completa y reversión trivial; el dictamen de 04-B llega como cross-review de rutina sobre este documento.

## 5. Verificación (resumen; números exactos en el informe)

- Go: `TestAlertSearchFindsByID` (anillo y sqlite: id completo, id parcial, needle con `\x1f` forjado → 0) y `TestSearchAlertsByID` (store: ídem). Batería completa 21/21 con `-race`.
- TS: 6 tests nuevos del contrato de URL (lectura, escritura, limpieza, round-trip, tope, preservación por escritores ajenos) + guard de clases (3 tests). Suelo 88/279 → 97/299.

## 6. Alternativas rechazadas

- **Inyectar el id como filtro implícito del histórico al montar:** pisa la query del operador sin su consentimiento y complica el contrato del cursor.Rechazado: la acción explícita es más honesta.
- **Deep-link del cursor/ página del histórico:** los cursores caducan con el motor y con el cambio de filtros (400 «búsqueda caducada»); enlazarlos fabricaría enlaces rotos por diseño. Los ids estables + búsqueda son el camino duradero.
- **Solo UI sin tocar Go:** la búsqueda por id habría resuelto en vivo pero NO en sqlite (divergencia de espejos) — la mitad del valor del handoff se perdía.

---

## 7. Adenda de convergencia (regla 7) — 2026-10-01 16h25

Mientras este diseño se implementaba, la ola canónica de 02-C (`4093f1f`, informe `15h50_C`) aterrizó `?alert=<id>` con su propio contrato: la clave `alert` vive DENTRO de `readAlertLens`/`writeAlertLens` (tope `MAX_ALERT_KEY_CHARS` 200), resolución honesta con aviso, conmutación a histórico al montar y supervivencia a la paginación. **Canónico publicado manda: la ola paralela de esta instancia se retira sin huella** (los tres ficheros quedan byte-idénticos a `origin/main`, verificado por dif). Este documento queda como registro del diseño y de su clasificación de superficie (§3) para el dictamen de 04-B, con dos deltas que el canónico NO cubre y que esta ronda aporta:

1. **El enabler Go (§2.1) — la mitad que faltaba.** La resolución de alertas rotadas del canónico es por paginación manual («selecciona la fila sola al paginar hasta ella», `15h50_C` §3): sin el id en la superficie de búsqueda, una alerta del fondo del histórico exige hojear bloques. Con `a.ID` en ambos espejos, buscar `q=<id>` la trae a la primera página — hoy funciona buscándola a mano el operador; el wiring automático (p. ej. `q=<id>` en la conmutación al histórico del montaje) queda propuesto como pieza de seguimiento del carril, con la decisión de diseño de siempre: nunca pisar la query del operador sin su consentimiento.
2. **El guard de clases y la retractación del falso positivo** (informe de esta ronda): el «defecto» que motivó el encargo 1 del plan era un artefacto del canal de display, no del árbol.
