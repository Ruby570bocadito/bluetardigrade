# docs/ — documentación del proyecto

| Ruta | Contenido |
|------|-----------|
| [RESUMEN-MEJORAS-2026-10-01.md](RESUMEN-MEJORAS-2026-10-01.md) | Registro completo de las dos rondas: CLI, dashboard, histórico, bugs corregidos, documentación, pruebas locales y CI remota del PR #4 |
| [GUIA-INICIO.md](GUIA-INICIO.md) | Arranque y operación en español: CLI, consola, histórico y resolución de problemas |
| [REVISION-CLI-DASHBOARD.md](REVISION-CLI-DASHBOARD.md) | Informe de la primera ronda, con hallazgos y límites del entorno local |
| [REVISION-HISTORICO.md](REVISION-HISTORICO.md) | Informe de la segunda ronda, contrato de búsqueda, paginación y triaje histórico |
| `OPERATIONS.md` | Guía de operación (inglés, migrada del README por la directiva del Director 23h55 §4): instalación (Windows un comando, Docker, fuente), referencia de configuración (flags + env vars), API HTTP, Prometheus, almacenamiento, auth de ingest con rotación, webhook/sinks SIEM/notificaciones, supresiones, triaje, riesgo, beaconing, respuesta activa, contenido de detección (reglas/secuencias/Sigma), CLI y CI/bench |
| `ARCHITECTURE.md` | Arquitectura del sistema (inglés, migrada del README por la directiva 23h55 §4): diagrama y mermaid, contrato del schema, inventario detallado de features y árbol de repositorio anotado |
| `../SECURITY.md` | Divulgación coordinada de vulnerabilidades (G9, aterrizada en la ola `6eb6b02`): cómo reportar de forma privada, ventanas de respuesta 72h/7d |
| `arquitectura-tecnica-v0.11.pdf` | Documento de arquitectura v0.11 (26 páginas; **revisión vigente**): producida por el pipeline versionado `scripts/arq_v04/`; actualiza el **suelo de la batería TypeScript de la consola** a las ocho suites del post-PR #4 (84 tests y 251 aserciones, medidos de primera mano en la ronda 15h20_B: proxy 13/13·45, url-state 31/31·92, keyboard-nav 11/11·34, escritura de triaje 9/9·29, engine-client 9/9·20, alert-search 5/5·17, activity 3/3·9, operations 3/3·5) y el **guard OpenAPI** a 16 rutas / 36 campos / 82 referencias (self-test 1+13); absorbe la **ola de interfaz de octubre** (PR #4: CLI interactiva acotada, resumen operativo del panel, investigación histórica paginada — `GET /api/alerts/search` con cursores fijados, presupuesto de 5 000 candidatos y cuatro segundos, triaje comparado por `status_at`); corrige el **camino de datos de la consola** (proxy same-origin primario, hub console-service opcional) y re-cuenta el árbol a **19 paquetes internos** (promoción de `internal/redact`); hereda de la v0.10 la cadena de release (G12), dependabot (G6) y SECURITY.md (G9) |
| `arquitectura-tecnica-v0.10.pdf` | Documento de arquitectura v0.10 (25 páginas; conservada como referencia histórica — la v0.11 la supersede; fue el barrido de suelo a tres suites 36/110 (olas `49b3535`/`9bd3c71`, certificaciones `cf6ec25`/`055d024`) y registró la cadena de release (G12: v0.1.0 con CHANGELOG y binarios, ola `2bc6fc7`), dependabot (G6) y SECURITY.md (G9, ola `6eb6b02`), y las certificaciones F2/#34/#35 (acta 04-A 22h00); su limitación conocida — suelo de batería y guard OpenAPI obsoletos tras el PR #4, camino de datos de la consola aún descrito vía hub, árbol a 18 paquetes — queda cubierta por la v0.11) |
| `arquitectura-tecnica-v0.9.pdf` | Documento de arquitectura v0.9 (26 páginas; conservada como referencia histórica — la v0.10 la supersede; fue el barrido de suelo a dos suites 19/58 de la ola `9bd3c71`, con certificación `cf6ec25`/`055d024`; su limitación conocida — suelo de batería y cadena de release aún no descritos en su estado actual — queda cubierta por la v0.10) |
| `arquitectura-tecnica-v0.8.pdf` | Documento de arquitectura v0.8 (25 páginas; conservada como referencia histórica — la v0.9 la supersede; amplió la v0.7 con la evidencia visual real de la vista de respuesta activa — las capturas de laboratorio de la ola de implementaciones 20h05 (`a3b8bd8`/`624d8ba`) incrustadas como Figuras 3 y 4 (cola con 12 líneas de audit genuinas, par F1 completo compartiendo `action_id`, filtro followups con conteo honesto 1 de 12), el matiz de esquema documentado (`mechanism` solo viaja en followups, `respond.go:345-348`) y la Figura 2 recapturada sobre el árbol vigente (la limitación de navegación que la serie arrastraba desde la v0.6 queda resuelta por la ronda hermana 20h05_B, ola `ca51b95`), el tracer renumerado a Figura 5 y la resolución de la O4 absorbida — con procedencia citada |
| `arquitectura-tecnica-v0.7.pdf` | Documento de arquitectura v0.7 (23 páginas; conservado como referencia histórica — la v0.8 lo supersede; amplió la v0.6 con la operabilidad forense de la vista de consola de C3 — filtro por clase de intento, ventana de cola controlable 100/500 y exportación JSONL client-side (ola `4967cad`) — y el estado certificado de los hallazgos: F1 cerrada y O2 certificada por el cross-review de seguridad, acta 19h30) |
| `arquitectura-tecnica-v0.6.pdf` | Documento de arquitectura v0.6 (22 páginas; conservado como referencia histórica — la v0.7 lo supersede; amplió la v0.5 con el mecanismo dual de ejecución de C3 y la certificación conductual permanente del cierre en CI, y regeneró la Figura 2 con el panel de hosts calientes completo) |
| `arquitectura-tecnica-v0.5.pdf` | Documento de arquitectura v0.5 (21 páginas; conservado como referencia histórica — la v0.6 lo supersede; amplió la v0.4 con la superficie de lectura de C3 y el guard a 15 rutas/36 campos/74 referencias) |
| `arquitectura-tecnica-v0.4.pdf` | Documento de arquitectura v0.4 (20 páginas; conservado como referencia histórica — la v0.5 lo supersede; fue la primera revisión producida por el pipeline versionado) |
| `arquitectura-tecnica-v0.3.pdf` | Documento de arquitectura v0.3 (19 páginas; conservado como referencia histórica — la v0.4 lo supersede) |
| `arquitectura-tecnica-v0.2.pdf` | Documento de arquitectura v0.2 (19 páginas; conservado como referencia histórica) |
| `arquitectura-tecnica-v0.1.pdf` | Documento de arquitectura v0.1 (diseño original de septiembre 2026, 15 páginas; conservado como referencia histórica del diseño previo a la implementación) |
| `assets/` | Diagramas del README (`diagram_*.png`), capturas de la consola (`console-*.png/gif`) y sus fuentes de trabajo en `assets/src/` |
| `false-positive-control.md` | Guía de operación del canal de salida: dedup, supresiones, correlación, filtrado en el receptor y límites anti-abuso del pipeline |
| `analisis-brechas-y-mejoras.md` | Análisis de brechas y mejoras futuras: fotografía verificada del estado, 18 brechas priorizadas (P0-P2) con criterios de aceptación, deuda viva y decisiones deliberadas que no son brechas (instantánea del árbol `3820d95`, propiedad del carril 03) |
| `analisis-brechas-y-mejoras-04B.md` | Profundización del carril 04-Seguridad del análisis de brechas (árbol `3820d95`, complementa el general `analisis-brechas-y-mejoras.md`): 20 brechas con evidencia `fichero:línea` (G1-G20) y 7 mejoras de producto (M1-M7); neto nuevo: la batería de la consola 19/58 no corre en CI (G1), lint/`-race`/dependabot/fuzzing ausentes (G2/G3/G6/G7), sensor Rust sin tests (G4), gobernanza de credenciales (G8) y cadena de release (G12); convergencias declaradas en la nota de cabecera |
| `agentes/` | Informes de ronda del sistema de agentes (registro histórico de auditoría y coordinación) |
| `agentes/GUIA-VERIFICACION.md` | Estándar obligatorio de verificación por conteos/bytes en las rondas (artefactos del canal de display y del editor, recetas y árbol de decisión) |

## Estado del documento de arquitectura

`arquitectura-tecnica-v0.11.pdf` es la revisión vigente, producida por el pipeline
versionado del árbol (`scripts/arq_v04/`: cuerpo ReportLab + portada Playwright +
fusión pypdf; ver su README — el nombre del directorio registra dónde nació el
pipeline, no la revisión que produce). Describe el sistema tal como está
implementado y verificado a su generación: actualiza los **suelos de la batería
de la consola** a las ocho suites del post-PR #4 (84 tests y 251 aserciones,
medidos de primera mano en la ronda 15h20_B; guard OpenAPI a 16 rutas / 36
campos / 82 referencias con self-test 1+13), absorbe la **ola de interfaz de
octubre** (PR #4: CLI interactiva acotada, resumen operativo del panel,
investigación histórica paginada con `/api/alerts/search` — cursores fijados,
presupuesto de 5 000 candidatos y cuatro segundos, triaje comparado por
`status_at` —), corrige el **camino de datos de la consola** (el proxy
same-origin es el camino primario; el hub console-service queda como superficie
opcional del analista IA) y re-cuenta el árbol a **19 paquetes internos** (la
promoción de `internal/redact` dejó obsoleto el 18 de la v0.10); hereda de la
v0.10 la **cadena de release** (G12: v0.1.0 etiquetado con CHANGELOG y binarios
por plataforma vía `make dist` + `release.yml`, ola `2bc6fc7`),
**dependabot** (G6) y **SECURITY.md** (G9, ola `6eb6b02`), y da por aterrizadas y re-certificadas las F2/#34/#35 (acta 04-A 22h00, CI success posterior); hereda de la v0.9 el barrido de suelo a dos suites (19/58, olas `9bd3c71`/`cf6ec25`/`055d024`), de la v0.8 la **evidencia visual real de la vista de respuesta activa** (Figuras 3 y 4) y de la v0.7 la **operabilidad
forense de la vista de consola de C3** (filtro por clase de intento
todas/ejecutadas/denegadas/followups, ventana de cola controlable 100/500 y
exportación JSONL client-side con honestidad de superficie; ola `4967cad`) y de
la v0.6 el **mecanismo dual de ejecución de C3** (pidfd con fallback declarado
en Linux — `mechanism` + `fallback_reason` con el errno, incluso en
denegaciones — y handle en Windows) con su **certificación conductual permanente
en CI** (job engine-windows: smoke 29/29 sobre motor nativo; `d065f4c`,
ratificado por doble cross-review en `02c5c55`), y añade la **evidencia visual
real de la vista de respuesta activa**: las capturas de laboratorio de la ola de
implementaciones 20h05 (aterrizadas en `a3b8bd8`, con Go 1.22.10 sobre motor
armado y audit poblado por 12 líneas genuinas — 5 ejecutados + 7 denegaciones
de las 5 clases del e2e más el par F1 completo) incrustadas como **Figuras 3 y
4** (el tracer pasó a Figura 5), con el matiz de esquema documentado de primera
mano: `mechanism` solo viaja en el JSONL de los followups (la línea pre-señal se
escribe sin él, `respond.go:345-348`; los denegados lo llevan vacío y `omitempty`
lo suelta), la etiqueta `pidfd` fotografiada es la del followup real y no hay
captura de la etiqueta de fallback porque no hay fallback real que fotografiar
(kernel con pidfd sano) — honestidad de superficie declarada en el propio texto.
La ronda absorbe además dos resoluciones en vuelo: la Figura 2 recapturada sobre
el árbol vigente por la ronda hermana 20h05_B (la limitación de navegación
heredada de la v0.6 queda resuelta) y la resolución de la observación O4 (acta
02-B 20h20): el export entrega la ventana completa por diseño — el filtro es
lente de vista, no selector de datos — y el tooltip lo declara en sus tres
estados, precisión ya incorporada al texto del documento.
El estado de los hallazgos a la v0.10: F1 **cerrada** y O2 **certificada**
por el cross-review de seguridad (acta 19h30, doble veredicto coincidente); F2
y #34/#35 pasaron de propuestos a **aterrizados y re-certificados** (olas
`6da494c`/`3da45bc`, residuo de #35 re-anclado en `6eb6b02`, re-certificación
independiente en el acta 04-A 22h00 con CI success posterior). El guard OpenAPI certifica 15
rutas / 36 campos / 74 referencias con self-test; el marcador canónico más reciente (acta del Director
22h46) consolida 20/20 defectos cerrados sin ninguno vivo y 7/17 líneas de roadmap certificadas — con A3
aterrizado y verificado (acta 22h39) —, y los conteos más amplios de los carriles (33/33, 14/17) viajan
como numeración propia pendiente de esa consolidación; la catorceava (consola C3) sigue propuesta a la
espera de certificación del Director. Los contadores del documento citan su
fuente (guard, actas, bench) para que envejezcan con procedencia y no en
silencio.

