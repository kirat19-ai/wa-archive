# =============================================================================
#  WA Archive — one-shot auto-start + always-on setup (Windows)
#  RUN AS ADMINISTRATOR.
#
#  What it does (everything software can do unattended):
#    1. Finds the installed "WA Archive.exe".
#    2. Registers a Scheduled Task that launches it on EVERY boot AND at logon,
#       auto-restarting it if it ever crashes. Survives normal reboots and the
#       reboot that happens when mains power is restored.
#    3. Configures power so the PC never sleeps/hibernates on AC and uses the
#       High Performance plan.
#
#  What it CANNOT do (firmware, not software):
#    - Make the PC physically power ON after a power cut. That is a BIOS/UEFI
#      setting: "Restore on AC Power Loss" / "AC Power Recovery" = Power On.
#      Set it once in BIOS; after that this script handles the rest.
#
#  Run it:
#    powershell -ExecutionPolicy Bypass -File setup-autostart-exe.ps1
# =============================================================================
$ErrorActionPreference = 'Stop'

# --- must be elevated --------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
  throw "Please run this in an ELEVATED PowerShell (right-click > Run as administrator)."
}

# --- locate the installed WA Archive.exe -------------------------------------
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\WA Archive\WA Archive.exe'),
  (Join-Path $env:ProgramFiles 'WA Archive\WA Archive.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'WA Archive\WA Archive.exe')
)
$exe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $exe) {
  Write-Host "Could not find 'WA Archive.exe' in the usual install locations." -ForegroundColor Yellow
  $exe = Read-Host "Paste the full path to WA Archive.exe"
  if (-not (Test-Path $exe)) { throw "Not found: $exe" }
}
Write-Host "[WA Archive] Using: $exe" -ForegroundColor Cyan

$taskName = 'WA Archive Autostart'
$workDir  = Split-Path $exe -Parent

# --- scheduled task: launch on boot + logon, restart on failure --------------
$action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $workDir

$triggers = @(
  New-ScheduledTaskTrigger -AtStartup
  New-ScheduledTaskTrigger -AtLogOn
)

# S4U = run whether or not the user is logged in, without storing a password.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType S4U -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
  -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "[WA Archive] Auto-start task registered ('$taskName')." -ForegroundColor Green

# --- power: never sleep on AC, high performance ------------------------------
try {
  powercfg /setactive SCHEME_MIN | Out-Null           # High performance
  powercfg /change standby-timeout-ac 0               # never sleep
  powercfg /change hibernate-timeout-ac 0             # never hibernate
  powercfg /change monitor-timeout-ac 0               # screen stays on
  powercfg /change disk-timeout-ac 0                  # disks stay on
  powercfg /hibernate off | Out-Null                  # disable hibernation
  Write-Host "[WA Archive] Power plan set: never sleep/hibernate on AC." -ForegroundColor Green
} catch {
  Write-Host "[WA Archive] Power tweak skipped: $($_.Exception.Message)" -ForegroundColor Yellow
}

# --- start it now, no reboot needed -----------------------------------------
Start-ScheduledTask -TaskName $taskName
Write-Host ""
Write-Host "[WA Archive] Launched now (no reboot needed)." -ForegroundColor Green
Write-Host ""
Write-Host "===================== ONE MANUAL STEP LEFT =======================" -ForegroundColor Yellow
Write-Host " To make the PC power ON by itself after a power cut, set this in BIOS:"
Write-Host "   Restart PC -> enter BIOS/UEFI (Del or F2 at boot) ->"
Write-Host "   find 'Restore on AC Power Loss' / 'AC Power Recovery' / 'After Power Failure'"
Write-Host "   -> set to 'Power On' (or 'Last State') -> Save & Exit."
Write-Host " Windows cannot change this; it is a firmware setting. After you set it,"
Write-Host " power returns -> PC boots -> WA Archive starts automatically."
Write-Host "=================================================================="
