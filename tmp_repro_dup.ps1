$ErrorActionPreference = "Stop"

$api = "http://localhost:1420/api/langgraph"
$assistantId = "bee7d354-5df5-5f26-a978-10ea053f620d"

Write-Host "Create thread..."
$thread = Invoke-RestMethod -Uri "$api/threads" -Method Post -ContentType "application/json" -Body "{}"
$threadId = $thread.thread_id
if (-not $threadId) { $threadId = $thread.threadId }
if (-not $threadId) { throw "No thread_id" }
Write-Host "ThreadId $threadId"

$input = @{
  messages = @(
    @{
      role    = "user"
      content = "请你只回复一行：DUPTEST-HELLO"
    }
  )
}

$body = @{
  assistant_id = $assistantId
  input = $input
  metadata = @{ source = "tmp_repro_dup"; ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
} | ConvertTo-Json -Depth 20

Write-Host "Run wait..."
$runResult = Invoke-RestMethod -Uri "$api/threads/$threadId/runs/wait" -Method Post -ContentType "application/json" -Body $body
$runResult | ConvertTo-Json -Depth 80 | Out-File -Encoding utf8 "tmp_repro_run_wait.json"

Write-Host "Fetch state after run (1)..."
$s1 = Invoke-RestMethod -Uri "$api/threads/$threadId/state" -Method Get
$s1 | ConvertTo-Json -Depth 80 | Out-File -Encoding utf8 "tmp_repro_state_after_1.json"

Start-Sleep -Milliseconds 300

Write-Host "Fetch state after run (2)..."
$s2 = Invoke-RestMethod -Uri "$api/threads/$threadId/state" -Method Get
$s2 | ConvertTo-Json -Depth 80 | Out-File -Encoding utf8 "tmp_repro_state_after_2.json"

Write-Host "Done."

