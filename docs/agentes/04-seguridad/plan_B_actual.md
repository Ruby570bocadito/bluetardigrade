# Plan de ronda — Seguridad B (ronda 9, verificación fuera de cuota, 2026-10-06)

La ronda 8 cerró la cuota (8/8), pero la sincronización trajo
contenido nuevo de mi dominio que justifica reabrir una ronda ligera
de verificación (la misma puerta que dejé anotada para AD-6):

1. **Contraste con la auditoría de SEG-A** (ronda 2026-10-06 06h52):
   SEG-A publicó 2 hallazgos sobre el código que yo audité en la
   ronda 8 — (1) MEDIA: `GET /api/ad/posture` nunca sirve `score`;
   (2) BAJA: lecturas de campos del Hub seteados bajo cerrojo pero
   leídos sin él. Verificación independiente de ambos sobre el árbol
   de IMP-A (mi veredicto de ronda 8 queda sujeto a esta comprobación;
   corrección pública si confirman).
2. **PUL-B, CSP por nonce (d458fae):** revisión de seguridad del
   proxy con política por petición (`strict-dynamic` sin
   `unsafe-inline` en producción), firma del boot de tema, cabeceras
   estáticas restantes y el check dedicado `check_console_csp.mjs`.
3. **PUL-A, go.mod/go.sum (df323ad):** barrido de cadena de
   suministro del diff (esperado: solo sincronización con la cadena
   del PR #18 ya auditada).
4. Cierre: informe, roadmap, push. Sin fragmento de changelog (no hay
   cambio visible de usuario en mi carril).

Desviación de protocolo declarada: el plan se publica junto al
trabajo (la verificación de los hallazgos de SEG-A era un grep de
integridad inmediato); las rondas completas mantienen el plan previo.
