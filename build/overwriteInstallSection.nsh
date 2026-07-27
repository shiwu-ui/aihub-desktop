!include "extractAppPackage.nsh"

!ifdef APP_PACKAGE_URL
  !include webPackage.nsh
!endif

!macro installApplicationFiles
  !ifdef APP_BUILD_DIR
    File /r "${APP_BUILD_DIR}\*.*"
  !else
    !ifdef APP_PACKAGE_URL
      Var /GLOBAL packageFile
      Var /GLOBAL isPackageFileExplicitlySpecified

      ${StdUtils.GetParameter} $packageFile "package-file" ""
      ${if} $packageFile == ""
        !ifdef APP_64_NAME
          !ifdef APP_32_NAME
            !ifdef APP_ARM64_NAME
              ${if} ${IsNativeARM64}
                StrCpy $packageFile "${APP_ARM64_NAME}"
                StrCpy $1 "${APP_ARM64_HASH}"
              ${elseif} ${IsNativeAMD64}
                StrCpy $packageFile "${APP_64_NAME}"
                StrCpy $1 "${APP_64_HASH}"
              ${else}
                StrCpy $packageFile "${APP_32_NAME}"
                StrCpy $1 "${APP_32_HASH}"
              ${endif}
            !else
              ${if} ${RunningX64}
                StrCpy $packageFile "${APP_64_NAME}"
                StrCpy $1 "${APP_64_HASH}"
              ${else}
                StrCpy $packageFile "${APP_32_NAME}"
                StrCpy $1 "${APP_32_HASH}"
              ${endif}
            !endif
          !else
            StrCpy $packageFile "${APP_64_NAME}"
            StrCpy $1 "${APP_64_HASH}"
          !endif
        !else
          StrCpy $packageFile "${APP_32_NAME}"
          StrCpy $1 "${APP_32_HASH}"
        !endif
        StrCpy $4 "$packageFile"
        StrCpy $packageFile "$EXEDIR/$packageFile"
        StrCpy $isPackageFileExplicitlySpecified "false"
      ${else}
        StrCpy $isPackageFileExplicitlySpecified "true"
      ${endIf}

      ${if} ${FileExists} "$packageFile"
        ${if} $isPackageFileExplicitlySpecified == "true"
          Goto aihub_extract_package
        ${else}
          ${StdUtils.HashFile} $3 "SHA2-512" "$packageFile"
          ${if} $3 == $1
            Goto aihub_extract_package
          ${else}
            MessageBox MB_OK "Package file $4 found locally, but checksum doesn't match - expected $1, actual $3.$\r$\nLocal file is ignored and package will be downloaded from Internet."
          ${endIf}
        ${endIf}
      ${endIf}

      !insertmacro downloadApplicationFiles

      aihub_extract_package:
        !insertmacro extractUsing7za "$packageFile"

        ${if} $installMode == "all"
          SetShellVarContext current
        ${endif}

        !insertmacro moveFile "$packageFile" "$LOCALAPPDATA\${APP_PACKAGE_STORE_FILE}"

        ${if} $installMode == "all"
          SetShellVarContext all
        ${endif}
    !else
      !insertmacro extractEmbeddedAppPackage
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endif}
      !insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    !endif
  !endif

  WriteUninstaller "$INSTDIR\${UNINSTALL_FILENAME}"
!macroend

!macro registryAddInstallInfo
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts "true"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutName "${SHORTCUT_NAME}"
  !ifdef MENU_FILENAME
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" MenuDirectory "${MENU_FILENAME}"
  !endif

  ${if} $installMode == "all"
    StrCpy $0 "/allusers"
    StrCpy $1 ""
  ${else}
    StrCpy $0 "/currentuser"
    StrCpy $1 ""
  ${endIf}

  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayName "${UNINSTALL_DISPLAY_NAME}$1"
  StrCpy $2 "$INSTDIR\${UNINSTALL_FILENAME}"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$2" $0'
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString '"$2" $0 /S'

  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "${VERSION}"
  !ifdef UNINSTALLER_ICON
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayIcon" "$INSTDIR\uninstallerIcon.ico"
  !else
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayIcon" "$appExe,0"
  !endif

  !ifdef COMPANY_NAME
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "Publisher" "${COMPANY_NAME}"
  !endif
  !ifdef APP_DESCRIPTION
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "Comments" "${APP_DESCRIPTION}"
  !endif
  !ifdef UNINSTALL_URL_HELP
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "HelpLink" "${UNINSTALL_URL_HELP}"
  !endif
  !ifdef UNINSTALL_URL_INFO_ABOUT
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "URLInfoAbout" "${UNINSTALL_URL_INFO_ABOUT}"
  !endif
  !ifdef UNINSTALL_URL_UPDATE_INFO
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "URLUpdateInfo" "${UNINSTALL_URL_UPDATE_INFO}"
  !endif
  !ifdef UNINSTALL_URL_README
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "Readme" "${UNINSTALL_URL_README}"
  !endif

  WriteRegDWORD SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" NoModify 1
  WriteRegDWORD SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" NoRepair 1

  !ifdef ESTIMATED_SIZE
    IntFmt $0 "0x%08X" ${ESTIMATED_SIZE}
  !else
    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
  !endif
  WriteRegDWORD SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "EstimatedSize" "$0"
