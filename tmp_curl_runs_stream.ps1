$ErrorActionPreference = "Stop"
$threadId = "7f0fe712-3094-44fb-89c4-4ab962e981b2"
$url = "http://localhost:1420/api/langgraph/threads/$threadId/runs/stream"
$bodyObj = @{
  assistant_id = "lead_agent"
  input = @{
    messages = @(
      @{
        role = "user"
        content = @(
          @{ type = "text"; text = "请只回复一行：PS-STREAM-PROBE" }
        )
      }
    )
  }
  stream_mode = @("values", "messages-tuple")
  streamSubgraphs = $true
  streamResumable = $true
  config = @{ recursion_limit = 1000 }
  context = @{
    thinking_enabled = $false
    is_plan_mode = $false
    subagent_enabled = $false
    thread_id = $threadId
  }
}
$jsonPath = "D:/github/deerflaw/tmp_stream_body.json"
$outPath = "D:/github/deerflaw/tmp_runs_stream_curl_sample.txt"
$bodyObj | ConvertTo-Json -Depth 20 | Out-File -Encoding utf8 $jsonPath
Write-Host "POST $url"
# 只取前 ~200KB 或 90 秒内
$proc = Start-Process -FilePath "curl.exe" -ArgumentList @(
  "-sS", "-N", "--max-time", "90",
  "-X", "POST", $url,
  "-H", "Content-Type: application/json",
  "--data-binary", "@$jsonPath"
) -RedirectStandardOutput $outPath -RedirectStandardError "D:/github/deerflaw/tmp_runs_stream_curl_err.txt" -NoNewWindow -PassThru
$null = $proc.WaitForExit(95000)
Write-Host "curl exit:" $proc.ExitCode
if (Test-Path $outPath) {
  $lines = Get-Content $outPath -TotalCount 120 -ErrorAction SilentlyContinue
  $lines | ForEach-Object { $_ }
  Write-Host "--- file size bytes:" (Get-Item $outPath).Length
}
