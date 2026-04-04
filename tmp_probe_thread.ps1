$ErrorActionPreference = "Stop"

$threadId = "7f0fe712-3094-44fb-89c4-4ab962e981b2"
$base = "http://localhost:1420/api/langgraph/threads/$threadId"

$outDir = "D:/github/deerflaw"
$statePath = Join-Path $outDir "tmp_thread_state.json"
$historyPath = Join-Path $outDir "tmp_thread_history.json"

Write-Host "Fetching state..."
$state = Invoke-RestMethod -Uri "$base/state" -Method GET
$state | ConvertTo-Json -Depth 80 | Out-File -Encoding utf8 $statePath
Write-Host "Saved $statePath"

Write-Host "Fetching history..."
try {
  $history = Invoke-RestMethod -Uri "$base/history?limit=200" -Method GET
  $history | ConvertTo-Json -Depth 80 | Out-File -Encoding utf8 $historyPath
  Write-Host "Saved $historyPath"
} catch {
  Write-Host ("History endpoint failed: " + $_.Exception.Message)
  throw
}

