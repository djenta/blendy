param(
  [Parameter(Mandatory = $true)]
  [string]$AppResources
)

$ErrorActionPreference = "Stop"

$addonSource = Join-Path $AppResources "blender-addons\local_ai_chat"
$logDir = Join-Path $env:APPDATA "Blendy"
$logPath = Join-Path $logDir "installer-addons.log"

function Write-InstallLog {
  param([string]$Message)
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $logPath -Value "[$stamp] $Message"
}

function Add-Version {
  param(
    [System.Collections.Generic.HashSet[string]]$Set,
    [string]$Value
  )
  if ($Value -match '^\d+\.\d+$') {
    [void]$Set.Add($Value)
  }
}

function Add-BlenderExe {
  param(
    [hashtable]$Map,
    [string]$Version,
    [string]$ExePath
  )
  if (($Version -match '^\d+\.\d+$') -and (Test-Path -LiteralPath $ExePath) -and (-not $Map.ContainsKey($Version))) {
    $Map[$Version] = $ExePath
  }
}

function Enable-Addon {
  param(
    [string]$Version,
    [string]$ExePath
  )
  $python = @"
import addon_utils
import bpy
addon_utils.enable('local_ai_chat', default_set=True, persistent=True)
bpy.ops.wm.save_userpref()
"@
  try {
    & $ExePath --background --python-expr $python | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-InstallLog "Enabled local_ai_chat in Blender $Version using $ExePath"
    } else {
      Write-InstallLog "Copied local_ai_chat for Blender $Version, but Blender returned exit code $LASTEXITCODE while enabling."
    }
  } catch {
    Write-InstallLog "Copied local_ai_chat for Blender $Version, but enabling failed: $($_.Exception.Message)"
  }
}

try {
  if (-not (Test-Path -LiteralPath $addonSource)) {
    Write-InstallLog "Skipped: bundled add-on source not found at $addonSource"
    exit 0
  }

  $versions = [System.Collections.Generic.HashSet[string]]::new()
  $blenderExeByVersion = @{}
  $blenderConfigRoot = Join-Path $env:APPDATA "Blender Foundation\Blender"

  if (Test-Path -LiteralPath $blenderConfigRoot) {
    Get-ChildItem -LiteralPath $blenderConfigRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      Add-Version -Set $versions -Value $_.Name
    }
  }

  $programRoots = @($env:ProgramW6432, $env:ProgramFiles, ${env:ProgramFiles(x86)}) |
    Where-Object { $_ } |
    Select-Object -Unique
  foreach ($root in $programRoots) {
    $foundationRoot = Join-Path $root "Blender Foundation"
    if (-not (Test-Path -LiteralPath $foundationRoot)) {
      continue
    }
    Get-ChildItem -LiteralPath $foundationRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.Name -match 'Blender\s+(\d+\.\d+)') {
        $version = $Matches[1]
        Add-Version -Set $versions -Value $version
        Add-BlenderExe -Map $blenderExeByVersion -Version $version -ExePath (Join-Path $_.FullName "blender.exe")
      }
    }
  }

  if ($versions.Count -eq 0) {
    Write-InstallLog "No Blender version folders were found. The add-on remains bundled with Blendy."
    exit 0
  }

  foreach ($version in $versions) {
    $addonsRoot = Join-Path $blenderConfigRoot "$version\scripts\addons"
    $target = Join-Path $addonsRoot "local_ai_chat"
    New-Item -ItemType Directory -Force -Path $addonsRoot | Out-Null
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
    }
    Copy-Item -LiteralPath $addonSource -Destination $target -Recurse -Force
    Write-InstallLog "Installed local_ai_chat add-on for Blender $version at $target"
    if ($blenderExeByVersion.ContainsKey($version)) {
      Enable-Addon -Version $version -ExePath $blenderExeByVersion[$version]
    } else {
      Write-InstallLog "No blender.exe found for Blender $version, so the add-on was copied but not auto-enabled."
    }
  }
} catch {
  Write-InstallLog "Installer add-on step failed: $($_.Exception.Message)"
  exit 0
}
