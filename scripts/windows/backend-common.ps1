# Shared helpers for DeerFlow backend (LangGraph + Gateway) on Windows.
# Port roles in this repo:
#   1420 — Tauri 桌面开发时加载的前端地址 (deerpanel/src-tauri/tauri.conf.json devUrl)，即「桌面 Web」入口
#   1421 — Vite 默认端口 (deerpanel/vite.config.js)；strictPort=false 时可能被占用后顺延到 1422、1423…
#   8012 — FastAPI Gateway (REST/SSE 等 /api 非 langgraph)
#   2024 — LangGraph dev API（对话流式 /threads/.../runs/stream 等由前端代理到此端口）

function Initialize-DeerFlowBackendPaths {
    param(
        [Parameter(Mandatory = $true)]
        [string] $RepoRoot
    )
    $script:DFRepoRoot = (Resolve-Path $RepoRoot).Path
    $script:DFBackendDir = Join-Path $script:DFRepoRoot "backend"
    $script:DFLogsDir = Join-Path $script:DFRepoRoot "logs"
    $script:DFTempDir = Join-Path $script:DFRepoRoot "temp"
    $script:DFGatewayPort = 8012
    $script:DFLangGraphPort = 2024
    $script:DFDeerPanelWebPorts = @(1420, 1421)
}

