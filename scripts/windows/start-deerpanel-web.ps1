# Start DeerPanel: desktop shell uses Tauri loading http://localhost:1420 (see tauri.conf.json).
# - Tauri (default): npm run tauri dev — runs Vite + 桌面窗口
# - Web only:        -WebOnly — 仅 npm run dev（浏览器打开 Vite 端口，默认 vite.config 为 1421）
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
Write-Host "    Repo: Tauri devUrl = http://localhost:1420 (桌面加载的前端地址)" -ForegroundColor DarkGray
Write-Host "    Vite 默认端口见 deerpanel/vite.config.js（当前为 1421，可能与 1420 并存于不同用途）" -ForegroundColor DarkGray
Write-Host ""

if ($WebOnly) {
    Write-Host "Mode: Web only (npm run dev)" -ForegroundColor Yellow
    Start-Process powershell -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit",
        "-Command", "Set-Location -LiteralPath '$DeerPanelDir'; npm run dev"
    ) -WindowStyle Normal
} else {
    Write-Host "Mode: Tauri desktop (npm run tauri dev)" -ForegroundColor Green
    Start-Process powershell -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit",
        "-Command", "Set-Location -LiteralPath '$DeerPanelDir'; npm run tauri dev"
    ) -WindowStyle Normal
}
