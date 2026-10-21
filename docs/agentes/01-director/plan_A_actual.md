# Plan de ronda — Director A

Fecha: 2026-10-21 (≈19:00 CEST). Primera ronda del sistema `docs/agentes/`
(bootstrap): no hay informes previos de ninguna instancia ni ROADMAP.md
general. El estado llega del kit previo (AG-1..AG-4, WORKLOG.md) y de los
planes ya publicados esta tarde por Pulimiento A y Seguridad B.

## Acuerdo con el Director B (pareja de ronda)

- **Director A (yo)**: foco motor + sensor + seguridad funcional (audita
  con más detalle a Implementaciones A/B, Pulimiento A/B y Seguridad A/B)
  y **edita esta ronda el ROADMAP.md general** (decisión por orden de
  publicación de planes: el mío es el primero).
- **Director B**: foco consola + documentación + calidad (Implementaciones
  C/D, Pulimiento C/D, Seguridad C/D), revisa README/árbol/docs y
  verifica el ROADMAP.md al cierre (git pull), sin duplicarlo.
- Ninguno de los dos toca features: nuestras únicas escrituras son
  `docs/agentes/` (este plan, el ROADMAP.md y los informes de ronda).

## Qué voy a auditar esta ronda

1. Estado real de `main` frente a los informes: PRs #38 (C-1), #39 (O-1)
   y #40 (S-1) fusionados hoy; CI en curso; ritual TODO.md + changelog.d/.
2. Contrato S-1 ya fusionado (sensor): `registry.value` + `user` +
   `attributes["registry_root_inferred"]` frente a lo que pedía TODO.md
   (`registry.value_data`); consecuencias para reglas y supresiones.
3. Hornada 1 del CONTEXTO: qué queda vivo (M-1 libre, C-1 parcial,
   O-1 parcial, S-1 entregado) y cómo se refleja en el ROADMAP.md que
   creo esta ronda.
4. Higiene: rastros de marca de IA, identidad de commits («Z User»),
   commits recientes en inglés y ficheros del kit previo (AGENTS.md /
   TASKS.md / WORKLOG.md) a retirar cuando `docs/agentes/` se consolide.
5. Coordinación con las sesiones activas: Pulimiento A (POL-1a/1b) y
   Seguridad B (F1 «alerta crítica sin aviso») están trabajando ahora
   mismo; el ROADMAP debe recogerlo para que nadie duplique.

Discord: sin webhook configurado en esta sesión (variable ausente).
