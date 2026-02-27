# 查看 IDE Extension Server 端口 60026 的连接情况
Write-Output "=== Extension Server Port 60026 (IDE side) ==="
Write-Output "Language Server (PID 17120) -> IDE Extension Server"
Write-Output ""

# 看 60026 端口的所有连接
Write-Output "--- All connections to/from port 60026 ---"
netstat -ano | Select-String "60026" | ForEach-Object { Write-Output "  $($_.Line.Trim())" }

Write-Output ""
Write-Output "--- Who is listening on 60026? ---"
netstat -ano | Select-String "60026" | Select-String "LISTENING" | ForEach-Object {
    $line = $_.Line.Trim()
    $pidMatch = [regex]::Match($line, '\s+(\d+)\s*$')
    if ($pidMatch.Success) {
        $pid = $pidMatch.Groups[1].Value
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
        Write-Output "  $line  ->  $($proc.Name) (PID: $pid)"
    } else {
        Write-Output "  $line"
    }
}

Write-Output ""
Write-Output ""

# 看看 IDE 主进程的信息
Write-Output "=== Antigravity IDE Processes ==="
Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match 'antigravity|Antigravity' -and $_.Name -ne 'language_server_windows_x64.exe'
} | ForEach-Object {
    Write-Output "PID: $($_.ProcessId)  Name: $($_.Name)"
    # 只显示命令行的前200个字符
    $cmd = $_.CommandLine
    if ($cmd -and $cmd.Length -gt 200) {
        Write-Output "  CMD: $($cmd.Substring(0, 200))..."
    } else {
        Write-Output "  CMD: $cmd"
    }
    Write-Output ""
}

# 看看 51757 端口 (Language Server 有多个连接到这个端口)
Write-Output ""
Write-Output "=== Port 51757 (Language Server connects to it multiple times) ==="
netstat -ano | Select-String "51757" | Select-String "LISTENING" | ForEach-Object {
    $line = $_.Line.Trim()
    $pidMatch = [regex]::Match($line, '\s+(\d+)\s*$')
    if ($pidMatch.Success) {
        $pid = $pidMatch.Groups[1].Value
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
        Write-Output "  $line  ->  $($proc.Name) (PID: $pid)"
    }
}
