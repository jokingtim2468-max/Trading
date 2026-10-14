# QuantBot installer for Windows. Paste into PowerShell:
#   irm https://raw.githubusercontent.com/jokingtim2468-max/Trading/vibe-coded/clever-thompson-2f91fo/quantbot/installer/install.ps1 | iex
#
# Downloads the newest QuantBot setup (QuantBot-Setup-x.y.z.exe) from the GitHub releases and opens its install
# wizard. The wizard adds QuantBot to the Desktop and Start Menu; after that QuantBot updates itself.
# Chats, tests and keys from the older PowerShell version are copied into the app the first time it opens.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $api = 'https://api.github.com/repos/jokingtim2468-max/Trading/releases/latest'

  Write-Host 'Finding the newest QuantBot...' -ForegroundColor Cyan
  try {
    $release = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'QuantBot-installer' }
  } catch {
    Write-Host 'The QuantBot installer is not published yet (GitHub is still building it). Try again in a few minutes.' -ForegroundColor Yellow
    return
  }
  $asset = $release.assets | Where-Object { $_.name -like 'QuantBot-Setup-*.exe' } | Select-Object -First 1
  if (-not $asset) { throw 'No QuantBot installer in the newest release yet. Try again in a few minutes.' }

  $file = Join-Path $env:TEMP $asset.name
  Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB)) MB)..." -ForegroundColor Cyan
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $file -UseBasicParsing

  Write-Host 'Opening the QuantBot setup wizard.' -ForegroundColor Green
  Start-Process -FilePath $file
}
