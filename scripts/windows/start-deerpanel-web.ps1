# Start DeerPanel: desktop shell uses Tauri loading http://localhost:1420 (see tauri.conf.json).
# - Tauri (default): npm run tauri dev - runs Vite + desktop window
# - Web only:        -WebOnly - browser only: npm run dev (Vite default port in vite.config.js, e.g. 1421)
param(
    [switch] $WebOnly
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "backend-common.ps1")
Initialize-DeerFlowBackendPaths -RepoRoot $RepoRoot
$DeerPanelDir = Join-Path $RepoRoot "deerpanel"

if (-not (Test-Path $DeerPanelDir)) {
    throw "deerpanel directory not found: $DeerPanelDir"
}

if (-not (Test-DeerFlowCommandExists "npm")) {
    throw "npm not found in PATH"
}

Write-Host ""
Write-Host "==> Starting DeerPanel (desktop web)" -ForegroundColor Cyan
Write-Host "    Repo: Tauri devUrl = http://localhost:1420" -ForegroundColor DarkGray
Write-Host "    Vite port: see deerpanel/vite.config.js (e.g. 1421)" -ForegroundColor DarkGray
$GwUrl = if ($env:DEERFLOW_GATEWAY_URL) { $env:DEERFLOW_GATEWAY_URL.Trim() } else { "http://127.0.0.1:8012" }
Write-Host "    Vite /api proxy target: $GwUrl (Gateway must be listening; Windows backend script uses 8012)" -ForegroundColor DarkYellow
Write-Host '    For make gateway on 8001, set: $env:DEERFLOW_GATEWAY_URL = "http://127.0.0.1:8001"' -ForegroundColor DarkGray
Write-Host ""

# Child session: assign env then run npm (avoid nested-quote parse errors in -ArgumentList)
$npmCmd = if ($WebOnly) { "npm run dev" } else { "npm run tauri dev" }
$childCommand = @"
`$env:DEERFLOW_GATEWAY_URL = '$GwUrl'
Set-Location -LiteralPath '$DeerPanelDir'
$npmCmd
"@

if ($WebOnly) {
    Write-Host "Mode: Web only (npm run dev)" -ForegroundColor Yellow
} else {
    Write-Host "Mode: Tauri desktop (npm run tauri dev)" -ForegroundColor Green
}

Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-NoExit",
    "-Command",
    $childCommand
) -WindowStyle Normal