!macroend

!macro cleanupOldMenuDirectory
  ${if} $oldMenuDirectory != ""
    !ifdef MENU_FILENAME
      ${if} $oldMenuDirectory != "${MENU_FILENAME}"
        RMDir "$SMPROGRAMS\$oldMenuDirectory"
      ${endIf}
    !else
      RMDir "$SMPROGRAMS\$oldMenuDirectory"
    !endif
  ${endIf}
!macroend

!macro createMenuDirectory
  !ifdef MENU_FILENAME
    CreateDirectory "$SMPROGRAMS\${MENU_FILENAME}"
    ClearErrors
  !endif
!macroend

!macro addStartMenuLink keepShortcuts
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${if} $keepShortcuts == "false"
      !insertmacro cleanupOldMenuDirectory
      !insertmacro createMenuDirectory
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${elseif} $oldStartMenuLink != $newStartMenuLink
    ${andIf} ${FileExists} "$oldStartMenuLink"
      !insertmacro createMenuDirectory
      Rename $oldStartMenuLink $newStartMenuLink
      WinShell::UninstShortcut "$oldStartMenuLink"
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
      !insertmacro cleanupOldMenuDirectory
    ${endIf}
  !endif
!macroend

!macro addDesktopLink keepShortcuts
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${ifNot} ${isNoDesktopShortcut}
      ${if} $keepShortcuts == "false"
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ${elseif} $oldDesktopLink != $newDesktopLink
      ${andIf} ${FileExists} "$oldDesktopLink"
        Rename $oldDesktopLink $newDesktopLink
        WinShell::UninstShortcut "$oldDesktopLink"
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      !ifdef RECREATE_DESKTOP_SHORTCUT
      ${elseif} $oldDesktopLink != $newDesktopLink
      ${orIfNot} ${FileExists} "$oldDesktopLink"
        ${ifNot} ${isUpdated}
          CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
          ClearErrors
          WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
        ${endIf}
      !endif
      ${endIf}
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${endIf}
  !endif
!macroend

InitPluginsDir

${IfNot} ${Silent}
  SetDetailsPrint none
${endif}

StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

!insertmacro setLinkVars

!ifdef ONE_CLICK
  !ifdef HEADER_ICO
    File /oname=$PLUGINSDIR\installerHeaderico.ico "${HEADER_ICO}"
  !endif
  ${IfNot} ${Silent}
    !ifdef HEADER_ICO
      SpiderBanner::Show /MODERN /ICON "$PLUGINSDIR\installerHeaderico.ico"
    !else
      SpiderBanner::Show /MODERN
    !endif

    FindWindow $0 "#32770" "" $hwndparent
    FindWindow $0 "#32770" "" $hwndparent $0
    GetDlgItem $0 $0 1000
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$(installing)"

    StrCpy $1 $hwndparent
		System::Call 'user32::ShutdownBlockReasonCreate(${SYSTYPE_PTR}r1, w "$(installing)")'
  ${endif}
  !insertmacro CHECK_APP_RUNNING
!else
  ${ifNot} ${UAC_IsInnerInstance}
    !insertmacro CHECK_APP_RUNNING
  ${endif}
!endif

Var /GLOBAL keepShortcuts
StrCpy $keepShortcuts "false"
!insertMacro setIsTryToKeepShortcuts
${if} $isTryToKeepShortcuts == "true"
  ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts

  ${if} $R1 == "true"
  ${andIf} ${FileExists} "$appExe"
    StrCpy $keepShortcuts "true"
  ${endIf}
${endif}

SetOutPath $INSTDIR

!ifdef UNINSTALLER_ICON
  File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
!endif

!insertmacro installApplicationFiles
!insertmacro registryAddInstallInfo
!insertmacro addStartMenuLink $keepShortcuts
!insertmacro addDesktopLink $keepShortcuts

${if} ${FileExists} "$newStartMenuLink"
  StrCpy $launchLink "$newStartMenuLink"
${else}
  StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
${endIf}

!ifmacrodef registerFileAssociations
  !insertmacro registerFileAssociations
!endif

!ifmacrodef customInstall
  !insertmacro customInstall
!endif

!macro doStartApp
  # otherwise app window will be in background
  HideWindow
  !insertmacro StartApp
!macroend

!ifdef ONE_CLICK
  # https://github.com/electron-userland/electron-builder/pull/3093#issuecomment-403734568
  !ifdef RUN_AFTER_FINISH
    ${ifNot} ${Silent}
    ${orIf} ${isForceRun}
      !insertmacro doStartApp
    ${endIf}
  !else
    ${if} ${isForceRun}
      !insertmacro doStartApp
    ${endIf}
  !endif
  !insertmacro quitSuccess
!else
  # for assisted installer run only if silent, because assisted installer has run after finish option
  ${if} ${isForceRun}
  ${andIf} ${Silent}
    !insertmacro doStartApp
  ${endIf}
!endif
