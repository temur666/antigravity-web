# 对比正常 IDE 启动的 Language Server 和我们的 headless 版本
Write-Output "=== 正常 IDE 的 Language Server (PID 17120, antigravity-web) ===`n"

# 查看网络状态
Write-Output "--- Listening Ports ---"
netstat -ano | Select-String "17120" | Select-String "LISTENING" | ForEach-Object { Write-Output "  $($_.Line.Trim())" }

Write-Output "`n--- Established Connections ---"
netstat -ano | Select-String "17120" | Select-String "ESTABLISHED" | ForEach-Object { Write-Output "  $($_.Line.Trim())" }

# 进程信息
$proc = Get-CimInstance Win32_Process -Filter "ProcessId=17120"
Write-Output "`n--- Process Info ---"
Write-Output "  Threads: $($proc.ThreadCount)"
Write-Output "  Memory: $([math]::Round($proc.WorkingSetSize / 1MB, 1)) MB"
Write-Output "  Created: $($proc.CreationDate)"

# 检查 headless 是否还在
Write-Output "`n`n=== Headless Language Server ==="
$headless = Get-CimInstance Win32_Process -Filter "name='language_server_windows_x64.exe'" | Where-Object { $_.CommandLine -match 'headless' }
if ($headless) {
    Write-Output "PID: $($headless.ProcessId)"
    Write-Output "Threads: $($headless.ThreadCount)"
    Write-Output "Memory: $([math]::Round($headless.WorkingSetSize / 1MB, 1)) MB"
    $ns = netstat -ano | Select-String "$($headless.ProcessId)" | Select-String "LISTENING"
    if ($ns) { foreach ($l in $ns) { Write-Output "Listening: $($l.Line.Trim())" } }
    else { Write-Output "  (no listening ports)" }
} else {
    Write-Output "  (not running)"
}

# 看看正常 LS 的 Extension Server 端口（60026）是否还活着
Write-Output "`n`n=== Extension Server Port 60026 Status ==="
$extPort = netstat -ano | Select-String "60026" | Select-String "LISTENING"
if ($extPort) { Write-Output "  60026 is LISTENING" } else { Write-Output "  60026 is NOT listening (Extension Server已断开)" }

# 看看 LS 写入了什么文件（discovery file）
Write-Output "`n`n=== Discovery Files in .gemini/antigravity ==="
$geminiDir = Join-Path $env:USERPROFILE ".gemini\antigravity"
if (Test-Path $geminiDir) {
    Get-ChildItem $geminiDir -Recurse -File | Where-Object { $_.Name -match 'discovery|port|pid|lock' } | ForEach-Object {
        Write-Output "  $($_.FullName)"
        if ($_.Length -lt 500) {
            $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
            if ($content) { Write-Output "    Content: $content" }
        }
    }
} else {
    Write-Output "  Directory not found"
}
