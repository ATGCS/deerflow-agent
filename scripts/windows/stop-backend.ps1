# Stop LangGraph (2024) + Gateway (8012). Does not stop DeerPanel / Vite (1420+).
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "backend-common.ps1")
Initialize-DeerFlowBackendPaths -RepoRoot $RepoRoot
Stop-DeerFlowBackend
