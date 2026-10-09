# DRP Trading launcher (the Desktop shortcut runs this).
#  1. Updates itself and the project from GitHub (local edits are kept in `git stash`, never lost).
#  2. Reinstalls Python/Node packages only when they changed.
#  3. Copies the EA into every MetaTrader 5 on this PC and compiles it with MetaEditor.
#  4. Starts Ollama, the AI service and the MT5 bridge (minimized), then opens MetaTrader 5.
#  5. Once a week, retrains on the latest market data in the background and recompiles the EA.
#
# Options: -NoStart (update/deploy only)  -NoAI  -Charts (also open the web charts app)
#          -Retrain (retrain now)  -Force (reinstall packages)
param([switch]$NoStart, [switch]$NoAI, [switch]$Charts, [switch]$Retrain, [switch]$Force)
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'DRP Trading'
function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
# the Python launcher 'py' is preferred; -CommandType Application so nothing else named py can match
$py = if (Get-Command py -CommandType Application -ErrorAction SilentlyContinue) { 'py' } else { 'python' }
$state = Join-Path $PSScriptRoot '.drp_state'
New-Item -ItemType Directory -Force $state | Out-Null

Say '== DRP Trading ==' 'Cyan'

# ---- 1. auto-update ------------------------------------------------------------------------------
$before = (git rev-parse HEAD) 2>$null
$branch = (git rev-parse --abbrev-ref HEAD) 2>$null
git fetch --quiet origin $branch 2>$null
if ($LASTEXITCODE -eq 0 -and $before -ne (git rev-parse "origin/$branch")) {
  # only when there's something new: keep local edits (e.g. your own retrain) in git stash, then update
  if (git status --porcelain --untracked-files=no) {
    git stash push --quiet -m "DRP auto-update $(Get-Date -Format s)" | Out-Null
    Say 'Local changes were saved in git stash before updating.' 'Yellow'
  }
  git merge --ff-only --quiet "origin/$branch" 2>$null
  if ($LASTEXITCODE -ne 0) { git reset --hard --quiet "origin/$branch" }
  $after = (git rev-parse HEAD)
  if ($before -ne $after) {
    Say "Updated $($before.Substring(0,7)) -> $($after.Substring(0,7))" 'Green'
    if ((git diff --name-only $before $after) -contains 'launch.ps1') {
      Say 'The launcher itself was updated, restarting it...' 'Yellow'
      & $PSCommandPath @PSBoundParameters
      exit
    }
  }
} elseif ($LASTEXITCODE -eq 0) { Say 'Already up to date.' } else { Say 'Offline: skipping the update check.' 'Yellow' }

# ---- 2. packages (only when requirements changed) --------------------------------------------------
$reqHash = (Get-FileHash tools\requirements.txt, bridge\requirements.txt, package.json | ForEach-Object Hash) -join ''
$reqFile = Join-Path $state 'deps.hash'
if ($Force -or -not (Test-Path $reqFile) -or (Get-Content $reqFile) -ne $reqHash) {
  Say 'Installing Python packages...' 'Cyan'
  & $py -m pip install --quiet --upgrade pip
  & $py -m pip install --quiet -r tools\requirements.txt -r bridge\requirements.txt
  $pipOk = $LASTEXITCODE -eq 0
  if (Get-Command npm -ErrorAction SilentlyContinue) { npm install --no-audit --no-fund --silent | Out-Null }
  if ($pipOk) { Set-Content $reqFile $reqHash } else { Say 'Python packages failed to install; will retry next launch.' 'Red' }
}

