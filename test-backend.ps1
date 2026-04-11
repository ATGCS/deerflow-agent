# 测试后端连接
$ErrorActionPreference = "Stop"

Write-Host "测试后端连接..." -ForegroundColor Cyan

# 测试 Gateway 端口 8012
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8012/api/mcp/config" -TimeoutSec 5 -UseBasicParsing
    Write-Host "✓ Gateway 8012: 成功 (状态码：$($response.StatusCode))" -ForegroundColor Green
    Write-Host "  响应内容：$($response.Content)" -ForegroundColor Gray
} catch {
    Write-Host "✗ Gateway 8012: 失败 - $_" -ForegroundColor Red
}

# 测试 LangGraph 端口 2024
try {
    $response = Invoke-WebRequest -Uri "http://localhost:2024/health" -TimeoutSec 5 -UseBasicParsing
    Write-Host "✓ LangGraph 2024: 成功 (状态码：$($response.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "✗ LangGraph 2024: 失败 - $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "检查端口监听状态..." -ForegroundColor Cyan
netstat -ano | Select-String ":8012|:2024" | ForEach-Object {
    Write-Host $_ -ForegroundColor Yellow
}
