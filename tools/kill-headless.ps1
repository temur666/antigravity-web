Get-CimInstance Win32_Process -Filter "name='language_server_windows_x64.exe'" | Where-Object { $_.CommandLine -match 'headless' } | ForEach-Object {
    Write-Output "Killing PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force
}
