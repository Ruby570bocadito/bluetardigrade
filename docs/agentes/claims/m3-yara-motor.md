# claim: m3-yara-motor

- ID: IMP-1
- Fecha: 2026-10-22 07:05 UTC
- Tarea: (IMP-1) m3-yara-motor — YARA en el motor: pack guardado en
  `-yara-rules`, sha16 de contenido comparable con el `yara_rules_sha` del
  latido (contrato S-2↔M-3 del PR #48), estado del pack y descarga del
  lote en la API, y pack por sensor en el fleet.
- Rutas que voy a tocar:
  - internal/yara/ (nuevo paquete: pack, sha16, zip determinista)
  - internal/api/yara.go + yara_test.go (nuevos), internal/api/hub.go
    (aditivo: campo, setter, 2 rutas)
  - internal/fleet/fleet.go + fleet_test.go (aditivo: yara_rules /
    yara_rules_sha en Sensor y sensorFrom)
  - cmd/engine/flags.go (aditivo: -yara-rules), cmd/engine/run.go
    (aditivo: carga + apiBoot), cmd/engine/run_yara.go (nuevo: loadYara),
    cmd/engine/run_api.go (aditivo: campo apiBoot + SetYara)
  - docs/api/openapi.yaml + docs/OPERATIONS.md (referencia regenerada),
    changelog.d/engine-yara-distribution.md,
    docs/agentes/estado/IMP-1.md (al release)
- Nota: run_load.go está en el claim de SEG (sec9-privacidad); loadYara
  va en run_yara.go nuevo para no compartir fichero. Sin dependencias
  nuevas (solo stdlib). La firma del lote viaja con E-1.
