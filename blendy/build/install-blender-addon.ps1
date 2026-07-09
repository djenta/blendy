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
    $parsed = [version]$Value
    if ($parsed -ge [version]"4.0") {
      [void]$Set.Add($Value)
    }
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
  if (Get-Process -Name "blender" -ErrorAction SilentlyContinue) {
    Write-InstallLog "Installed local_ai_chat for Blender $Version. Auto-enable was skipped because Blender is already running; restart Blender to load the update."
    return
  }

  $python = @"
import addon_utils
import bpy
addon_utils.enable('local_ai_chat', default_set=True, persistent=True)
bpy.ops.wm.save_userpref()
"@
  $tempScript = Join-Path $env:TEMP "blendy-enable-addon-$PID-$($Version.Replace('.', '-')).py"
  try {
    Set-Content -LiteralPath $tempScript -Value $python -Encoding UTF8
    $process = Start-Process -FilePath $ExePath -ArgumentList @("--background", "--python", "`"$tempScript`"") -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(60000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      Write-InstallLog "Copied local_ai_chat for Blender $Version, but auto-enable timed out after 60 seconds."
      return
    }
    if ($process.ExitCode -eq 0) {
      Write-InstallLog "Enabled local_ai_chat in Blender $Version using $ExePath"
    } else {
      Write-InstallLog "Copied local_ai_chat for Blender $Version, but Blender returned exit code $($process.ExitCode) while enabling."
    }
  } catch {
    Write-InstallLog "Copied local_ai_chat for Blender $Version, but enabling failed: $($_.Exception.Message)"
  } finally {
    Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
  }
}

function Install-AddonAtomically {
  param(
    [string]$Source,
    [string]$AddonsRoot,
    [string]$Version
  )

  $target = Join-Path $AddonsRoot "local_ai_chat"
  $staging = Join-Path $AddonsRoot ".local_ai_chat.blendy-new-$PID"
  $backup = Join-Path $AddonsRoot ".local_ai_chat.blendy-backup-$PID"

  New-Item -ItemType Directory -Force -Path $AddonsRoot | Out-Null
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue

  try {
    Copy-Item -LiteralPath $Source -Destination $staging -Recurse -Force
    if (-not (Test-Path -LiteralPath (Join-Path $staging "__init__.py"))) {
      throw "Staged add-on is missing __init__.py."
    }
    Set-Content -LiteralPath (Join-Path $staging ".blendy-managed") -Value "app.blendy.local-ai-tutor" -Encoding ASCII

    if (Test-Path -LiteralPath $target) {
      Move-Item -LiteralPath $target -Destination $backup
    }

    try {
      Move-Item -LiteralPath $staging -Destination $target
    } catch {
      if ((Test-Path -LiteralPath $backup) -and (-not (Test-Path -LiteralPath $target))) {
        Move-Item -LiteralPath $backup -Destination $target
      }
      throw
    }

    Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
    Write-InstallLog "Installed local_ai_chat add-on for Blender $Version at $target"
  } finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
}

try {
  if (-not (Test-Path -LiteralPath $addonSource)) {
    Write-InstallLog "Failed: bundled add-on source not found at $addonSource"
    exit 1
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
    Install-AddonAtomically -Source $addonSource -AddonsRoot $addonsRoot -Version $version
    if ($blenderExeByVersion.ContainsKey($version)) {
      Enable-Addon -Version $version -ExePath $blenderExeByVersion[$version]
    } else {
      Write-InstallLog "No blender.exe found for Blender $version, so the add-on was copied but not auto-enabled."
    }
  }
} catch {
  Write-InstallLog "Installer add-on step failed: $($_.Exception.Message)"
  exit 1
}
