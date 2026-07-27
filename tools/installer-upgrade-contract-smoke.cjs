'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const nsis = pkg.build.nsis
const rendererSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8')

assert.equal(pkg.version, '1.1.0')
assert.match(rendererSource, /const APP_VERSION = '1\.1\.0'/)
assert.doesNotMatch(rendererSource, /renderPlans|\/subscriptions|open-purchase-page/)
assert.equal(pkg.build.appId, 'top.aihub.desktop')
assert.equal(nsis.oneClick, false)
assert.equal(nsis.allowToChangeInstallationDirectory, false)
assert.equal(nsis.deleteAppDataOnUninstall, false)
assert.equal(nsis.script, 'build/installer.nsi')
assert.equal(nsis.include, 'build/installer.nsh')

const installerScript = fs.readFileSync(path.join(root, nsis.script), 'utf8')
const installerInclude = fs.readFileSync(path.join(root, nsis.include), 'utf8')
const overwriteSection = fs.readFileSync(path.join(root, 'build', 'overwriteInstallSection.nsh'), 'utf8')

const overwriteSectionIncluded = /!include\s+"overwriteInstallSection\.nsh"/.test(installerScript)
const stockSectionIncluded = /!include\s+"installSection\.nsh"/.test(installerScript)
assert.equal(overwriteSectionIncluded, true)
assert.equal(stockSectionIncluded, false)
assert.match(installerInclude, /!define\s+AIHUB_PROJECT_NSIS_RESOURCES\s+1/)
assert.match(
  installerScript,
  /!ifndef BUILD_UNINSTALLER\s+!define BUILD_UNINSTALLER[\s\S]*!define AIHUB_UNINSTALL_CONTEXT\s+!include "uninstaller\.nsh"\s+!undef AIHUB_UNINSTALL_CONTEXT\s+!undef BUILD_UNINSTALLER\s+!endif/,
)
assert.match(installerScript, /!include "aihubAllowOnlyOneInstallerInstance\.nsh"/)
assert.match(installerScript, /!include "aihubInstallUtil\.nsh"/)
assert.match(
  installerScript,
  /!define BUILD_UNINSTALLER[\s\S]*!insertmacro MUI_UNPAGE_WELCOME[\s\S]*!insertmacro MUI_UNPAGE_INSTFILES[\s\S]*!insertmacro MUI_UNPAGE_FINISH[\s\S]*!include "uninstaller\.nsh"[\s\S]*!undef BUILD_UNINSTALLER/,
)

const requiredOverwriteFlow = [
  /!insertmacro CHECK_APP_RUNNING/,
  /!insertMacro setIsTryToKeepShortcuts/,
  /ReadRegStr \$R1 SHELL_CONTEXT "\$\{INSTALL_REGISTRY_KEY\}" KeepShortcuts/,
  /!insertmacro installApplicationFiles/,
  /!insertmacro registryAddInstallInfo/,
  /!insertmacro addStartMenuLink \$keepShortcuts/,
  /!insertmacro addDesktopLink \$keepShortcuts/,
  /!ifmacrodef registerFileAssociations/,
  /!ifmacrodef customInstall/,
  /!ifdef RUN_AFTER_FINISH/,
  /!insertmacro StartApp/,
  /WriteUninstaller "\$INSTDIR\\\$\{UNINSTALL_FILENAME\}"/,
]
const overwriteFlowPreserved = requiredOverwriteFlow.every((pattern) => pattern.test(overwriteSection))
assert.equal(overwriteFlowPreserved, true)

const forbiddenOldUninstallerTokens = [
  /uninstallOldVersion/i,
  /handleUninstallResult/i,
  /ExecWait[^\r\n]*\/S\b/i,
  /KEEP_APP_DATA/i,
]
const silentUninstallPresent = forbiddenOldUninstallerTokens.some((pattern) => pattern.test(overwriteSection))
assert.equal(silentUninstallPresent, false)

const pending = fs.readFileSync(path.join(root, 'docs', 'release-notes', 'pending.md'), 'utf8')
assert.match(pending, /覆盖原安装目录/)
assert.match(pending, /单实例/)
assert.match(pending, /不执行静默卸载/)
assert.match(pending, /保留用户数据/)
assert.match(pending, /唤醒并聚焦/)
assert.doesNotMatch(pending, /^# 1\.0\.6/m)

const upgradeContractSatisfied = overwriteSectionIncluded && !stockSectionIncluded && overwriteFlowPreserved && !silentUninstallPresent
assert.equal(upgradeContractSatisfied, true)

console.log(JSON.stringify({
  ok: upgradeContractSatisfied,
  version: pkg.version,
  upgrade: upgradeContractSatisfied ? 'overwrite-existing-directory' : 'invalid',
  silentUninstall: silentUninstallPresent,
}))
