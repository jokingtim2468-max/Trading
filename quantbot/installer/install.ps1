# QuantBot installer for Windows. Paste into PowerShell:
#   irm https://raw.githubusercontent.com/jokingtim2468-max/Trading/vibe-coded/clever-thompson-2f91fo/quantbot/installer/install.ps1 | iex
#
# Downloads the newest QuantBot setup (QuantBot-Setup-x.y.z.exe) from the GitHub releases and opens its install
# wizard. The wizard adds QuantBot to the Desktop and Start Menu; after that QuantBot updates itself.
# Chats, tests and keys from the older PowerShell version are copied into the app the first time it opens.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $api = 'https://api.github.com/repos/jokingtim2468-max/Trading/releases?per_page=20'

  Write-Host 'Finding the newest QuantBot...' -ForegroundColor Cyan
  try {
    $releases = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'QuantBot-installer' }
  } catch {
    Write-Host "Couldn't reach GitHub: $($_.Exception.Message)" -ForegroundColor Yellow
    return
  }
  # The newest published release that has the setup file (skips any release still uploading)
  $asset = $releases | Where-Object { -not $_.draft } | ForEach-Object { $_.assets } |
    Where-Object { $_.name -like 'QuantBot-Setup-*.exe' -and $_.state -eq 'uploaded' } | Select-Object -First 1
  if (-not $asset) {
    Write-Host 'The QuantBot installer is not published yet (GitHub is still building it). Try again in a few minutes.' -ForegroundColor Yellow
    return
  }

  $file = Join-Path $env:TEMP $asset.name
  Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB)) MB)..." -ForegroundColor Cyan
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $file -UseBasicParsing

  Write-Host 'Opening the QuantBot setup wizard.' -ForegroundColor Green
  Start-Process -FilePath $file
}
