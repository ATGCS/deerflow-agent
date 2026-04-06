# Start LangGraph (2024) + Gateway (8012) in two visible consoles (live logs). Close those windows to stop.
# Or run stop-backend.ps1. If ports are busy, run stop-backend.ps1 first.
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "backend-common.ps1")
Initialize-DeerFlowBackendPaths -RepoRoot $RepoRoot
Start-DeerFlowBackend
