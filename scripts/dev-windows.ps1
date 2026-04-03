param(
    [string]$NginxDir = "D:\works\package\nginx",
    [switch]$NoNginx,
    [switch]$NoFrontend
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-CommandExists {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Stop-PortProcess {
    param([int]$Port)
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($conns) {
            $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($pid in $pids) {
                if ($pid -and $pid -ne 0) {
                    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                }
            }
        }
    } catch {
        # ignore port cleanup failures
    }
}

function Wait-PortReady {
    param(
        [int]$Port,
        [int]$TimeoutSec = 60
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $ok = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue
            if ($ok.TcpTestSucceeded) {
                return $true
            }
        } catch {
            # ignore transient failures
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Wait-PortClosed {
    param(
        [int]$Port,
        [int]$TimeoutSec = 20
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if (-not $conn) {
            return $true
        }
        Start-Sleep -Milliseconds 300
    }
    return $false
}

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"
$LogsDir = Join-Path $ProjectRoot "logs"
$TempDir = Join-Path $ProjectRoot "temp"
$FrontendPort = 3000
$GatewayPort = 8012

Write-Step "Preparing directories"
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
@(
    "client_body_temp",
    "proxy_temp",
    "fastcgi_temp",
    "uwsgi_temp",
    "scgi_temp"
) | ForEach-Object {
    New-Item -ItemType Directory -Force -Path (Join-Path $TempDir $_) | Out-Null
}

Write-Step "Checking required commands"
foreach ($cmd in @("uv", "npm")) {
    if (-not (Test-CommandExists $cmd)) {
        throw "Missing required command: $cmd"
    }
}

if (-not $NoNginx) {
    $nginxExe = Join-Path $NginxDir "nginx.exe"
    if (-not (Test-Path $nginxExe)) {
        throw "nginx.exe not found: $nginxExe"
    }
}

Write-Step "Ensuring config files exist"
if (-not (Test-Path (Join-Path $ProjectRoot "config.yaml"))) {
    Copy-Item (Join-Path $ProjectRoot "config.example.yaml") (Join-Path $ProjectRoot "config.yaml")
}
if (-not (Test-Path (Join-Path $ProjectRoot ".env"))) {
    Copy-Item (Join-Path $ProjectRoot ".env.example") (Join-Path $ProjectRoot ".env")
}
if (-not (Test-Path (Join-Path $FrontendDir ".env"))) {
    Copy-Item (Join-Path $FrontendDir ".env.example") (Join-Path $FrontendDir ".env")
}

Write-Step "Cleaning stale LangGraph temp files"
$langgraphStateDir = Join-Path $BackendDir ".langgraph_api"
if (Test-Path $langgraphStateDir) {
    Get-ChildItem -Path $langgraphStateDir -Filter "*.tmp" -File -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

Write-Step "Stopping old processes on ports 2024/$GatewayPort/$FrontendPort/2026"
Stop-PortProcess -Port 2024
Stop-PortProcess -Port $GatewayPort
Stop-PortProcess -Port $FrontendPort
Stop-PortProcess -Port 2026
Get-Process -Name nginx -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$null = Wait-PortClosed -Port 2024 -TimeoutSec 20
$null = Wait-PortClosed -Port $GatewayPort -TimeoutSec 20
$null = Wait-PortClosed -Port $FrontendPort -TimeoutSec 20
$null = Wait-PortClosed -Port 2026 -TimeoutSec 20

$pyExe = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $pyExe)) {
    throw "Python venv not found: $pyExe (run: cd backend; uv sync)"
}

$internalEventsSecret = $env:INTERNAL_EVENTS_SECRET
if ([string]::IsNullOrWhiteSpace($internalEventsSecret)) {
    $envCandidates = @(
        (Join-Path $BackendDir ".env"),
        (Join-Path $ProjectRoot ".env")
    )
    foreach ($p in $envCandidates) {
        if (Test-Path $p) {
            $m = Select-String -Path $p -Pattern '^INTERNAL_EVENTS_SECRET\s*=' -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($m) {
                $internalEventsSecret = ($m.Line -split '=', 2)[1].Trim()
                break
            }
        }
    }
}

Write-Step "Starting LangGraph (2024)"
# Use `python -m langgraph_cli` — on some Windows setups `uv run` / console_scripts hit "Failed to canonicalize script path".
# langgraph dev defaults N_JOBS_PER_WORKER to 1 unless --n-jobs-per-worker is passed (see langgraph_api.cli patch_environment).
$nJobsPerWorker = $env:N_JOBS_PER_WORKER
if ([string]::IsNullOrWhiteSpace($nJobsPerWorker)) {
    foreach ($p in @((Join-Path $BackendDir ".env"), (Join-Path $ProjectRoot ".env"))) {
        if (-not (Test-Path $p)) { continue }
        $m = Select-String -Path $p -Pattern '^\s*N_JOBS_PER_WORKER\s*=' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) {
            $nJobsPerWorker = ($m.Line -split '=', 2)[1].Trim()
            break
        }
    }
}
if ([string]::IsNullOrWhiteSpace($nJobsPerWorker)) { $nJobsPerWorker = '10' }
Write-Host "  N_JOBS_PER_WORKER (LangGraph): $nJobsPerWorker" -ForegroundColor DarkGray
$gatewayBase = "http://127.0.0.1:$GatewayPort"
$pythonPathValue = "$BackendDir;$BackendDir\\packages\\harness"
$langgraphEventsEnv = "`$env:DEERFLOW_GATEWAY_URL='$gatewayBase'; "
# Isolate run event loops to avoid one long/blocking run stalling all queued runs.
$langgraphEventsEnv += "`$env:BG_JOB_ISOLATED_LOOPS='true'; "
if (-not [string]::IsNullOrWhiteSpace($internalEventsSecret)) {
    $escapedLg = ($internalEventsSecret -replace "'", "''")
    $langgraphEventsEnv += "`$env:INTERNAL_EVENTS_SECRET='$escapedLg'; "
}
$langgraph = Start-Process powershell -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", "cd '$BackendDir'; `$env:PYTHONPATH='$pythonPathValue'; $langgraphEventsEnv & '$pyExe' -m langgraph_cli dev --no-browser --allow-blocking --no-reload --n-jobs-per-worker $nJobsPerWorker"
) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $LogsDir "langgraph.log") -RedirectStandardError (Join-Path $LogsDir "langgraph.err.log")

#
# Ensure internal SSE broadcast secret is present inside the gateway process.
# `load_dotenv()` in `deerflow.config.app_config` may load from the gateway working
# directory (`backend/`), and `Start-Process` environment inheritance can be flaky.
# So we explicitly forward it (when provided) into the uvicorn process.
#
$gatewayInternalEventsEnv = ""
if (-not [string]::IsNullOrWhiteSpace($internalEventsSecret)) {
    $escaped = ($internalEventsSecret -replace "'", "''")
    $gatewayInternalEventsEnv = "`$env:INTERNAL_EVENTS_SECRET='$escaped'; "
}

