# QuantBot installer for Windows. Paste into PowerShell:
#   irm https://raw.githubusercontent.com/jokingtim2468-max/Trading/vibe-coded/clever-thompson-2f91fo/quantbot/installer/install.ps1 | iex
#
# Installs Git and Node.js if they're missing, downloads QuantBot to %LOCALAPPDATA%\QuantBot, prepares it, adds
# QuantBot shortcuts to the Desktop and Start Menu, and opens it. Running it again repairs the install; your chats,
# tests, keys and market data (quantbot\data) are kept. After this, the shortcut updates QuantBot by itself.
# Everything runs inside this block so the settings below don't stay in your PowerShell window
& {
  $ErrorActionPreference = 'Stop'
  $Repo   = 'https://github.com/jokingtim2468-max/Trading.git'
  $Branch = if ($env:QUANTBOT_BRANCH) { $env:QUANTBOT_BRANCH } else { 'vibe-coded/clever-thompson-2f91fo' }
  $Dir    = Join-Path $env:LOCALAPPDATA 'QuantBot'
  $App    = Join-Path $Dir 'quantbot'

  function Step($n, $text) { Write-Host "`n[$n/4] $text" -ForegroundColor Cyan }
  function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  }
  function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." } }
  function Need($cmd, $id, $name) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) { Write-Host "  $name found"; return }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      throw "$name is missing and winget isn't available. Install 'App Installer' from the Microsoft Store (or $name itself), then run this again."
    }
    Write-Host "  Installing $name..."
    winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$name could not be installed. Install it from its website, then run this again." }
  }

  Write-Host 'QuantBot installer' -ForegroundColor White

  Step 1 'Checking Git and Node.js'
  Need 'git' 'Git.Git' 'Git'
  Need 'node' 'OpenJS.NodeJS.LTS' 'Node.js'
  $nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
  if ($nodeMajor -lt 20) {
    Write-Host "  Node.js $nodeMajor is too old, updating..."
    winget upgrade --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
  }

  Step 2 'Downloading QuantBot'
  if (Test-Path (Join-Path $Dir '.git')) {
    git -C $Dir fetch origin $Branch; Check 'Downloading the latest version'
    git -C $Dir checkout -B $Branch "origin/$Branch"; Check 'Switching to the latest version'
  } else {
    if (Test-Path $Dir) {
      $old = "$Dir-old-$(Get-Date -Format yyyyMMddHHmmss)"
      Write-Host "  Moving the existing $Dir folder to $old"
      Move-Item $Dir $old
    }
    git clone --branch $Branch $Repo $Dir; Check 'Downloading QuantBot'
  }

  Step 3 'Preparing QuantBot (the first time takes a few minutes)'
  Push-Location $App
  try {
    & node launcher\launch.js --prepare; Check 'Preparing QuantBot'
  } finally {
    Pop-Location
  }

  Step 4 'Adding shortcuts'
  $shell = New-Object -ComObject WScript.Shell
  $starter = Join-Path $App 'installer\QuantBot.vbs'
  foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    $lnk = $shell.CreateShortcut((Join-Path $folder 'QuantBot.lnk'))
    $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $lnk.Arguments = "`"$starter`""
    $lnk.WorkingDirectory = $App
    $lnk.IconLocation = (Join-Path $App 'installer\quantbot.ico') + ',0'
    $lnk.Description = 'QuantBot - AI quant developer for MT5 and Pine Script'
    $lnk.Save()
    Write-Host "  $folder\QuantBot.lnk"
  }

  Write-Host "`nQuantBot is installed in $Dir. Opening it now; next time use the QuantBot shortcut on your Desktop." -ForegroundColor Green
  Start-Process (Join-Path $env:SystemRoot 'System32\wscript.exe') -ArgumentList "`"$starter`""
}
