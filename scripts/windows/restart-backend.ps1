# Stop then start LangGraph + Gateway (same as stop-backend + start-backend).
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "backend-common.ps1")
Initialize-DeerFlowBackendPaths -RepoRoot $RepoRoot
Stop-DeerFlowBackend
Start-DeerFlowBackend
