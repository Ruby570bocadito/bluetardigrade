# Plan de ronda 2026-10-06 — Implementación A

1. **SEC-2 (secretos en reposo, lado motor)** — nuevo `internal/secretfile`
   con el contrato del addendum de SEG-B (informe 19h10): sobre JSON
   `version/created_at/scheme/ciphertext`; `plain` con 0600 POSIX real
   exigido, `dpapi` Windows con CRYPTPROTECT_LOCAL_MACHINE vía
   x/sys/windows; escritura temp+rename+Sync; la lectura acepta también
   el fichero en crudo (paridad de laboratorio) con aviso en Windows.
   Cableado en `internal/ad`: secreto como []byte desde el fichero hasta
   el bind, puesta a cero del buffer, avisos visibles en
   `/api/ad/status`. Flag `-write-secret <fichero>` (el secreto entra
   por stdin, jamás por argv). Tests del checklist de SEG-B: ida y
   vuelta (la de DPAPI se ejecutará en el job Windows del CI),
   permisos, higiene de logs ante bind fallido, ausencia del secreto y
   de su longitud en las respuestas de `/api/ad/*`. Docs:
   OPERATIONS.md (formato, ACL icacls, migración) + changelog.d.
   Motivo: tarea del responsable pendiente desde la ronda 2 y contrato
   explícito de SEG-B que desbloquea su auditoría y la pantalla de
   ajustes AD-6/SET-1 de IMP-B.
2. Fuera de alcance: AD-6/SET-1 (API de ajustes: ronda siguiente),
   REP-1 parte B (consola de IMP-B), sensor Rust (sin cargo aquí).
