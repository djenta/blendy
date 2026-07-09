$ErrorActionPreference = "Stop"

$logDir = Join-Path $env:APPDATA "Blendy"
$logPath = Join-Path $logDir "installer-addons.log"
$blenderConfigRoot = Join-Path $env:APPDATA "Blender Foundation\Blender"
$managedValue = "app.blendy.local-ai-tutor"

function Write-UninstallLog {
  param([string]$Message)
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $logPath -Value "[$stamp] $Message"
}

try {
  if (-not (Test-Path -LiteralPath $blenderConfigRoot)) {
    Write-UninstallLog "No Blender configuration folder was found during Blendy uninstall."
    exit 0
  }

  Get-ChildItem -LiteralPath $blenderConfigRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Name -notmatch '^\d+\.\d+$' -or [version]$_.Name -lt [version]"4.0") {
      return
    }
    $target = Join-Path $_.FullName "scripts\addons\local_ai_chat"
    $marker = Join-Path $target ".blendy-managed"
    if (-not (Test-Path -LiteralPath $marker)) {
      return
    }
    $markerValue = (Get-Content -LiteralPath $marker -Raw).Trim()
    if ($markerValue -ne $managedValue) {
      Write-UninstallLog "Preserved unrecognized local_ai_chat add-on at $target"
      return
    }
    Remove-Item -LiteralPath $target -Recurse -Force
    Write-UninstallLog "Removed Blendy-managed local_ai_chat add-on for Blender $($_.Name) from $target"
  }
  exit 0
} catch {
  Write-UninstallLog "Blendy add-on uninstall step failed: $($_.Exception.Message)"
  exit 1
}
