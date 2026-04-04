$ErrorActionPreference = "Stop"

$u = "http://localhost:1420/api/langgraph/openapi.json"
$o = "D:/github/deerflaw/tmp_langgraph_openapi.json"

Write-Host "Fetching $u"
$data = Invoke-RestMethod -Uri $u -Method Get
$data | ConvertTo-Json -Depth 100 | Out-File -Encoding utf8 $o
Write-Host "Saved $o"

