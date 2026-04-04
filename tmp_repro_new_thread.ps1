$ErrorActionPreference = "Stop"

$base = "http://localhost:1420/api/langgraph"

Write-Host "Creating thread..."
$create = Invoke-RestMethod -Uri "$base/threads" -Method Post -ContentType "application/json" -Body "{}"
$createJson = $create | ConvertTo-Json -Depth 30
$createJson | Out-File -Encoding utf8 "tmp_repro_create_thread.json"

$threadId = $create.thread_id
if (-not $threadId) { $threadId = $create.threadId }
if (-not $threadId) { throw "No thread_id in response" }
Write-Host "ThreadId: $threadId"

Write-Host "Fetching state 1..."
$s1 = Invoke-RestMethod -Uri "$base/threads/$threadId/state" -Method Get
$s1 | ConvertTo-Json -Depth 80 | Out-File -Encoding utf8 "tmp_repro_state_1.json"

Start-Sleep -Milliseconds 300

Write-Host "Fetching state 2..."
$s2 = Invoke-RestMethod -Uri "$base/threads/$threadId/state" -Method Get
$s2 | ConvertTo-Json -Depth 80 | Out-File -Encoding utf8 "tmp_repro_state_2.json"

Write-Host "Done."

