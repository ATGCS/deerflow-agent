# Stop Vite/Tauri dev listeners on 1420 and 1421 (Tauri devUrl + Vite default).
# If your Vite picked another port (e.g. 1423), pass: -ExtraPorts 1423
param(
    [int[]] $ExtraPorts = @()
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "backend-common.ps1")
Initialize-DeerFlowBackendPaths -RepoRoot $RepoRoot
Stop-DeerFlowDeerPanelWeb
foreach ($p in $ExtraPorts) {
    Write-Host "  Also stopping port $p" -ForegroundColor Yellow
    Stop-DeerFlowPortProcess -Port $p
    $null = Wait-DeerFlowPortClosed -Port $p -TimeoutSec 15
}