function Test-DeerFlowCommandExists {
    param([string] $Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Stop-DeerFlowPortProcess {
    param([int] $Port)
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($conns) {
            $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($procId in $pids) {
                if ($procId -and $procId -ne 0) {
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                }
            }
        }
    } catch {
        # ignore
    }
}

function Wait-DeerFlowPortClosed {
    param(
        [int] $Port,
        [int] $TimeoutSec = 20
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

function Wait-DeerFlowPortReady {
    param(
        [int] $Port,
        [int] $TimeoutSec = 60
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $ok = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue
            if ($ok.TcpTestSucceeded) {
                return $true
            }
        } catch {
            # ignore
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Stop-DeerFlowBackend {
    Write-Host ""
    Write-Host "==> Stopping backend: LangGraph (:$script:DFLangGraphPort) + Gateway (:$script:DFGatewayPort)" -ForegroundColor Yellow
    Stop-DeerFlowPortProcess -Port $script:DFLangGraphPort
    Stop-DeerFlowPortProcess -Port $script:DFGatewayPort
    $null = Wait-DeerFlowPortClosed -Port $script:DFLangGraphPort -TimeoutSec 20
    $null = Wait-DeerFlowPortClosed -Port $script:DFGatewayPort -TimeoutSec 20
    Write-Host "    Ports released (or were already free)." -ForegroundColor DarkGray
}

function Read-DeerFlowInternalEventsSecret {
    $secret = $env:INTERNAL_EVENTS_SECRET
    if (-not [string]::IsNullOrWhiteSpace($secret)) {
        return $secret
    }
    foreach ($p in @(
            (Join-Path $script:DFBackendDir ".env"),
            (Join-Path $script:DFRepoRoot ".env")
        )) {
        if (-not (Test-Path $p)) { continue }
        $m = Select-String -Path $p -Pattern '^INTERNAL_EVENTS_SECRET\s*=' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) {
            return ($m.Line -split '=', 2)[1].Trim()
        }
    }
    return $null
}

function Read-DeerFlowNJobsPerWorker {
    $v = $env:N_JOBS_PER_WORKER
    if (-not [string]::IsNullOrWhiteSpace($v)) {
        return $v.Trim()
    }
    foreach ($p in @(
            (Join-Path $script:DFBackendDir ".env"),
            (Join-Path $script:DFRepoRoot ".env")
        )) {
        if (-not (Test-Path $p)) { continue }
        $m = Select-String -Path $p -Pattern '^\s*N_JOBS_PER_WORKER\s*=' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) {
            return ($m.Line -split '=', 2)[1].Trim()
        }
    }
    return "10"
}

function Start-DeerFlowBackend {
    $pyExe = Join-Path $script:DFBackendDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $pyExe)) {
        throw "Python venv not found: $pyExe (run: cd backend; uv sync)"
    }

    New-Item -ItemType Directory -Force -Path $script:DFLogsDir | Out-Null

    $langgraphStateDir = Join-Path $script:DFBackendDir ".langgraph_api"
    if (Test-Path $langgraphStateDir) {
        Get-ChildItem -Path $langgraphStateDir -Filter "*.tmp" -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }

    $internalEventsSecret = Read-DeerFlowInternalEventsSecret
    $nJobsPerWorker = Read-DeerFlowNJobsPerWorker
    Write-Host "  N_JOBS_PER_WORKER (LangGraph): $nJobsPerWorker" -ForegroundColor DarkGray

    $gatewayBase = "http://127.0.0.1:$($script:DFGatewayPort)"
    $pythonPathValue = "$($script:DFBackendDir);$($script:DFBackendDir)\packages\harness"

    $langgraphEventsEnv = "`$env:DEERFLOW_GATEWAY_URL='$gatewayBase'; "
    $langgraphEventsEnv += "`$env:BG_JOB_ISOLATED_LOOPS='true'; "
    if (-not [string]::IsNullOrWhiteSpace($internalEventsSecret)) {
        $escapedLg = ($internalEventsSecret -replace "'", "''")
        $langgraphEventsEnv += "`$env:INTERNAL_EVENTS_SECRET='$escapedLg'; "
    }

    Write-Host ""
    Write-Host "==> Starting LangGraph (:$($script:DFLangGraphPort))" -ForegroundColor Cyan
    $langgraph = Start-Process powershell -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        "cd '$($script:DFBackendDir)'; `$env:PYTHONPATH='$pythonPathValue'; $langgraphEventsEnv & '$pyExe' -m langgraph_cli dev --no-browser --allow-blocking --no-reload --n-jobs-per-worker $nJobsPerWorker"
    ) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $script:DFLogsDir "langgraph.log") -RedirectStandardError (Join-Path $script:DFLogsDir "langgraph.err.log")

    $cors = ($script:DFDeerPanelWebPorts | ForEach-Object { "http://localhost:$_" }) -join ","
    $gatewayInternalEventsEnv = "`$env:CORS_ORIGINS='$cors'; "
    if (-not [string]::IsNullOrWhiteSpace($internalEventsSecret)) {
        $escaped = ($internalEventsSecret -replace "'", "''")
        $gatewayInternalEventsEnv += "`$env:INTERNAL_EVENTS_SECRET='$escaped'; "
    }

    Write-Host "==> Starting Gateway (:$($script:DFGatewayPort))" -ForegroundColor Cyan
    Write-Host "    CORS_ORIGINS (desktop web): $cors" -ForegroundColor DarkGray
    $gateway = Start-Process powershell -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        "cd '$($script:DFBackendDir)'; `$env:PYTHONPATH='$pythonPathValue'; $gatewayInternalEventsEnv & '$pyExe' -m uvicorn app.gateway.app:app --host 0.0.0.0 --port $($script:DFGatewayPort) --reload --reload-include='*.yaml' --reload-include='.env'"
    ) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $script:DFLogsDir "gateway.log") -RedirectStandardError (Join-Path $script:DFLogsDir "gateway.err.log")

    Write-Host ""
    Write-Host "==> Waiting for ports..." -ForegroundColor Cyan
    $okLg = Wait-DeerFlowPortReady -Port $script:DFLangGraphPort -TimeoutSec 90
    $okGw = Wait-DeerFlowPortReady -Port $script:DFGatewayPort -TimeoutSec 90

    Write-Host ""
    Write-Host "Backend startup result:" -ForegroundColor Green
    Write-Host "  LangGraph ($($script:DFLangGraphPort)): $okLg"
    Write-Host "  Gateway   ($($script:DFGatewayPort)): $okGw"
    Write-Host ""
    Write-Host "PIDs: LangGraph=$($langgraph.Id) Gateway=$($gateway.Id)"
    Write-Host "Logs: $($script:DFLogsDir)"
    Write-Host ""
    Write-Host "Desktop web (Tauri devUrl): http://localhost:$($script:DFDeerPanelWebPorts[0]) — start separately: scripts\windows\start-deerpanel-web.ps1" -ForegroundColor DarkYellow
}

function Stop-DeerFlowDeerPanelWeb {
    Write-Host ""
    Write-Host "==> Stopping DeerPanel dev listeners (ports $($script:DFDeerPanelWebPorts -join ', '))" -ForegroundColor Yellow
    foreach ($p in $script:DFDeerPanelWebPorts) {
        Stop-DeerFlowPortProcess -Port $p
        $null = Wait-DeerFlowPortClosed -Port $p -TimeoutSec 15
    }
    Write-Host "    Done. (若 Vite 落在 1422+，请用任务管理器结束 node 或再执行一次带 -ExtraPorts)" -ForegroundColor DarkGray
}
