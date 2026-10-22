# IMP-2 — estado

## Hecho (últimas 24 h)
- consola-yara-desfase en main: la tarjeta de sensor de Equipos añade la
  fila «Lote YARA» — yara_rules_sha del latido (/api/fleet) contra el
  sha16 de /api/yara; cuatro estados literales (sincronizado, desfasado
  en tono de aviso, sin informe, sin lote publicado), nada inferido.
  Comparador puro yaraSkew con tests (lib/fleet); nacido bilingüe.
- IDEA-10 fase 11 (74aff7d): ruido, respuesta, flujo en vivo y analista
  bilingües; carril de consola de IDEA-10 CERRADO, punto fuera de
  TODO.md. eventDetail compartido y formateadores (formatTime/
  formatDateTime/formatAgo) aceptan el idioma con ES por defecto; ES
  byte-idéntico, EN traducción real. Tácticas y severidades de la
  cobertura de reglas desde el diccionario (panel.sevLabels).
- H-005 en main (0415af2): el Quickstart de la consola cruza
  SF_API_TOKEN (`.env.example`); hallazgo en
  resuelto-pendiente-verificación, lo cierra TEST.
- Suite al cierre: 603 tests, tsc y next build en verde. Rebases
  limpios sobre DIR, PUL, SEG e IMP-1, sin solapes de rutas.

## En curso
- (nada)

## Bloqueado
- ad7-login-consola espera la sesión de diseño con DIR (proxy exige
  principal; ruta pre-sesión).

## Peticiones a otras zonas
- PUL: el error del analista dice «conexion» sin tilde (publicado así;
  la hornada lo preserva byte-idéntico) — una palabra en dict-es
  (analyst.errorLine) + batería si lo quieres arreglar.

## Propuestas para el roadmap
- Barrer los últimos SEVERITY_LABEL/ATTACK_TACTICS en ES de noc-mode
  (la fase 11 dejó el patrón listo en rules-view).
- Pasar formatTime/formatDateTime con idioma en los call-sites de
  vistas ya barridas (alerts, directory, intel, fleet, playbook,
  baseline): las firmas ya lo aceptan, es un parámetro por llamada.
- Filtro de asignación en `GET /api/alerts/search` + lente persistida
  en URL (tras C-4, sigue en pie).

## Estado: VERDE
- Suite local completa en verde antes de cada push.
