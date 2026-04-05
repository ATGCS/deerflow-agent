# Thin wrapper: full restart uses repo scripts (LangGraph 2024 + Gateway 8012).
# 桌面 Web (1420) 不在此脚本内 — 见 ..\scripts\windows\start-deerpanel-web.ps1
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $ProjectRoot "scripts\windows\restart-backend.ps1")
