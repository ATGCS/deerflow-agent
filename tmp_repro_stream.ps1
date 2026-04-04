$ErrorActionPreference = "Stop"

$api = "http://localhost:1420/api/langgraph"
$assistantId = "bee7d354-5df5-5f26-a978-10ea053f620d"

$thread = Invoke-RestMethod -Uri "$api/threads" -Method Post -ContentType "application/json" -Body "{}"
$threadId = $thread.thread_id
if (-not $threadId) { $threadId = $thread.threadId }
if (-not $threadId) { throw "No thread_id" }
Write-Host "ThreadId $threadId"

$input = @{
  messages = @(
    @{ role = "user"; content = "请依次执行：1) 列出 /mnt/user-data/workspace 2) 回复 DONE" }
  )
}

$body = @{
  assistant_id = $assistantId
  input = $input
  stream_mode = @("values","messages-tuple")
  metadata = @{ source="tmp_repro_stream" }
} | ConvertTo-Json -Depth 30

$out = "tmp_repro_stream_sse.txt"
if (Test-Path $out) { Remove-Item $out -Force }

Write-Host "Streaming..."
$resp = Invoke-WebRequest -Uri "$api/threads/$threadId/runs/stream" -Method Post -ContentType "application/json" -Body $body
$resp.Content | Out-File -Encoding utf8 $out
Write-Host "Saved $out"