# ---- 3. deploy + compile the EA into every MT5 terminal ------------------------------------------
function Deploy-EA {
  $src = Join-Path $PSScriptRoot 'experts\DayRangePredictor.mq5'
  $root = Join-Path $env:APPDATA 'MetaQuotes\Terminal'
  $found = 0
  foreach ($t in (Get-ChildItem $root -Directory -ErrorAction SilentlyContinue)) {
    $experts = Join-Path $t.FullName 'MQL5\Experts'
    $origin = Join-Path $t.FullName 'origin.txt'
    if (-not (Test-Path $experts) -or -not (Test-Path $origin)) { continue }
    $install = (Get-Content $origin -Raw).Trim()
    $editor = [IO.Path]::Combine($install, 'metaeditor64.exe')
    $dest = Join-Path $experts 'DayRangePredictor.mq5'
    Copy-Item $src $dest -Force
    $found++
    if (-not (Test-Path $editor)) { Say "  copied to $experts (MetaEditor not found, compile it once in MetaEditor)" 'Yellow'; continue }
    $log = Join-Path $experts 'DayRangePredictor.log'
    Remove-Item $log -ErrorAction SilentlyContinue
    Start-Process -FilePath $editor -ArgumentList "/compile:`"$dest`"", "/log:`"$log`"" -Wait -WindowStyle Hidden
    $result = if (Test-Path $log) { (Get-Content $log -Encoding Unicode | Select-String 'Result:' | Select-Object -Last 1) } else { $null }
    if ($result -and $result -match 'Result: 0 errors') { Say "  EA compiled for $install  ($result)" 'Green' }
    else {
      Say "  EA compile problem for $install. Details: $log" 'Red'
      if (Test-Path $log) { Get-Content $log -Encoding Unicode | Select-String 'error' | Select-Object -First 5 | ForEach-Object { Say "    $_" 'Red' } }
    }
  }
  if ($found -eq 0) { Say 'MetaTrader 5 not found. Install MT5 from your broker, open it once, then run this again.' 'Yellow' }
}
Say 'Deploying the EA to MetaTrader 5...' 'Cyan'
Deploy-EA

# ---- 4. local AI model -------------------------------------------------------------------------------
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $NoAI -and $ollama) {
  $model = 'llama3.2:3b'
  if (Test-Path ai\config.json) { try { $model = (Get-Content ai\config.json -Raw | ConvertFrom-Json).ollama_model } catch {} }
  if (-not (Get-Process ollama -ErrorAction SilentlyContinue)) { Start-Process ollama -ArgumentList 'serve' -WindowStyle Hidden; Start-Sleep 3 }
  if (-not ((ollama list) -match [regex]::Escape($model.Split(':')[0]))) { Say "Downloading the AI model $model (one time)..." 'Cyan'; ollama pull $model }
}

# ---- 5. weekly retrain (background) -------------------------------------------------------------------
$report = Join-Path $PSScriptRoot 'reports\training_report.md'
$stale = (-not (Test-Path $report)) -or ((Get-Date) - (Get-Item $report).LastWriteTime).TotalDays -gt 7
if ($Retrain -or ($stale -and -not $NoStart)) {
  Say 'Retraining on the latest market data (takes a few minutes)...' 'Cyan'
  & $py tools\train_drp.py
  Deploy-EA
}

if ($NoStart) { Say 'Done.' 'Green'; return }

# ---- 6. start everything ------------------------------------------------------------------------------
if (-not $NoAI) {
  Start-Process $py -ArgumentList 'ai\service.py' -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
  Say 'AI service started (minimized): http://127.0.0.1:8766/ai'
}
Start-Process $py -ArgumentList 'bridge\mt5_bridge.py' -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
Say 'MT5 bridge started (minimized).'
if ($Charts) { Start-Process (Join-Path $PSScriptRoot 'start.bat') -WorkingDirectory $PSScriptRoot }

$terminal = Get-ChildItem (Join-Path $env:APPDATA 'MetaQuotes\Terminal') -Directory -ErrorAction SilentlyContinue |
  ForEach-Object { $o = Join-Path $_.FullName 'origin.txt'; if (Test-Path $o) { [IO.Path]::Combine((Get-Content $o -Raw).Trim(), 'terminal64.exe') } } |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if ($terminal -and -not (Get-Process terminal64 -ErrorAction SilentlyContinue)) { Start-Process $terminal; Say "Opened $terminal" }
Say "`nReady. In MT5: Navigator > Expert Advisors > DayRangePredictor, drag it onto a US100 or XAUUSD M5 chart." 'Green'
Say 'You can close this window; the AI service and bridge keep running in their own windows.'
Start-Sleep 8
