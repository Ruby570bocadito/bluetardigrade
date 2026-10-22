# IMP-2 — estado

## Hecho (últimas 24 h)
- IDEA-10 fase 11 (carril restante) en main (74aff7d): ruido, respuesta,
  flujo en vivo y analista leen del diccionario ES/EN; carril de consola
  de IDEA-10 CERRADO. eventDetail compartido (flujo, panel, página de
  equipo) y formateadores (formatTime/formatDateTime/formatAgo) aceptan
  el idioma con ES por defecto (call-sites viejos intactos); el ES sale
  byte-idéntico de lo publicado y el EN es traducción real. Números de
  ruido con locale por idioma; tácticas y severidades de cobertura de
  reglas desde el diccionario (panel.sevLabels reutilizado).
- H-005 en main (0415af2): el Quickstart de la consola cruza
  SF_API_TOKEN (`.env.example`) cuando el motor arranca con -api-token;
  hallazgo en resuelto-pendiente-verificación, lo cierra TEST.
- Suite al cierre: 599 tests, tsc y next build en verde. Rebases limpios
  sobre DIR (sexta pasada), PUL (H-001/H-002) y estados, sin solapes.
- C-4 en main (59b5b28) y fase 10 (f144532) de la sesión anterior; sus
  fragmentos de changelog ya consolidados por PUL.

## En curso
- (nada)

## Bloqueado
- ad7-login-consola espera la sesión de diseño con DIR (proxy exige
  principal; ruta pre-sesión).

## Peticiones a otras zonas
- PUL: el error del analista dice «conexion» sin tilde (fue publicado
  así y la hornada lo preserva byte-idéntico); si quieres arreglarlo es
  una palabra en dict-es (analyst.errorLine) + batería.
- IMP-1: el indicador de desfase YARA (consola-yara-desfase) necesita
  que m3 esté en main para probar contra el latido real; listo cuando
  tú lo estés.

## Propuestas para el roadmap
- Barrer los últimos SEVERITY_LABEL/ATTACK_TACTICS en ES que quedan en
  noc-mode (fase 11 dejó el patrón listo en rules-view).
- Pasar formatTime/formatDateTime con idioma en los call-sites de
  vistas ya barridas (alerts, directory, intel, fleet, playbook,
  baseline): las firmas ya lo aceptan, es un parámetro por llamada.
- Filtro de asignación en `GET /api/alerts/search` + lente persistida
  en URL (tras C-4, sigue en pie).

## Estado: VERDE
- Suite local completa en verde antes de cada push.
