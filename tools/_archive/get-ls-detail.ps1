# 获取所有 language_server 进程的详细信息
$processes = Get-CimInstance Win32_Process -Filter "name='language_server_windows_x64.exe'"

foreach ($proc in $processes) {
    $cmd = $proc.CommandLine
    
    # 提取 workspace_id
    $wsMatch = [regex]::Match($cmd, '--workspace_id\s+(\S+)')
    $ws = if ($wsMatch.Success) { $wsMatch.Groups[1].Value } else { "N/A" }
    
    # 提取所有参数
    $csrfMatch = [regex]::Match($cmd, '--csrf_token\s+([a-f0-9-]+)')
    $extPortMatch = [regex]::Match($cmd, '--extension_server_port\s+(\d+)')
    $extCsrfMatch = [regex]::Match($cmd, '--extension_server_csrf_token\s+([a-f0-9-]+)')
    $cloudMatch = [regex]::Match($cmd, '--cloud_code_endpoint\s+(\S+)')
    
    Write-Output "==============================================="
    Write-Output "PID:                       $($proc.ProcessId)"
    Write-Output "Workspace ID:              $ws"
    Write-Output "CSRF Token:                $(if ($csrfMatch.Success) { $csrfMatch.Groups[1].Value } else { 'N/A' })"
    Write-Output "Extension Server Port:     $(if ($extPortMatch.Success) { $extPortMatch.Groups[1].Value } else { 'N/A' })"
    Write-Output "Extension Server CSRF:     $(if ($extCsrfMatch.Success) { $extCsrfMatch.Groups[1].Value } else { 'N/A' })"
    Write-Output "Cloud Code Endpoint:       $(if ($cloudMatch.Success) { $cloudMatch.Groups[1].Value } else { 'N/A' })"
    Write-Output ""
    
    # 获取该进程监听的端口
    Write-Output "--- Listening Ports ---"
    $netstat = netstat -ano | Select-String "LISTENING" | Select-String "$($proc.ProcessId)"
    if ($netstat) {
        foreach ($line in $netstat) {
            Write-Output "  $($line.Line.Trim())"
        }
    } else {
        Write-Output "  (none found)"
    }
    
    # 获取该进程的活动连接
    Write-Output ""
    Write-Output "--- Active Connections (ESTABLISHED) ---"
    $established = netstat -ano | Select-String "ESTABLISHED" | Select-String "$($proc.ProcessId)"
    if ($established) {
        foreach ($line in $established) {
            Write-Output "  $($line.Line.Trim())"
        }
    } else {
        Write-Output "  (none)"
    }
    
    # 获取进程的父进程
    Write-Output ""
    Write-Output "--- Parent Process ---"
    $parentPid = $proc.ParentProcessId
    if ($parentPid) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$parentPid" -ErrorAction SilentlyContinue
        if ($parent) {
            Write-Output "  Parent PID: $parentPid"
            Write-Output "  Parent Name: $($parent.Name)"
        } else {
            Write-Output "  Parent PID: $parentPid (process no longer exists)"
        }
    }
    
    # 完整命令行（分行显示参数）
    Write-Output ""
    Write-Output "--- Full Command Line (parsed) ---"
    $exe = $cmd -replace '(.*\.exe)\s.*', '$1'
    $args = $cmd -replace '.*\.exe\s+', ''
    Write-Output "  Binary: $exe"
    $argParts = $args -split '\s+--' | Where-Object { $_ }
    foreach ($arg in $argParts) {
        $a = $arg -replace '^--',''
        Write-Output "  --$a"
    }
    
    Write-Output ""
    Write-Output ""
}
