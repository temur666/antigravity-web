# 查找 language_server 进程中 workspace 包含 headless 的
$procs = Get-CimInstance Win32_Process -Filter "name='language_server_windows_x64.exe'"
foreach ($p in $procs) {
    if ($p.CommandLine -match 'headless') {
        Write-Output "Found headless LS: PID=$($p.ProcessId)"
        Write-Output ""
        
        # 查所有网络连接
        Write-Output "--- All netstat entries for PID $($p.ProcessId) ---"
        $ns = netstat -ano | Select-String "$($p.ProcessId)"
        if ($ns) {
            foreach ($line in $ns) { Write-Output "  $($line.Line.Trim())" }
        } else {
            Write-Output "  (no network activity)"
        }
        
        Write-Output ""
        Write-Output "--- Process status ---"
        Write-Output "  Handle count: $($p.HandleCount)"
        Write-Output "  Thread count: $($p.ThreadCount)"
        Write-Output "  Working set: $([math]::Round($p.WorkingSetSize / 1MB, 1)) MB"
    }
}
