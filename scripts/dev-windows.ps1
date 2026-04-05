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

# Repo root = parent of scripts/
$RepoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "windows\backend-common.ps1")
Initialize-DeerFlowBackendPaths -RepoRoot $RepoRoot

Write-Step "Preparing directories"
New-Item -ItemType Directory -Force -Path $script:DFLogsDir | Out-Null
New-Item -ItemType Directory -Force -Path $script:DFTempDir | Out-Null
@(
    "client_body_temp",
    "proxy_temp",
    "fastcgi_temp",
    "uwsgi_temp",
    "scgi_temp"
) | ForEach-Object {
    New-Item -ItemType Directory -Force -Path (Join-Path $script:DFTempDir $_) | Out-Null
}

Write-Step "Checking required commands"
foreach ($cmd in @("uv", "npm")) {
    if (-not (Test-CommandExists $cmd)) {
        throw "Missing required command: $cmd"
    }
}

Write-Step "Ensuring config files exist"
if (-not (Test-Path (Join-Path $RepoRoot "config.yaml"))) {
    Copy-Item (Join-Path $RepoRoot "config.example.yaml") (Join-Path $RepoRoot "config.yaml")
}
if (-not (Test-Path (Join-Path $RepoRoot ".env"))) {
    Copy-Item (Join-Path $RepoRoot ".env.example") (Join-Path $RepoRoot ".env")
}

Write-Step "Stopping existing backend (LangGraph + Gateway)"
Stop-DeerFlowBackend

Write-Step "Starting backend (see also scripts\windows\start-backend.ps1)"
Start-DeerFlowBackend

Write-Host ""
Write-Host "Frontend (桌面 Web / Tauri devUrl http://localhost:1420): run scripts\windows\start-deerpanel-web.ps1" -ForegroundColor DarkYellow
