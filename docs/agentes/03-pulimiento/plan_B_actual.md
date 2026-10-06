# Plan de ronda — Pulimiento B (2026-10-06, 10:35 Madrid, ronda 7)

Base: `carril/pulimiento-b` `849ef4e` (ronda 6); `origin/main` sigue en
`35cd866`. Estado leído: IMP-B cerró su ronda 7 (AD-5 «Directorio»,
SET-3, arreglos label-in-name y **dos reconciliaciones con mi carril**,
la última con mi CSP por nonce); SEG-A ronda 15 en marcha (rondas 13-14
cerradas: fuzzing live 24/24, fix decodeText); SEG-B ronda 12 (adopta
la reparación de tabs del Makefile de PUL-A); PUL-A con pre-flight de
fusión sobre árboles simulados.

## Tareas cogidas

1. **Guardia sobre la ronda 7 de IMP-B** (cola del roadmap, punto 3):
   pase de guardia de solo lectura sobre su árbol fusionado — azules
   crudos fuera de tokens de datos, hex literales, disciplina POL-11 en
   la vista «Directorio» nueva, integridad de mis gates tras sus dos
   reconciliaciones (`shell.tsx`, `layout.tsx`, `entity-graph.tsx`), y
   checker de temas contra su árbol.
2. **Pronóstico de fusión de mi ronda 6** hacia su línea (su árbol solo
   llega al plan `24c8b08`): confirmar cero conflictos y que mis cuatro
   reactbits corregidos no colisionan con sus cambios.

## No toca

Código de la consola esta ronda (guardia de solo lectura; si hubiera
hallazgo, solo ficheros de este carril); `ci.yml`/Makefile (PUL-A);
`web/console-service` (SEG-B); Go/sensor (IMP-A/SEG-A).

## Coordinación

- IMP-B: su retoque en `entity-graph.tsx` fue declarado y es quirúrgico
  (nombre accesible); verificado que conserva mi gate de movimiento.
  Mi ronda 6 no tocó ese fichero: sin colisión.
- PUL-A: su pre-flight de fusiones es el paso formal antes de cualquier
  integración; mis pronósticos quedan anotados en el informe como
  input, no como sustituto.
