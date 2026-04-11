# 简化的后端启动脚本
# 使用前请确保已安装依赖：cd backend; uv sync

$ErrorActionPreference = "Stop"
$BackendDir = (Resolve-Path (Join-Path $PSScriptRoot "backend")).Path
$PythonExe = Join-Path $BackendDir ".venv\Scripts\python.exe"

if (-not (Test-Path $PythonExe)) {
    Write-Host "错误：Python 虚拟环境未找到！请先运行：cd backend; uv sync" -ForegroundColor Red
    exit 1
}

Write-Host "正在启动 DeerFlow 后端..." -ForegroundColor Cyan
Write-Host "Python: $PythonExe" -ForegroundColor Gray

# 启动 Gateway (端口 8012)
$gatewayCmd = "& '$PythonExe' -m uvicorn app.gateway.app:app --host 0.0.0.0 --port 8012 --reload"
Write-Host "启动 Gateway 端口 8012..." -ForegroundColor Green
Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    "cd '$BackendDir'; $gatewayCmd"
) -WindowStyle Normal

# 启动 LangGraph (端口 2024)
$langgraphCmd = "& '$PythonExe' -m langgraph_cli dev --no-browser --allow-blocking --no-reload"
Write-Host "启动 LangGraph 端口 2024..." -ForegroundColor Green
Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    "cd '$BackendDir'; `$env:PYTHONPATH='$BackendDir;$BackendDir\packages\harness'; $langgraphCmd"
) -WindowStyle Normal

Write-Host ""
Write-Host "后端已启动！" -ForegroundColor Green
Write-Host "  - Gateway: http://localhost:8012" -ForegroundColor Yellow
Write-Host "  - LangGraph: http://localhost:2024" -ForegroundColor Yellow
Write-Host ""
Write-Host "停止后端：关闭这两个 PowerShell 窗口" -ForegroundColor Yellow