Write-Step "Starting Gateway ($GatewayPort)"
$gateway = Start-Process powershell -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", "cd '$BackendDir'; `$env:PYTHONPATH='$pythonPathValue'; $gatewayInternalEventsEnv & '$pyExe' -m uvicorn app.gateway.app:app --host 0.0.0.0 --port $GatewayPort --reload --reload-include='*.yaml' --reload-include='.env'"
) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $LogsDir "gateway.log") -RedirectStandardError (Join-Path $LogsDir "gateway.err.log")

if (-not $NoFrontend) {
    Write-Step "Starting Frontend ($FrontendPort)"
    $frontend = Start-Process powershell -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command", "cd '$FrontendDir'; `$env:PORT='$FrontendPort'; npm run dev"
    ) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $LogsDir "frontend.log") -RedirectStandardError (Join-Path $LogsDir "frontend.err.log")
} else {
    Write-Step "Skipping Frontend (NoFrontend)"
    $frontend = $null
}

$nginx = $null
if (-not $NoNginx) {
    Write-Step "Starting Nginx (2026)"
    $nginx = Start-Process powershell -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command", "`$env:Path='$NginxDir;'+`$env:Path; nginx -g 'daemon off;' -c '$ProjectRoot/docker/nginx/nginx.local.conf' -p '$ProjectRoot'"
    ) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $LogsDir "nginx.log") -RedirectStandardError (Join-Path $LogsDir "nginx.err.log")
}

Write-Step "Waiting for ports"
$ok2024 = Wait-PortReady -Port 2024 -TimeoutSec 90
$okGateway = Wait-PortReady -Port $GatewayPort -TimeoutSec 90
$okFrontend = $true
if (-not $NoFrontend) {
    $okFrontend = Wait-PortReady -Port $FrontendPort -TimeoutSec 120
}
$ok2026 = $true
if (-not $NoNginx) {
    $ok2026 = Wait-PortReady -Port 2026 -TimeoutSec 30
}

Write-Host ""
Write-Host "DeerFlow (Windows) startup result:" -ForegroundColor Green
Write-Host "  2024 LangGraph: $ok2024"
Write-Host "  $GatewayPort Gateway:   $okGateway"
if (-not $NoFrontend) {
    Write-Host "  $FrontendPort Frontend:  $okFrontend"
} else {
    Write-Host "  $FrontendPort Frontend:  (skipped)"
}
if (-not $NoNginx) {
    Write-Host "  2026 Nginx:     $ok2026"
}
Write-Host ""
Write-Host "PIDs:"
Write-Host "  LangGraph: $($langgraph.Id)"
Write-Host "  Gateway:   $($gateway.Id)"
if (-not $NoFrontend) {
    Write-Host "  Frontend:  $($frontend.Id)"
}
if ($nginx) {
    Write-Host "  Nginx:     $($nginx.Id)"
}
Write-Host ""
Write-Host "URLs:"
if (-not $NoNginx) {
    Write-Host "  App:       http://localhost:2026"
}
if (-not $NoFrontend) {
    Write-Host "  Frontend:  http://localhost:$FrontendPort"
}
Write-Host "  LangGraph: http://localhost:2024"
Write-Host "  Gateway:   http://localhost:$GatewayPort"
Write-Host ""
Write-Host "Logs folder: $LogsDir"
