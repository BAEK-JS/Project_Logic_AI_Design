; If backend.exe (sidecar) or the main app is still running, the installer cannot
; overwrite files under AppData\Local\Logic Mapper\. Kill them before install/uninstall.
; ExecShellWait + SW_HIDE runs taskkill without showing a console window.
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping Logic Mapper processes (unlock backend.exe)..."
  ExecShellWait "" "$SYSDIR\taskkill.exe" "/F /IM backend.exe /T" SW_HIDE
  ExecShellWait "" "$SYSDIR\taskkill.exe" "/F /IM logic-mapper.exe /T" SW_HIDE
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping Logic Mapper processes before uninstall..."
  ExecShellWait "" "$SYSDIR\taskkill.exe" "/F /IM backend.exe /T" SW_HIDE
  ExecShellWait "" "$SYSDIR\taskkill.exe" "/F /IM logic-mapper.exe /T" SW_HIDE
  Sleep 1500
!macroend
