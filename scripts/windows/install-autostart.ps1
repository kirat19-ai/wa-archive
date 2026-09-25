# =============================================================================
#  Install WA Archive auto-start (Windows)
#  Registers a Scheduled Task that launches WA Archive on EVERY boot, before
#  anyone logs in. This survives normal restarts AND the reboot that happens
#  when power is restored (see docs/WINDOWS.md for the BIOS power-on setting).
#
#  Run in an ELEVATED PowerShell (Run as administrator):
#     powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
# =============================================================================
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$bat  = Join-Path $repo 'scripts\windows\start-wa-archive.bat'
if (-not (Test-Path $bat)) { throw "Launcher not found: $bat" }

$taskName = 'WA Archive'

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$bat`"" -WorkingDirectory $repo

# Fire at system startup (before login) AND at logon, so it comes up unattended.
$triggers = @(
  New-ScheduledTaskTrigger -AtStartup
  New-ScheduledTaskTrigger -AtLogOn
)

# Run as the current user without storing a password (S4U), highest privileges.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType S4U -RunLevel Highest

# Keep running on battery, start if a scheduled start was missed, auto-restart on failure.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Host ""
Write-Host "[WA Archive] Auto-start installed." -ForegroundColor Green
Write-Host "  - Starts on every boot (and at logon)."
Write-Host "  - Open http://localhost:8787 once the PC is up."
Write-Host ""
Write-Host "Start it now without rebooting:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "For true unattended power-on, also:"
Write-Host "  1) Enable auto-login (run: netplwiz  -> untick 'Users must enter a password')."
Write-Host "  2) Set BIOS/UEFI 'Restore on AC Power Loss' = Power On (see docs/WINDOWS.md)."
