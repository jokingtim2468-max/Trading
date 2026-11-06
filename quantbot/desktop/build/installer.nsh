; QuantBot setup: close every QuantBot process before installing, so no file is locked, and never stop the install
; because the old version's uninstaller failed (its files are simply overwritten).

!macro quantbotKillAll
  DetailPrint "Closing QuantBot..."
  nsExec::Exec 'taskkill /F /T /IM "QuantBot.exe"'
  Pop $0
  ; any other process with QuantBot in its name or running from a QuantBot folder (not this setup / an uninstaller),
  ; and the MT5 auto-login daemon (python mt5_manager.py)
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$me = $$PID; Get-CimInstance Win32_Process | Where-Object { $$_.ProcessId -ne $$me -and $$_.Name -notmatch 'setup|uninst|un_a' -and ($$_.Name -match 'quantbot' -or $$_.ExecutablePath -match '\\quantbot[^\\]*\\' -or $$_.CommandLine -match 'mt5_manager\.py') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  Sleep 1500
!macroend

!macro customInit
  !insertmacro quantbotKillAll
  ; Skip the old version's uninstaller: versions before 1.0.168 shipped one that stops with "QuantBot cannot be
  ; closed" / "Failed to uninstall old application files". Without its UninstallString the setup simply installs over
  ; the old files (your data in %APPDATA%\QuantBot is never touched); the new install writes fresh uninstall entries.
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY}" UninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
  !endif
  ClearErrors
!macroend

; Replaces "QuantBot cannot be closed. Please close it manually": close it ourselves
!macro customCheckAppRunning
  !insertmacro quantbotKillAll
!macroend

; Replaces "Failed to uninstall old application files": keep going, the new files replace the old ones
!macro customUnInstallCheck
  ClearErrors
  ${if} $R0 != 0
    DetailPrint "The old version's uninstaller returned $R0; installing over it."
  ${endif}
!macroend
!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend
