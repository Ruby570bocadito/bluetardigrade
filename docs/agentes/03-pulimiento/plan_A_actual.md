# Plan de ronda — Pulimiento A (2026-10-06 07h47 UTC, ronda 12)

- **Contexto:** cuarta sesión de la jornada. La ronda 11 (reparo del
  Makefile + vet Windows + guardia de tabs) quedó PUBLICADA en
  `origin` (`9ee1594`) con el token efímero del responsable, push
  verificado con `git ls-remote`. «continua» del responsable autoriza
  esta ronda (tercera ronda extra sobre RONDAS_MAXIMAS=8).
  `origin/main` sigue en `35cd866` (ni mi rama ni IMP-A fusionadas):
  POL-1 (`api.go`) sigue reservada por IMP-A, `bc91c7d` sin fusionar.

## Trabajo encontrado al re-auditar los carriles

- Movimientos desde mi última auditoría: PUL-B `24c8b08` (CSP-nonce
  en consola, no toca Makefile), SEG-A `343358a` (docs), SEG-B
  `32cf10a→cf8997d` (docs). Cero solapamiento con mi territorio;
  `merge-tree` de mi tip contra main + 5 carriles: 6/6 CLEAN.
- Re-lectura COMPLETA de los informes de SEG ha destapado DOS ítems
  asignados a PUL-A que quedaron fuera de mis rondas anteriores:

## Tarea 1 — Punto 5 de SEG-B: `--ignore-scripts` en el harness de navegador

- SEG-B (ronda 2026-10-05 12h33, punto 5, asignado «Pulimiento A
  (decisión)»): `tools/console-tests` se instala en CI con
  `npm install` de paquetes fijados pero SIN `--ignore-scripts`; los
  scripts de ciclo de vida (el postinstall de esbuild) corren en el
  runner. Mitigación actual «razonable»; cerrarlo del todo es una
  línea por comando.
- **DECISIÓN: cerrarlo del todo.** Coste ~cero, cierra superficie de
  cadena de suministro en CI, y SEG-B me lo delega explícitamente.
  Territorio: `ci.yml` es infraestructura compartida que edito desde
  la ronda 2; las líneas nuevas de SEG-B (`check_package_lifecycle`
  en `Makefile:106-107`, workflow `deps-audit.yml`) NO se tocan.
- Cambio EXACTO: `--ignore-scripts` en los dos `npm install
  --prefix tools/console-tests` del job `console` + comentario que
  documente por qué es seguro (esbuild resuelve su binario vía la
  dependencia opcional de plataforma; jsdom es JS puro; el
  postinstall de playwright solo imprime un aviso — los navegadores
  los instala un paso explícito, que no es un lifecycle script).
- SEGURIDAD DE LA DECISIÓN, verificada ANTES de commitear: reproduzco
  la secuencia exacta de CI en local (`bun install --frozen-lockfile`
  en `web/console` + installs con `--ignore-scripts`): el check DOM
  pasa 34/34 con esbuild instalado sin scripts y el CLI de playwright
  (`cli.js --version` = 1.63.0, `chromium.executablePath()` resuelve)
  queda íntegro. El paso de navegador REAL no lo ejecuto en local
  (Chromium + deps del runner); lo documento como no ejecutado, no
  como pasado. Artefacto local del install (`package-lock.json`) se
  elimina antes de commitear (la guardia `check_package_lifecycle`
  de SEG-B lo detectó al vuelo: funciona).

## Tarea 2 — Punto 3 de SEG-B (fuzzing nocturno): respuesta documentada, SIN cambio de código

- SEG-B (roadmap_A, «Pendientes», punto 3) propone «a Pulimiento A un
  paso con `-fuzztime=5m` por objetivo y el corpus ya fijado en
  `testdata/`». Su rama parte de un estado anterior al mio: eso EXISTE
  desde mi ronda 5 (`54b0e80`): `bench-nightly.yml` descubre cada
  `func Fuzz*` (22 objetivos / 11 paquetes hoy), un job de matriz por
  objetivo, `go test -run '^$' -fuzz ... -fuzztime 5m`, y el corpus de
  fallo cae en `testdata/fuzz/` del paquete (rojo + reproductor
  preservado). Respuesta: anotarla en mi roadmap e informe apuntando a
  las líneas del workflow; nada que implementar.

## Pre-registro para SEG-B (nueva observación)

- Las recetas nuevas de SEG-B en SU rama (`check_package_lifecycle`
  en `Makefile:106-107`) están sangradas con ESPACIOS (heredan el
  Makefile roto por `63fa077`, que mi ronda 11 reconvirtió a TAB).
  Cuando las ramas converjan: conflicto de fusible o guardia roja de
  `check_makefile_tabs`. Mis filas del register ya lo anticipan;
  observación escrita en mi roadmap para que ellos usen TAB.

## Fuera de alcance (sin cambios)

- POL-1/run.go: siguen de IMP-A. `collector.rs`: sin `cargo` en el
  entorno. Caché de corpus nocturno: decisión del responsable. OpenAPI
  de IMP-A (`/api/ad/*`, `/api/stats`): territorio suyo hasta fusión.
  `tools/console-tests/package.json`+`bun.lock` del manifiesto de
  PUL-B: territorio suyo; mi cambio no los toca (cuando aterrice, el
  harness pasará a bun — bun ya bloquea lifecycle scripts no
  confiables por defecto, así que la decisión sigue siendo válida).

## Verificación prevista

Guardias completas del árbol (7 `check_*.py`, incluida la de SEG-B),
`check_workflows.py` tras editar YAML, batería Go completa (`gofmt
-l`, build, vet, `GOOS=windows go vet`, staticcheck, `go test -race
-count=1` = 37 paquetes), merge-tree post-commit contra main + 5
carriles, escaneo anti-credenciales del diff, push inmediato con
verificación `git ls-remote` (remoto == local).
