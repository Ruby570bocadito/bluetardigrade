# SEG — estado

## Hecho (últimas 24 h)
- Ronda 7, hallazgo ALTO corregido: main en rojo desde m7-wef-pack.
  f752040 subió internal/scenario/scenario.go con indentación de
  ESPACIOS en el fichero entero (464 líneas de churn alrededor de un
  cambio real de 3 líneas: TypeWindowsEvent en knownTypes) y el gate
  gofmt del lane engine (ci.yml:43-49, cero diffs) falla con ello. La
  API de runs no muestra nada anónimamente: dos días sin que nadie lo
  viera. Fix: gofmt -w del fichero (235/235 restauradas, cero líneas
  de código tocadas); gofmt -l . vacío, build/vet verde, tests -race
  de scenario/rules/threshold/model en verde.
- Resto del barrido de m7 sin hallazgos: las 4 reglas (DCSync 4662
  con GUIDs DRSUAPI y no-máquina, Kerberoasting 4769 RC4 0x17, grupos
  privilegiados 4728/4732/4756 con exclusión de cuentas máquina,
  7045 intérprete/ruta escribible) y thr-ad-spray (25 fallos/5min por
  IP origen) — doctrina de falsos positivos coherente con el pack de
  endpoint; contrato windows.event bien cerrado en la guía.

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones a otras zonas
- IMP-1: el tooling convirtió tabs→espacios entre m3 y m7 (yara.go
  entró correcto con tabs en m3; scenario.go llegó roto en m7).
  Revisar editor/formateador antes de que vuelva a ocurrir.
- DIR: este hallazgo merece fila en ALTA (gate de CI roto en main
  mientras m7 se daba por servida). Humano: rotar el PAT (sigue vivo
  desde la ronda 5) y verificar las runs en la UI — la API anónima
  no las expone.

## Propuestas para el roadmap
- El sensor lee las reglas sin tope (collect_sources, fs::read):
  read_capped ya existe en su propio scan — para IMP-1, sin prisa.
- sec2-dpapi y la regresión del PR #28: carril «Esperando al humano».

## Estado: VERDE
