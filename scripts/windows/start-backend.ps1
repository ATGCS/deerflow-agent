# Start LangGraph (2024) + Gateway (8012). Run stop-backend.ps1 first if ports are busy.
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "backend-common.ps1")
Initialize-DeerFlowBackendPaths -RepoRoot $RepoRoot
Start-DeerFlowBackend
