# DRP Trading - one-command Windows installer
#
# Run this one line in PowerShell (no admin needed):
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/jokingtim2468-max/Trading/vibe-coded/gracious-mccarthy-72mdp8/install.ps1 | iex"
#
# It installs what's missing (Git, Python, Node.js, Ollama) with winget, downloads the project to
# %LOCALAPPDATA%\DRPTrading, installs the Python/Node packages, copies and compiles the EA into every
# MetaTrader 5 on this PC, pulls the local Llama model, and puts a "DRP Trading" shortcut on YOUR
# Desktop and Start Menu. The shortcut updates everything automatically each time you open it.
# Set $env:DRP_NO_OLLAMA = 1 before running to skip the local AI (Ollama + ~2 GB model).
$ErrorActionPreference = 'Stop'
$Repo   = 'https://github.com/jokingtim2468-max/Trading.git'
$Branch = 'vibe-coded/gracious-mccarthy-72mdp8'
$Dir    = Join-Path $env:LOCALAPPDATA 'DRPTrading'

function Need($cmd, $id) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Installing $id ..." -ForegroundColor Cyan
    winget install --id $id -e --silent --scope user --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {   # some packages only offer a machine-wide installer
      winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements
    }
  }
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw "winget isn't available. Install 'App Installer' from the Microsoft Store, then run this again."
}
Need git    'Git.Git'
Need py     'Python.Python.3.12'
Need node   'OpenJS.NodeJS.LTS'
if (-not $env:DRP_NO_OLLAMA) { Need ollama 'Ollama.Ollama' }
# pick up freshly installed tools without reopening the window
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

if (Test-Path (Join-Path $Dir '.git')) {
  git -C $Dir fetch --quiet origin $Branch
  git -C $Dir checkout -B $Branch "origin/$Branch" --quiet
} else {
  git clone --quiet -b $Branch $Repo $Dir
}

# shortcuts for the user running this installer only
$shell = New-Object -ComObject WScript.Shell
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$targets = @(
  @{ Name = 'DRP Trading';         Args = "-NoProfile -ExecutionPolicy Bypass -File `"$Dir\launch.ps1`"";             Icon = 'shell32.dll,165'; Desc = 'Update and start DRP Trading (MT5 EA, AI service, bridge)' },
  @{ Name = 'DRP Trading - Retrain'; Args = "-NoProfile -ExecutionPolicy Bypass -File `"$Dir\launch.ps1`" -Retrain -NoStart"; Icon = 'shell32.dll,238'; Desc = 'Retrain on the latest market data and recompile the EA' }
)
foreach ($t in $targets) {
  foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    if ($t.Name -like '*Retrain' -and $folder -eq [Environment]::GetFolderPath('Desktop')) { continue }  # keep the Desktop tidy
    $lnk = $shell.CreateShortcut((Join-Path $folder "$($t.Name).lnk"))
    $lnk.TargetPath = $ps
    $lnk.Arguments = $t.Args
    $lnk.WorkingDirectory = $Dir
    $lnk.IconLocation = "$env:SystemRoot\System32\$($t.Icon)"
    $lnk.Description = $t.Desc
    $lnk.Save()
  }
}

# first run: install packages, deploy + compile the EA, pull the model (no services started)
& $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dir 'launch.ps1') -NoStart -Force
Write-Host "`nInstalled to $Dir" -ForegroundColor Green
Write-Host "Open 'DRP Trading' on your Desktop to start. It updates itself every time you open it." -ForegroundColor Green
