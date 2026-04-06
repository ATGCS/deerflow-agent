# Stops the two backend consoles started by start-backend.ps1 (reads temp\deerflow-backend-console-pids.txt).
# You can also just close the titled PowerShell windows. Does not stop DeerPanel / Vite (1420+).
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "backend-common.ps1")
Initialize-DeerFlowBackendPaths -RepoRoot $RepoRoot
Stop-DeerFlowBackend
