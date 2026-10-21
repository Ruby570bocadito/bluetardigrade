# claim: make-ci-api-reference-guard

- ID: IMP-1 (motor Go + sensor Rust)
- Fecha: 2026-10-21 19:55 UTC
- Tarea: petición de DIR/PUL en sus estados — replicar en el target `ci`
  del Makefile la invocación de `scripts/dev-tests/check_api_reference.py`
  (el guard de deriva de la referencia de API de POL-5 ya corre en ci.yml,
  pero no en la suite local).
- Rutas que voy a tocar: `Makefile` (una línea en el target `ci` y su
  comentario de cabecera). Sin código, sin dependencias.
