# Plan de ronda — Seguridad A (2026-10-06, ronda 13, ~09h25 Madrid)

Base: `f72a479` (mi ronda 12). `origin/main` sigue en `35cd866`.
Novedad al abrir: DOS carriles movieron.

- **PUL-B `24c8b08`**: publicó su ronda 5 — **CSP por nonce** en la
  consola (`proxy.ts` acuña nonce por petición, `layout.tsx` async,
  CSP estática fuera de `next.config.ts`, producción sin
  `'unsafe-inline'` en `script-src` con `'strict-dynamic'`), manifest
  del tooling de pruebas (`tools/console-tests/package.json` +
  `bun.lock`), guardia nueva `check_console_csp.mjs`. **Cero ficheros
  Go** (verificado por stat) — consola + scripts .mjs.
- **SEG-B `32cf10a`**: docs-only (plan, roadmap y DOS informes de
  ronda).
- Sin mover: IMP-A `bc91c7d` (mis 2 hallazgos de la ronda 11 siguen
  abiertos), IMP-B `5ecbcc4` (los 2 míos de la ronda 5, sexto aviso),
  PUL-A `df323ad`.

Tareas:

1. **Fuzzing vivo, tercera tanda** (pendiente 3 del roadmap): los 15
   objetivos aún sin sesión viva — `FuzzDecode`, `FuzzDecodeText`,
   `FuzzEnrollHost`, `FuzzFieldMapParity`, `FuzzHTMLAttribute`,
   `FuzzInspectAttachmentName`, `FuzzLoadIdentities`,
   `FuzzLoadRulesDir`, `FuzzLoadThreshold`, `FuzzMatchIdentity`,
   `FuzzOpenRegistry`, `FuzzParseRecordFilter`, `FuzzParseTimeParam`,
   `FuzzValidateHash`, `FuzzValidateIP` — 45-60 s cada uno. Si el
   presupuesto aprieta, priorizo los de entrada hostil (decode/
   enroll/HTML/attachment) sobre los de validación pura.
2. **Revisión del CSP-nonce de PUL-B** (feature de seguridad en
   producción — territorio natural de mi carril): `proxy.ts` (acuno,
   cabeceras, rotación, dev vs prod), `layout.tsx` async (lectura de
   `x-nonce`), `next.config.ts` (qué cabeceras quedan), la guardia
   `check_console_csp.mjs` (que no pruebe lo que no existe) y el
   manifest del tooling. Fix con prueba fail-before/pass-after por
   cada bug real encontrado; anotación si es consola ajena.
3. **Obligatorio de ronda**: ninguna punta movida toca Go esta vez
   (PUL-B consola + .mjs; SEG-B docs) → `-race` no aplica; evidencia
   de la ronda 12 vigente. Si el stat engaña, ejecuto.
4. **Lectura de los informes de SEG-B** (`32cf10a`, docs-only) por si
   anuncian hallazgos que me tocan.

Cierre: checklist CI completo en mi árbol, informe, roadmap, changelog
solo si hay fix mío; push tras `merge-tree` contra las cinco puntas.
