#!/usr/bin/env pwsh
# smoke_respond.ps1 - Smoke CONDUCTUAL de la respuesta activa C3 en
# Windows real (camino handle, R1 del dictamen 04-B 16h11). Es la
# condicion de cierre del paquete respond: el cross-check GOOS=windows
# de CI certifica COMPILACION; este smoke certifica CONDUCTA sobre un
# engine nativo de Windows con kills reales de procesos propios.
#
# Verifica (cada asercion puede fallar - "un check que no puede
# fallar, miente", ronda 13h30):
#   a. kill feliz        -> 200 (nunca 202, R7a) + status=executed +
#                           mechanism=handle + proceso MUERTO de verdad
#   b. sin token         -> 401 (el token es obligatorio en loopback)
#   c. operator fuera    -> 403 operator_not_allowed
#   d. host remoto       -> 403 host_mismatch (R3)
#   e. pid del engine    -> 403 self_protected + el engine sigue vivo
#   f. nombre equivocado -> 403 pid_mismatch (la victima sobrevive)
#   g. protegido R6      -> 403 process_protected con un SEBO en temp
#                           llamado csrss.exe (copia de cmd.exe propia;
#                           nunca se toca el csrss real del host)
#   h. cooldown          -> 429 en el 2o kill del mismo pid
#   i. idempotencia      -> 409 con clave repetida
#   j. audit JSONL       -> cada linea parsea; resolved_name presente
#                           (O1 re-revision 17h35); codigos de denegacion
#                           registrados; fallback_reason ausente (el
#                           camino handle no tiene degradacion)
#   k. sin -allow-kill   -> 404 REAL (la superficie no existe)
#
# Uso:
#   pwsh scripts/windows/smoke_respond.ps1
#   pwsh scripts/windows/smoke_respond.ps1 -Engine ./engine-smoke.exe
#
# Requiere: PowerShell 7 (pwsh, por -SkipHttpErrorCheck), go para
# compilar si no hay -Engine, y los puertos de prueba libres.

param(
    [string]$Engine = "",
    [int]$IngestPort = 18227,
    [int]$ApiPort = 18228
)

$ErrorActionPreference = 'Stop'

$REPO = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
$API_BASE = "http://127.0.0.1:$ApiPort"
$API_DISARM_BASE = "http://127.0.0.1:$($ApiPort + 10)"
$TOKEN = "smoke-respond-token"

$script:PASS = 0
$script:FAIL = 0
function Check([string]$Name, [bool]$Cond) {
    if ($Cond) { Write-Host "  OK  - $Name"; $script:PASS++ }
    else       { Write-Host "  FAIL- $Name"; $script:FAIL++ }
}

# ---- preflight ------------------------------------------------------
if (-not $Engine) {
    Write-Host "* compilando engine (no hay -Engine)..."
    Push-Location $REPO
    try {
        go build -o (Join-Path $env:TEMP "sf-engine-smoke.exe") ./cmd/engine
        if ($LASTEXITCODE -ne 0) { throw "go build fallo" }
    } finally { Pop-Location }
    $Engine = (Join-Path $env:TEMP "sf-engine-smoke.exe")
}
if (-not (Test-Path $Engine)) { throw "engine no encontrado: $Engine" }

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("sf-smoke-respond-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
$OPS = Join-Path $tmp "respond-operators.yaml"
$AUDIT = Join-Path $tmp "respond-audit.jsonl"
$PIDFILE = Join-Path $tmp "engine.pid"

$engines = @()      # procesos engine a parar al salir
$decoys = @()       # procesos propios que deben SOBREVIVIR (se paran en cleanup)
function Cleanup {
    foreach ($p in $script:decoys) { try { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } } catch {} }
    foreach ($p in $script:engines) { try { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } } catch {} }
    if ($env:SF_SMOKE_KEEP -ne "1") { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}

# hostname real del host (el guard R3 compara contra el del engine)
$HOSTNAME_SMOKE = $env:COMPUTERNAME

