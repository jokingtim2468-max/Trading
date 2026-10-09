# MT5 Charts - Windows installer
# Installs Git, Node.js and Python (via winget) if missing, downloads the app,
# and creates Desktop + Start Menu shortcuts. The shortcut auto-updates on launch.
$ErrorActionPreference = 'Stop'
$Repo   = 'https://github.com/jokingtim2468-max/Trading.git'
$Branch = 'vibe-coded/intelligent-mayer-cwnehl'
$Dir    = Join-Path $env:LOCALAPPDATA 'MT5Charts'

function Need($cmd, $id) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Installing $id ..."
    winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements
  }
}
Need git    'Git.Git'
Need node   'OpenJS.NodeJS.LTS'
Need python 'Python.Python.3.12'
# refresh PATH so freshly installed tools are found
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

if (Test-Path (Join-Path $Dir '.git')) {
  git -C $Dir pull --ff-only
} else {
  git clone -b $Branch $Repo $Dir
}
Push-Location $Dir
npm install --no-audit --no-fund
python -m pip install --upgrade -r bridge\requirements.txt
Pop-Location

$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $lnk = $shell.CreateShortcut((Join-Path $folder 'MT5 Charts.lnk'))
  $lnk.TargetPath = Join-Path $Dir 'start.bat'
  $lnk.WorkingDirectory = $Dir
  $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,165"
  $lnk.Description = 'MT5 Charts (TradingView-style terminal for MetaTrader 5)'
  $lnk.Save()
}
Write-Host "`nInstalled to $Dir. Use the 'MT5 Charts' shortcut on your Desktop or Start Menu." -ForegroundColor Green
