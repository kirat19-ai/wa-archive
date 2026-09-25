# Remove the WA Archive auto-start Scheduled Task.
# Run in an elevated PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\uninstall-autostart.ps1
$ErrorActionPreference = 'SilentlyContinue'
Stop-ScheduledTask -TaskName 'WA Archive'
Unregister-ScheduledTask -TaskName 'WA Archive' -Confirm:$false
Write-Host "[WA Archive] Auto-start removed." -ForegroundColor Yellow