function Start-Engine([string]$Tag, [bool]$Armed) {
    # el engine desarmado va en puertos +10 (paridad con el e2e de la
    # casa) y SIN -pidfile/-respond-audit: no debe tocar el estado del
    # armado (el pidfile es la superficie del self_protected del
    # escenario e; si el desarmado lo reescribiera, el guard del
    # engine ARMADO no veria su propio pid y el smoke mataria al
    # engine equivocado).
    # REDIRECCION POR-ENGINE (lección del primer run conductual, CI
    # dff85fd): los dos engines NO comparten ficheros de log — la
    # segunda apertura del mismo fichero trunca/compite con el stream
    # del primero y la salida del desarmado se pierde sin rastro (el
    # e2e de la casa lo evita igual: LOG vs LOG_DISARM).
    $iport = $IngestPort
    $aport = $ApiPort
    if (-not $Armed) {
        # +10: el desarmado en sus PROPIOS puertos (el guard de
        # arranque del engine detecta otro listener en el mismo puerto
        # y se niega con exit 0 limpio — el run 36745820153 lo grito:
        # "another engine instance is already running" con los puertos
        # del ARMADO, porque este smoke le paso esos literalmente).
        $iport = $IngestPort + 10
        $aport = $ApiPort + 10
    }
    $eargs = @("run", "-addr", "127.0.0.1:$iport", "-api", "127.0.0.1:$aport",
        "-rules", (Join-Path $REPO "rules"), "-api-token", $TOKEN)
    if ($Armed) {
        $eargs += @("-allow-kill", "-respond-operators", $OPS,
            "-respond-audit", $AUDIT, "-pidfile", $PIDFILE)
    }
    $outLog = Join-Path $tmp "engine-$Tag.out"
    $errLog = Join-Path $tmp "engine-$Tag.err"
    $p = Start-Process -FilePath $Engine -ArgumentList $eargs -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $script:engines += $p
    return $p
}

function Wait-Health([string]$Base, [string]$Tag, $proc) {
    for ($i = 0; $i -lt 75; $i++) {
        if ($proc.HasExited) {
            Write-Host "FALLO: el engine $Tag murio durante el arranque (exit $($proc.ExitCode))"
            Get-Content (Join-Path $tmp "engine-$Tag.err") -Tail 15 -ErrorAction SilentlyContinue | Write-Host
            Get-Content (Join-Path $tmp "engine-$Tag.out") -Tail 15 -ErrorAction SilentlyContinue | Write-Host
            return $false
        }
        try {
            $null = Invoke-WebRequest -Uri "$Base/api/health" -Method Get -TimeoutSec 2
            return $true
        } catch { Start-Sleep -Milliseconds 200 }
    }
    Write-Host "FALLO: el engine $Tag no levanto en 15s; su salida:"
    Get-Content (Join-Path $tmp "engine-$Tag.err") -Tail 15 -ErrorAction SilentlyContinue | Write-Host
    Get-Content (Join-Path $tmp "engine-$Tag.out") -Tail 15 -ErrorAction SilentlyContinue | Write-Host
    return $false
}

function Post-Kill([string]$Base, [hashtable]$Body, [bool]$WithToken) {
    $headers = @{ 'Content-Type' = 'application/json' }
    if ($WithToken) { $headers['Authorization'] = "Bearer $TOKEN" }
    $r = Invoke-WebRequest -Uri "$Base/api/respond/kill" -Method Post `
        -Headers $headers -Body ($Body | ConvertTo-Json -Compress) `
        -SkipHttpErrorCheck -TimeoutSec 10
    [pscustomobject]@{ code = [int]$r.StatusCode; body = $r.Content }
}

