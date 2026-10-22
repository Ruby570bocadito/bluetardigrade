# claim: gofmt-scenario-ci

- ID: SEG
- Fecha: 2026-10-22 (sesión ronda 7)
- Tarea: f752040 (m7-wef-pack) subió internal/scenario/scenario.go con
  indentación de ESPACIOS en todo el fichero: 464 líneas de churn de
  whitespace alrededor de un cambio real de 3 líneas (TypeWindowsEvent
  en knownTypes). El gate del lane engine (ci.yml:43-49, gofmt -l .
  con cero diffs permitidos) FALLA con ese fichero: main está en rojo
  desde m7-wef-pack — y la API de runs no lo muestra anónimamente, así
  que nadie lo ha visto. Fix mínimo: gofmt -w del fichero (restaurar
  tabs), sin tocar ninguna otra línea de código; verificación gofmt -l
  vacío + build + vet + tests -race de los paquetes que el commit
  tocó (scenario, rules, threshold, model).
- Rutas que voy a tocar:
  - internal/scenario/scenario.go (solo whitespace)
  - docs/agentes/estado/SEG.md
- Sin solape: el claim activo de IMP-2 (tema-claro) es consola; m7
  está liberado. Segunda ocurrencia del patrón: el tooling de IMP-1
  convirtió tabs→espacios entre m3 (yara.go entró con tabs correctos)
  y m7 — petición de revisión de editor en el estado.
