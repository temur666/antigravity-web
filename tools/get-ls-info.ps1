Get-CimInstance Win32_Process -Filter "name='language_server_windows_x64.exe'" | ForEach-Object {
    Write-Output "=== PID: $($_.ProcessId) ==="
    Write-Output $_.CommandLine
    Write-Output ""
}
