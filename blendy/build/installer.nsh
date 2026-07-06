!macro customInstall
  DetailPrint "Installing Blendy Local AI Tutor Blender add-on..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\install-blender-addon.ps1" -AppResources "$INSTDIR\resources"'
!macroend
