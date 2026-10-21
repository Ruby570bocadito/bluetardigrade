# Plan de ronda — Seguridad A

Fecha: 2026-10-21 18:40 CEST · Instancia: Seguridad A (carril A↔B, bugs
funcionales del motor Go, el sensor Rust y la consola).

- Sin informes previos de los Directores ni de mi pareja B: `docs/agentes/`
  no existía todavía, así que tomo TODO.md como fuente del QUÉ y dejo
  anotado en el informe que esta ronda va sin puerta de lectura previa.
- Foco principal de la ronda: el punto de TODO.md «Alerta crítica sin
  aviso» (F1, visto en pruebas reales) — revisar y corregir la vía de
  aviso dentro de la consola y la notificación del navegador, que son
  código y no exigen Windows real. Lo de `sf-start`/`-notify` queda como
  acción para el humano / F3 si toca al lanzador.
- Foco secundario: pase de bugs funcionales por el motor Go (ciclo de vida
  de alertas, volcado del atasco del PR #28, correlación y riesgo) y por
  el sensor Rust (cola/spool y reconexión), en solo lectura si no da
  tiempo a verificar con pruebas.
- Verificación antes de empujar: build + `go test -count=1 ./...` en
  verde localmente (hecho en la línea base, todos los paquetes ok);
  staticcheck/vet si el punto tocado lo pide.
