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
    $script:DFBackendConsolePidFile = Join-Path $script:DFTempDir "deerflow-backend-console-pids.txt"
    $script:DFGatewayPort = 8012
    $script:DFLangGraphPort = 2024
    $script:DFDeerPanelWebPorts = @(1420, 1421)
    New-Item -ItemType Directory -Force -Path $script:DFTempDir | Out-Null
}

function Test-DeerFlowCommandExists {
    param([string] $Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Stop-DeerFlowProcessTree {
    <#
      结束指定 PID 及其**子进程**（taskkill /T 不包含父进程）。
      使用 cmd 包裹 taskkill，避免在 $ErrorActionPreference=Stop 的脚本里触发 NativeCommandError。
      先 Stop-Process 再 taskkill，部分环境下更稳。
    #>
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return }
    try {
        Get-Process -Id $ProcessId -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    } catch { }
    $null = cmd.exe /c "taskkill /T /F /PID $ProcessId >nul 2>&1"
}

function Get-DeerFlowListeningPidsMap {
    <#
      一次 netstat + 按端口 Get-NetTCPConnection，避免每个端口重复扫全表（否则 stop 会卡很久且无输出）。
    #>
    param([int[]]$PortList)
    $sets = @{}
    foreach ($pt in $PortList) {
        $sets[$pt] = @{}
    }
    try {
        foreach ($line in @(netstat -ano 2>$null)) {
            if ($line -notmatch '(?i)LISTENING\s+(\d+)\s*$') { continue }
            if ($line -notmatch '(?i)^\s*TCP\s') { continue }
            $pidVal = [int]$Matches[1]
            if ($pidVal -le 0) { continue }
            foreach ($pt in $PortList) {
                if ($line -match ":$pt\s") {
                    $sets[$pt][$pidVal] = $true
                }
            }
        }
    } catch { }
    foreach ($pt in $PortList) {
        try {
            foreach ($c in @(Get-NetTCPConnection -LocalPort $pt -ErrorAction SilentlyContinue)) {
                if ($c.State -ne 'Listen') { continue }
                $oid = [int]$c.OwningProcess
                if ($oid -gt 0) { $sets[$pt][$oid] = $true }
            }
        } catch { }
    }
    $out = @{}
    foreach ($pt in $PortList) {
        $out[$pt] = @($sets[$pt].Keys)
    }
    return $out
}

function Get-DeerFlowListeningPidsOnPort {
    param([int]$Port)
    $m = Get-DeerFlowListeningPidsMap -PortList @($Port)
    $arr = $m[$Port]
    if ($null -eq $arr) { return @() }
    return @($arr)
}

function Stop-DeerFlowKillPortListenerRoots {
    <#
      uvicorn --reload：真正 Listen 的往往是 worker，父进程是 reload 监视器；对 worker 做 taskkill /T
      杀不到父进程，端口会立刻被拉起。沿父链向上找到 start-backend 用的「隐藏 powershell + -Command ... uvicorn/langgraph」
      后整树结束；找不到则仍杀监听 PID 树。
    #>
    param([int]$ListenPid)
    if ($ListenPid -le 0) { return }
    $p = $ListenPid
    for ($i = 0; $i -le 20; $i++) {
        $row = @(Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue)[0]
        if (-not $row) {
            Stop-DeerFlowProcessTree -ProcessId $ListenPid
            return
        }
        $name = [string]$row.Name
        $cl = [string]$row.CommandLine
        if (($name -match '(?i)powershell|pwsh') -and ($cl -match '(?i)uvicorn|langgraph_cli')) {
            Stop-DeerFlowProcessTree -ProcessId $p
            return
        }
        # uvicorn --reload：监听常在子进程 python 上，父链中间是「python -m uvicorn …」而非 powershell
        if (($name -match '(?i)^python(?:w)?\.exe$') -and ($cl -match '(?i)app\.gateway\.app:app')) {
            Stop-DeerFlowProcessTree -ProcessId $p
            return
        }
        $pp = [int]$row.ParentProcessId
        if ($pp -le 0 -or $pp -eq $p) { break }
        $p = $pp
    }
    Stop-DeerFlowProcessTree -ProcessId $ListenPid
}

function Stop-DeerFlowPortProcess {
    param([int] $Port)
    try {
        foreach ($listenPid in @(Get-DeerFlowListeningPidsOnPort -Port $Port)) {
            if ($listenPid -and $listenPid -ne 0) {
                Stop-DeerFlowKillPortListenerRoots -ListenPid $listenPid
            }
        }
    } catch {
        # ignore
    }
}

function Stop-DeerFlowPortsSweep {
    <#
      多轮清扫：每轮只跑 1 次 netstat（按端口集合），避免重复全表扫描。
      每轮末尾再用 Get-NetTCPConnection 按端口取 OwningProcess（与 netstat 互补，避免漏掉同端口多 PID）。
    #>
    param(
        [int[]]$Ports,
        [int]$MaxRounds = 10
    )
    for ($r = 0; $r -lt $MaxRounds; $r++) {
        $map = Get-DeerFlowListeningPidsMap -PortList $Ports
        foreach ($port in $Ports) {
            foreach ($procId in @($map[$port])) {
                if ($procId -and $procId -ne 0) {
                    Stop-DeerFlowKillPortListenerRoots -ListenPid $procId
                }
            }
        }
        foreach ($port in $Ports) {
            try {
                $extra = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                    ForEach-Object { [int]$_.OwningProcess } | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
                foreach ($procId in $extra) {
                    Stop-DeerFlowKillPortListenerRoots -ListenPid $procId
                }
            } catch { }
        }
        $map2 = Get-DeerFlowListeningPidsMap -PortList $Ports
        $still = $false
        foreach ($port in $Ports) {
            if (@($map2[$port]).Count -gt 0) {
                $still = $true
                break
            }
        }
        if (-not $still) { break }
        Start-Sleep -Milliseconds 200
    }
}

function Stop-DeerFlowBruteKillPortListeners {
    <#
      仅依赖 Get-NetTCPConnection，多轮杀 Listen 的 OwningProcess（reload 子进程反复拉起时用）。
    #>
    param(
        [int[]]$Ports,
        [int]$MaxRounds = 25,
        [int]$SleepMs = 300
    )
    for ($r = 0; $r -lt $MaxRounds; $r++) {
        $any = $false
        foreach ($port in $Ports) {
            try {
                $pids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                    ForEach-Object { [int]$_.OwningProcess } | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
                foreach ($procId in $pids) {
                    $any = $true
                    Stop-DeerFlowKillPortListenerRoots -ListenPid $procId
                }
            } catch { }
        }
        if (-not $any) { break }
        Start-Sleep -Milliseconds $SleepMs
    }
}

function Wait-DeerFlowPortsClosed {
    param(
        [int[]]$Ports,
        [int]$TimeoutSec = 8
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $m = Get-DeerFlowListeningPidsMap -PortList $Ports
        $open = $false
        foreach ($pt in $Ports) {
            if (@($m[$pt]).Count -gt 0) {
                $open = $true
                break
            }
        }
        if (-not $open) { return $true }
        Start-Sleep -Milliseconds 200
    }
    return $false
}

function Wait-DeerFlowPortClosed {
    param(
        [int] $Port,
        [int] $TimeoutSec = 8
    )
    return Wait-DeerFlowPortsClosed -Ports @($Port) -TimeoutSec $TimeoutSec
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

function Stop-DeerFlowCimKillByCommandLineRegex {
    <#
      仅枚举 python/powershell 等少量进程名上的 Win32_Process，避免「全机进程」CIM 扫描卡死数分钟。
    #>
    param(
        [string]$RegexPattern,
        [int]$MaxRounds = 3
    )
    $procNames = @('python.exe', 'pythonw.exe', 'powershell.exe', 'pwsh.exe')
    for ($r = 0; $r -lt $MaxRounds; $r++) {
        $hits = @()
        foreach ($pn in $procNames) {
            $hits += @(Get-CimInstance Win32_Process -Filter "Name = '$pn'" -ErrorAction SilentlyContinue |
                Where-Object { $_.CommandLine -and ($_.CommandLine -match $RegexPattern) })
        }
        if (-not $hits -or $hits.Count -eq 0) { break }
        foreach ($p in $hits) {
            $id = [int]$p.ProcessId
            if ($id -gt 0) {
                Stop-DeerFlowProcessTree -ProcessId $id
            }
        }
        Start-Sleep -Milliseconds 250
    }
}

function Stop-DeerFlowAllGatewayUvicornProcesses {
    <#
      多次重启会在 8012 上堆积多个 uvicorn。含 --reload 时需配合端口清扫杀父进程。
      匹配「-m uvicorn … app.gateway.app:app」与「uvicorn 在前」两种命令行，避免 CIM 扫不到。
    #>
    $port = [int]$script:DFGatewayPort
    if ($port -le 0) { $port = 8012 }
    Stop-DeerFlowCimKillByCommandLineRegex -RegexPattern '(?i)app\.gateway\.app:app' -MaxRounds 8
    Stop-DeerFlowCimKillByCommandLineRegex -RegexPattern ('(?i)app\.gateway\.app:app.*--port\s*{0}\b' -f $port) -MaxRounds 5
}

function Stop-DeerFlowAllLangGraphCliProcesses {
    <#
      start-backend: python -m langgraph_cli dev（仅扫相关进程名，避免全表 CIM）。
    #>
    Stop-DeerFlowCimKillByCommandLineRegex -RegexPattern '-m\s+langgraph_cli\s+dev|langgraph_cli(\.exe)?\s+dev' -MaxRounds 6
}

function Stop-DeerFlowBackend {
    Write-Host ""
    Write-Host "==> Stopping backend: LangGraph (:$script:DFLangGraphPort) + Gateway (:$script:DFGatewayPort)" -ForegroundColor Yellow

    $pidFile = $script:DFBackendConsolePidFile
    if (Test-Path -LiteralPath $pidFile) {
        Write-Host "  Stopping console sessions from PID file (same as closing the two DeerFlow windows)..." -ForegroundColor DarkGray
        foreach ($line in @(Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue)) {
            if ($line -match '^\s*langgraph_ps_pid=(\d+)\s*$') {
                Stop-DeerFlowProcessTree -ProcessId ([int]$Matches[1])
            }
            elseif ($line -match '^\s*gateway_ps_pid=(\d+)\s*$') {
                Stop-DeerFlowProcessTree -ProcessId ([int]$Matches[1])
            }
        }
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "  No PID file (windows were closed already or old run)." -ForegroundColor DarkGray
    }
    # 无论是否读过 PID 文件都要做：taskkill 偶发未清干净、或 Gateway 是以前手动起的孤儿进程
    Write-Host "  Command-line sweep (python/pwsh: langgraph + app.gateway uvicorn)..." -ForegroundColor DarkGray
    Stop-DeerFlowAllLangGraphCliProcesses
    Stop-DeerFlowAllGatewayUvicornProcesses

    $portsToSweep = @($script:DFLangGraphPort, $script:DFGatewayPort)
    if ($env:DEERFLOW_STOP_EXTRA_PORTS) {
        foreach ($part in $env:DEERFLOW_STOP_EXTRA_PORTS.Split(',')) {
            $px = 0
            if ([int]::TryParse($part.Trim(), [ref]$px) -and $px -gt 0) {
                if ($portsToSweep -notcontains $px) {
                    $portsToSweep += $px
                }
            }
        }
    }

    Write-Host "  Port sweep (orphans / old hidden runs): $($portsToSweep -join ', ')..." -ForegroundColor DarkGray
    Stop-DeerFlowPortsSweep -Ports $portsToSweep -MaxRounds 12
    $null = Wait-DeerFlowPortsClosed -Ports $portsToSweep -TimeoutSec 5

    $left = @()
    $finalMap = Get-DeerFlowListeningPidsMap -PortList $portsToSweep
    foreach ($p in $portsToSweep) {
        $rest = @($finalMap[$p])
        if ($rest.Count -gt 0) {
            $left += "port $p -> PID(s) $($rest -join ', ')"
        }
    }
    if ($left.Count -gt 0) {
        Write-Host "  Second pass: brute NetTCP listener cleanup (reload / stacked uvicorn)..." -ForegroundColor DarkGray
        Stop-DeerFlowBruteKillPortListeners -Ports $portsToSweep -MaxRounds 25 -SleepMs 300
        $null = Wait-DeerFlowPortsClosed -Ports $portsToSweep -TimeoutSec 6
        $left = @()
        $finalMap = Get-DeerFlowListeningPidsMap -PortList $portsToSweep
        foreach ($p in $portsToSweep) {
            $rest = @($finalMap[$p])
            if ($rest.Count -gt 0) {
                $left += "port $p -> PID(s) $($rest -join ', ')"
            }
        }
    }
    if ($left.Count -gt 0) {
        Write-Warning "Some listener PIDs remain (other apps or need Admin). Details:"
        foreach ($x in $left) {
            Write-Warning ('  {0}' -f $x)
        }
        Write-Host '    Tip: set env DEERFLOW_STOP_EXTRA_PORTS=2026 for extra ports (e.g. dev-api Gateway).' -ForegroundColor DarkYellow
    } else {
        Write-Host "    Done. Ports free (or were already free)." -ForegroundColor DarkGray
    }
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

    $lgTitle = "DeerFlow LangGraph :$($script:DFLangGraphPort) [close window = stop]"
    $gwTitle = "DeerFlow Gateway :$($script:DFGatewayPort) [close window = stop]"

    Write-Host ""
    Write-Host "==> Opening LangGraph window (:$($script:DFLangGraphPort)) — log output is in that console" -ForegroundColor Cyan
    $lgCmd = "`$Host.UI.RawUI.WindowTitle = '$lgTitle'; cd '$($script:DFBackendDir)'; `$env:PYTHONPATH='$pythonPathValue'; $langgraphEventsEnv & '$pyExe' -m langgraph_cli dev --no-browser --allow-blocking --no-reload --n-jobs-per-worker $nJobsPerWorker"
    $langgraph = Start-Process powershell.exe -ArgumentList @(
        "-NoProfile",
        "-NoExit",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        $lgCmd
    ) -WindowStyle Normal -PassThru

    $cors = ($script:DFDeerPanelWebPorts | ForEach-Object { "http://localhost:$_" }) -join ","
    $gatewayInternalEventsEnv = "`$env:CORS_ORIGINS='$cors'; "
    if (-not [string]::IsNullOrWhiteSpace($internalEventsSecret)) {
        $escaped = ($internalEventsSecret -replace "'", "''")
        $gatewayInternalEventsEnv += "`$env:INTERNAL_EVENTS_SECRET='$escaped'; "
    }

    Write-Host "==> Opening Gateway window (:$($script:DFGatewayPort))" -ForegroundColor Cyan
    Write-Host "    CORS_ORIGINS (desktop web): $cors" -ForegroundColor DarkGray
    $gwCmd = "`$Host.UI.RawUI.WindowTitle = '$gwTitle'; cd '$($script:DFBackendDir)'; `$env:PYTHONPATH='$pythonPathValue'; $gatewayInternalEventsEnv & '$pyExe' -m uvicorn app.gateway.app:app --host 0.0.0.0 --port $($script:DFGatewayPort) --reload --reload-include='*.yaml' --reload-include='.env'"
    $gateway = Start-Process powershell.exe -ArgumentList @(
        "-NoProfile",
        "-NoExit",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        $gwCmd
    ) -WindowStyle Normal -PassThru

    @(
        "langgraph_ps_pid=$($langgraph.Id)",
        "gateway_ps_pid=$($gateway.Id)"
    ) | Set-Content -LiteralPath $script:DFBackendConsolePidFile -Encoding utf8

    Write-Host ""
    Write-Host "==> Waiting for ports (this window stays open)..." -ForegroundColor Cyan
    $okLg = Wait-DeerFlowPortReady -Port $script:DFLangGraphPort -TimeoutSec 90
    $okGw = Wait-DeerFlowPortReady -Port $script:DFGatewayPort -TimeoutSec 90

    Write-Host ""
    Write-Host "Backend startup result:" -ForegroundColor Green
    Write-Host "  LangGraph ($($script:DFLangGraphPort)): $okLg"
    Write-Host "  Gateway   ($($script:DFGatewayPort)): $okGw"
    Write-Host ""
    Write-Host "Console host PIDs (also in $($script:DFBackendConsolePidFile)):" -ForegroundColor DarkGray
    Write-Host "  LangGraph window PID=$($langgraph.Id)  Gateway window PID=$($gateway.Id)"
    Write-Host ""
    Write-Host "Stop: close both titled windows, OR run stop-backend.ps1" -ForegroundColor Yellow
    Write-Host "Optional file logs still work if you redirect yourself; default is live console only." -ForegroundColor DarkGray
    Write-Host "Desktop web (Tauri devUrl): http://localhost:$($script:DFDeerPanelWebPorts[0]) | start separately: scripts\windows\start-deerpanel-web.ps1" -ForegroundColor DarkYellow
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