function New-Victim {
    # victima propia y desechable: ping largo contra loopback (nada
    # del host real es tocado; el kill recae siempre en procesos
    # que este smoke arranco)
    return Start-Process -FilePath "$env:SystemRoot\System32\ping.exe" `
        -ArgumentList '-n', '120', '127.0.0.1' -PassThru -WindowStyle Hidden
}

function Test-Alive($proc) {
    try { return -not (Get-Process -Id $proc.Id -ErrorAction Stop).HasExited } catch { return $false }
}

# Sondeo activo (directiva 23h55 §3.4: "esperas activas por sondeo en
# lugar de sleeps fijos"). Los sleeps fijos de 300/500/800 ms eran la
# clase de fragilidad de entorno que produce falsos fallos en un runner
# compartido bajo carga: 300 ms suelen sobrar en local y a veces NO
# sobran en un runner con el planificador saturado. Cada espera ahora
# sondea cada 50 ms con techo generoso; el techo sigue fallando ruido
# (un check que no puede fallar, miente), pero ya no depende de un
# número mágico de milisegundos.
function Wait-Alive($proc, [int]$TimeoutMs = 5000) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Alive $proc) { return $true }
        Start-Sleep -Milliseconds 50
    }
    return (Test-Alive $proc)
}

function Wait-Dead($proc, [int]$TimeoutMs = 5000) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not (Test-Alive $proc)) { return $true }
        Start-Sleep -Milliseconds 50
    }
    return (-not (Test-Alive $proc))
}

try {
    "version: 1`nnames:`n  - smoke-op" | Set-Content -Path $OPS -Encoding utf8NoBOM

    Write-Host "== arranque: engine armado + engine desarmado =="
    $eng = Start-Engine -Tag "armed" -Armed $true
    if (-not (Wait-Health $API_BASE "armed" $eng)) { throw "engine armado no levanto" }
    $engDisarm = Start-Engine -Tag "disarm" -Armed $false
    if (-not (Wait-Health $API_DISARM_BASE "disarm" $engDisarm)) { throw "engine desarmado no levanto" }

    # ---- a. kill feliz ----------------------------------------------
    Write-Host "== a. kill feliz: 200, mechanism=handle, proceso muerto =="
    $v1 = New-Victim
    # Toda victima se registra al nacer: si el smoke aborta antes de su
    # kill, Cleanup la recoge (Stop-Process sobre un pid muerto es no-op
    # con SilentlyContinue) — limpieza de huerfanos entre fases, directiva
    # 23h55 §3.4.
    $script:decoys += $v1
    if (-not (Wait-Alive $v1)) { throw "la victima v1 no arranco" }
    $res = Post-Kill $API_BASE @{
        host = $HOSTNAME_SMOKE; pid = $v1.Id; process_name = "ping.exe"
        operator = "smoke-op"; reason = "smoke happy path"
        rule_id = "smoke"; idempotency_key = "smoke-happy-1"
    } $true
    Check "HTTP 200 (R7a: sincronico, nunca 202)" ($res.code -eq 200)
    Check "status=executed en el cuerpo" ($res.body -like '*"status":"executed"*')
    Check "mechanism=handle en el cuerpo (R1 camino Windows)" ($res.body -like '*"mechanism":"handle"*')
    Check "fallback_reason AUSENTE (el handle no degrada)" (-not ($res.body -like '*fallback_reason*'))
    Check "el proceso murio de verdad (sondeo 5s)" (Wait-Dead $v1)

    # ---- b. sin token -----------------------------------------------
    Write-Host "== b. sin token -> 401 =="
    $res = Post-Kill $API_BASE @{
        host = $HOSTNAME_SMOKE; pid = 1; process_name = "x"
        operator = "smoke-op"; reason = "smoke sin token"
    } $false
    Check "HTTP 401 sin Authorization" ($res.code -eq 401)

    # ---- c. operator fuera de allowlist ------------------------------
    Write-Host "== c. operator fuera -> 403 operator_not_allowed =="
    $res = Post-Kill $API_BASE @{
        host = $HOSTNAME_SMOKE; pid = $v1.Id; process_name = "ping.exe"
        operator = "intruso"; reason = "smoke operator"
    } $true
    Check "HTTP 403 operator_not_allowed" (($res.code -eq 403) -and ($res.body -like '*operator_not_allowed*'))

    # ---- d. host remoto ----------------------------------------------
    Write-Host "== d. host remoto -> 403 host_mismatch (R3) =="
    $res = Post-Kill $API_BASE @{
        host = "HOST-REMOTO-DE-OTRO-SENSOR"; pid = $v1.Id; process_name = "ping.exe"
        operator = "smoke-op"; reason = "smoke replay"
    } $true
    Check "HTTP 403 host_mismatch" (($res.code -eq 403) -and ($res.body -like '*host_mismatch*'))

    # ---- e. pid del propio engine ------------------------------------
    Write-Host "== e. pid del engine -> 403 self_protected =="
    $enginePid = [int](Get-Content $PIDFILE | Select-Object -First 1)
    $res = Post-Kill $API_BASE @{
        host = $HOSTNAME_SMOKE; pid = $enginePid; process_name = "engine-smoke.exe"
        operator = "smoke-op"; reason = "smoke suicidio"
    } $true
    Check "HTTP 403 self_protected" (($res.code -eq 403) -and ($res.body -like '*self_protected*'))
    Check "el engine sigue vivo" ($null -ne (Get-Process -Id $enginePid -ErrorAction SilentlyContinue))

    # ---- f. nombre equivocado (pid_mismatch) --------------------------
    Write-Host "== f. nombre equivocado -> 403 pid_mismatch, victima sobrevive =="
    $v2 = New-Victim
    $script:decoys += $v2
    if (-not (Wait-Alive $v2)) { throw "la victima v2 no arranco" }
    $res = Post-Kill $API_BASE @{
        host = $HOSTNAME_SMOKE; pid = $v2.Id; process_name = "definitivamente-no-ping.exe"
        operator = "smoke-op"; reason = "smoke mismatch"
    } $true
    Check "HTTP 403 pid_mismatch" (($res.code -eq 403) -and ($res.body -like '*pid_mismatch*'))
    Check "la victima sobrevive al mismatch" (Test-Alive $v2)
    $script:decoys += $v2

    # ---- g. protegido por defecto R6 (sebo csrss.exe) ----------------
    Write-Host "== g. protegido R6 -> 403 process_protected (sebo propio) =="
    $decoyPath = Join-Path $tmp "csrss.exe"
    Copy-Item "$env:SystemRoot\System32\cmd.exe" $decoyPath -Force
    $decoy = Start-Process -FilePath $decoyPath -PassThru -WindowStyle Hidden
    $script:decoys += $decoy
    if (-not (Wait-Alive $decoy)) { throw "el sebo csrss.exe no arranco" }
    $res = Post-Kill $API_BASE @{
        host = $HOSTNAME_SMOKE; pid = $decoy.Id; process_name = "csrss.exe"
        operator = "smoke-op"; reason = "smoke protegido (sebo, no el real)"
    } $true
    Check "HTTP 403 process_protected" (($res.code -eq 403) -and ($res.body -like '*process_protected*'))
    Check "el sebo csrss.exe sobrevive (el guard nego antes de senialar)" (Test-Alive $decoy)

    # ---- h. cooldown --------------------------------------------------
    Write-Host "== h. cooldown -> 429 en el 2o kill del mismo pid =="
    $v3 = New-Victim
    $script:decoys += $v3
    if (-not (Wait-Alive $v3)) { throw "la victima v3 no arranco" }
    $res = Post-Kill $API_BASE @{
        host = $HOSTNAME_SMOKE; pid = $v3.Id; process_name = "ping.exe"
        operator = "smoke-op"; reason = "smoke cooldown 1"
    } $true
    Check "primer kill del pid: 200" ($res.code -eq 200)
    $res2 = Post-Kill $API_BASE @{
        host = $HOSTNAME_SMOKE; pid = $v3.Id; process_name = "ping.exe"
        operator = "smoke-op"; reason = "smoke cooldown 2"
    } $true
    Check "HTTP 429 cooldown_active" (($res2.code -eq 429) -and ($res2.body -like '*cooldown_active*'))

    # ---- i. idempotencia ----------------------------------------------
    Write-Host "== i. idempotencia -> 409 con clave repetida =="
    $v4 = New-Victim
    $script:decoys += $v4
    if (-not (Wait-Alive $v4)) { throw "la victima v4 no arranco" }
    $res = Post-Kill $API_BASE @{
        host = $HOSTNAME_SMOKE; pid = $v4.Id; process_name = "ping.exe"
        operator = "smoke-op"; reason = "smoke idem 1"; idempotency_key = "smoke-key-42"
    } $true
    Check "primer kill con la clave: 200" ($res.code -eq 200)
    $v5 = New-Victim
    $script:decoys += $v5
    $res2 = Post-Kill $API_BASE @{
        host = $HOSTNAME_SMOKE; pid = $v5.Id; process_name = "ping.exe"
        operator = "smoke-op"; reason = "smoke idem 2"; idempotency_key = "smoke-key-42"
    } $true
    Check "HTTP 409 idempotency_repeated" (($res2.code -eq 409) -and ($res2.body -like '*idempotency_repeated*'))

    # ---- j. audit JSONL -----------------------------------------------
    Write-Host "== j. audit JSONL: parseo, resolved_name, codigos, sin fallback_reason =="
    $auditOk = $true
    $rawAudit = ""
    try { $rawAudit = Get-Content $AUDIT -Raw -ErrorAction Stop } catch { $auditOk = $false }
    Check "el audit existe y tiene lineas" (($auditOk) -and (-not [string]::IsNullOrWhiteSpace($rawAudit)))
    if ($auditOk) {
        $lines = $rawAudit -split "`r?`n" | Where-Object { $_.Trim() -ne "" }
        $recs = @()
        $parseOk = $true
        foreach ($l in $lines) {
            try { $recs += ($l | ConvertFrom-Json) } catch { $parseOk = $false }
        }
        Check "cada linea parsea como JSON" $parseOk
        Check "todas las decisiones son executed|denied" (($recs | Where-Object { $_.decision -notin @("executed", "denied") } | Measure-Object).Count -eq 0)
        Check "todas las lineas llevan source y action_id (R5a)" (($recs | Where-Object { -not $_.source -or -not $_.action_id } | Measure-Object).Count -eq 0)
        $exec = @($recs | Where-Object { $_.decision -eq "executed" })
        Check "hay kills felices en el audit" ($exec.Count -ge 2)
        Check "los kills felices registran resolved_name=ping.exe (O1)" (($exec | Where-Object { $_.resolved_name -ne "ping.exe" } | Measure-Object).Count -eq 0)
        Check "la linea ejecutada lleva signal=SIGKILL (Q1)" (($exec | Where-Object { $_.signal -ne "SIGKILL" } | Measure-Object).Count -eq 0)
        Check "fallback_reason AUSENTE en todo el JSONL (camino handle)" (-not ($rawAudit -like '*fallback_reason*'))
        $codes = @($recs | Where-Object { $_.code } | ForEach-Object { $_.code } | Select-Object -Unique)
        $expected = @("operator_not_allowed", "host_mismatch", "self_protected",
            "pid_mismatch", "process_protected", "cooldown_active", "idempotency_repeated")
        $missing = @($expected | Where-Object { $_ -notin $codes })
        Check "las 7 denegaciones quedan en el audit" ($missing.Count -eq 0)
        if ($missing.Count -gt 0) { Write-Host "       faltan: $($missing -join ', ')" }
    }

    # ---- k. engine desarmado: 404 real --------------------------------
    Write-Host "== k. sin -allow-kill -> 404 real =="
    $res = Post-Kill $API_DISARM_BASE @{
        host = $HOSTNAME_SMOKE; pid = 1; process_name = "x"
        operator = "smoke-op"; reason = "smoke desarmado"
    } $true
    Check "HTTP 404 real (la ruta no existe)" ($res.code -eq 404)
    # el 404 no es un intento: la palabra-clave de su razon no puede
    # aparecer en el JSONL del engine armado (mismo criterio que el
    # e2e_respond_kill.sh de la casa)
    Check "el 404 del desarmado NO escribe audit" (-not ($rawAudit -like '*smoke desarmado*'))
}
finally {
    Cleanup
}

Write-Host ""
Write-Host "=== smoke_respond: $($script:PASS) OK / $($script:FAIL) FAIL ==="
if ($script:FAIL -gt 0) { exit 1 }
exit 0
