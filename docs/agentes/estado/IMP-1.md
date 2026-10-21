# IMP-1 — estado

## Hecho (últimas 24 h)
- O-2 (mitad endpoint): pack nuevo `rules/windows/active-directory.yaml`
  con 5 reglas — ticket Kerberos por SPN (T1558.003), tooling
  DCSync/DRSUAPI (T1003.006), rociado de contrasenas (T1110.003), alta en
  grupo con net.exe (T1098), servicio con interprete como binario
  (T1543.003). Total enviado: 119 reglas.
- Evidencia sintetica de disparo y silencio por regla en
  `internal/rules/active_directory_test.go` (solapes con hacktools/
  privilege-escalation documentados). Verificado en local: gofmt, build,
  vet, `go test -race ./internal/rules/`, guard de inventario en verde;
  OPERATIONS.md regenerado (artefacto generado del guard).
- El test de cobertura existente ya cazo dos defectos antes de pushear:
  " /add" final de linea y el interprete del launcher vs el binPath.

## En curso
- (nada)

## Bloqueado
- (nada)

## Peticiones
- A DIR: anotar en TODO.md la entrega parcial de O-2 (no toque TODO.md
  para no chocar con el ritual de IMP-2 en vuelo sobre el mismo fichero).
- A DIR: revisar OWNERSHIP — las entradas de changelog.d/ las anade quien
  entrega (precedente M-1 y esta entrega), no PUL.

## Propuestas para el roadmap
- Cuando M-7 (WEF) aterrice, ampliar el pack con las reglas por ID de
  evento (4625/4769/4662/4728/4732/4756/7045) sobre el nuevo tipo.
- Valorar senal para binarios con nombre propio que envuelvan
  interpretes (wrapper.exe -> powershell) via image load o linea padre.

## Estado: VERDE — riesgos
- Riesgo: "sc create" con binario propio en ruta legitima no alerta
  (decision de diseno anti-FP; lo cubre la telemetria del 7045 cuando
  llegue WEF).
