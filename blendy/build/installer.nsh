!macro customInstall
  DetailPrint "Installing Blendy Local AI Tutor Blender add-on..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\install-blender-addon.ps1" -AppResources "$INSTDIR\resources"'
  Pop $0
  StrCmp $0 "0" blendyAddonInstallDone
  SetErrorLevel 1
  DetailPrint "Blendy desktop installed, but the Blender add-on update failed. See %APPDATA%\Blendy\installer-addons.log."
  IfSilent blendyAddonInstallDone
  MessageBox MB_OK|MB_ICONEXCLAMATION "Blendy desktop was installed, but the Blender add-on could not be updated. Your previous add-on was preserved. See %APPDATA%\Blendy\installer-addons.log for details."
  blendyAddonInstallDone:
!macroend

!macro customUnInstall
  DetailPrint "Removing Blendy-managed Blender add-on..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\uninstall-blender-addon.ps1"'
  Pop $0
  StrCmp $0 "0" blendyAddonUninstallDone
  SetErrorLevel 1
  DetailPrint "The desktop app was removed, but the managed Blender add-on could not be removed. See %APPDATA%\Blendy\installer-addons.log."
  IfSilent blendyAddonUninstallDone
  MessageBox MB_OK|MB_ICONEXCLAMATION "Blendy was removed, but its managed Blender add-on could not be removed. See %APPDATA%\Blendy\installer-addons.log for details."
  blendyAddonUninstallDone:
!macroend