`arquitectura-tecnica-v0.1.pdf` se conserva como **documento de visión** del diseño
original: útil para trazabilidad de decisiones, pero desactualizado en stack de consola
(planificaba React + Vite + Zustand), API del motor (planificaba Gin y OpenAPI generado)
y operadores (anunciaba `between`, no implementado). `arquitectura-tecnica-v0.2.pdf` se
conserva como la revisión que primero describió el estado implementado. La
`arquitectura-tecnica-v0.3.pdf` se conserva como la revisión de la nota de cobertura
honesta — su limitación conocida (C2/SIEM/C3 descritos solo como futuro o ausentes)
quedó cubierta por la v0.4. La `arquitectura-tecnica-v0.4.pdf` se conserva como la
primera revisión del pipeline versionado y la que documentó de primera mano C2, SIEM
nativo y C3; su limitación conocida (números del guard a 13 rutas, marcador 32/32,
superficie de lectura de C3 aún no cubierta) queda cubierta por la v0.5. La
`arquitectura-tecnica-v0.5.pdf` se conserva como la revisión de la superficie de
lectura de C3; su limitación conocida (mecanismo dual de ejecución y certificación
Windows de CI aún no descritos, Figura 2 con la captura previa al panel completo)
queda cubierta por la v0.6. La `arquitectura-tecnica-v0.6.pdf` se conserva como la
revisión del mecanismo dual y de la certificación permanente de CI; su limitación
conocida (operabilidad forense de la vista de respuesta aún no descrita, F1
presentada como pendiente de certificación) queda cubierta por la v0.7. La
`arquitectura-tecnica-v0.7.pdf` se conserva como la revisión de la operabilidad
forense y de la certificación F1/O2; su limitación conocida (la vista de respuesta
activa descrita sin evidencia visual, las capturas reales aún no aterrizadas)
queda cubierta por la v0.8. Lo que la
v0.11 sigue declarando como futuro, sin
presentarlo como capacidad: YARA,
gRPC/protobuf, filaments Python y eBPF en Linux (fases 2-4 del roadmap). Las decisiones
de diseño vigentes viven en la v0.11 del PDF, en el README y en los informes de
`agentes/`; el directorio de ADRs sigue sin existir como tal. Para regenerar o
evolucionar el documento: `bash scripts/arq_v04/build.sh` (requisitos y decisiones en
[`scripts/arq_v04/README.md`](../scripts/arq_v04/README.md)).
