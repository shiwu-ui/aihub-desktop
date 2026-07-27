# 安装升级与单实例 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保持 `1.0.6`，让 NSIS 安装版覆盖原安装目录，并让第二个 AIHub Desktop 进程退出且唤醒第一个窗口。

**Architecture:** 安装升级由 electron-builder 的稳定 `appId` 和固定 NSIS 安装位置完成，不调用旧版静默卸载。运行时由 Electron `requestSingleInstanceLock()` 建立互斥锁，`second-instance` 事件复用现有 `showMainWindow()` 恢复托盘中的主窗口。

**Tech Stack:** Electron 36、electron-builder 26、NSIS、Node.js、Playwright Electron。

## Global Constraints

- 版本保持 `1.0.6`，不修改当前界面更新日志。
- 不静默执行旧版卸载程序。
- `deleteAppDataOnUninstall` 保持 `false`。
- 不删除登录令牌、记住账号、客户端配置或备份。
- 第二个实例不得创建窗口、托盘或启动本地配置扫描。
- 待发布说明单独记录，下一次功能版本再合并到应用更新日志。
- 当前目录不是 Git 工作树，本计划不执行 Git 提交。

## File Structure

- `package.json`：NSIS 安装位置和测试脚本配置。
- `src/main.cjs`：单实例锁、第二实例唤醒和主进程启动门控。
- `tools/installer-upgrade-contract-smoke.cjs`：安装器升级契约测试。
- `tools/single-instance-smoke.cjs`：真实启动两个 Electron 进程的单实例测试。
- `docs/release-notes/pending.md`：待下次版本写入更新日志的功能记录。

---

### Task 1: 固定 NSIS 升级目录

**Files:**
- Create: `tools/installer-upgrade-contract-smoke.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `package.json.build.nsis`
- Produces: 固定安装目录、保留用户数据且不包含静默卸载脚本的安装契约

- [ ] **Step 1: 写失败的安装器契约测试**

```js
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

assert.equal(pkg.version, '1.0.6')
assert.equal(pkg.build.appId, 'top.aihub.desktop')
assert.equal(pkg.build.nsis.oneClick, false)
assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, false)
assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false)
assert.equal(pkg.build.nsis.include, undefined)

console.log(JSON.stringify({ ok: true, version: pkg.version, upgrade: 'overwrite-existing-directory', silentUninstall: false }))
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
D:\nodejs\node.exe tools\installer-upgrade-contract-smoke.cjs
```

Expected: FAIL，实际 `allowToChangeInstallationDirectory` 为 `true`。

- [ ] **Step 3: 写最小配置实现**

在 `package.json` 增加脚本：

```json
"test:installer-upgrade": "node tools/installer-upgrade-contract-smoke.cjs"
```

将 NSIS 配置改为：

```json
"allowToChangeInstallationDirectory": false,
"deleteAppDataOnUninstall": false
```

不添加 `nsis.include`，从而不执行自定义静默卸载。

- [ ] **Step 4: 运行测试并确认通过**

Run:

```powershell
D:\nodejs\node.exe tools\installer-upgrade-contract-smoke.cjs
```

Expected: PASS，输出 `upgrade: "overwrite-existing-directory"`。

---

### Task 2: Electron 单实例与窗口唤醒

**Files:**
- Create: `tools/single-instance-smoke.cjs`
- Modify: `src/main.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Electron `app.requestSingleInstanceLock()`、`app` 的 `second-instance` 事件、现有 `showMainWindow()`
- Produces: `hasSingleInstanceLock: boolean` 启动门控和第二实例唤醒行为

- [ ] **Step 1: 写真实双进程失败测试**

测试必须完成以下真实行为，不使用渲染层 mock：

```js
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { _electron: electron } = require('playwright-core')

const root = path.resolve(__dirname, '..')

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('第二个实例未及时退出')), timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-single-instance-'))
  const userDataDir = path.join(sandbox, 'electron')
  const args = ['.', `--user-data-dir=${userDataDir}`]
  const first = await electron.launch({ executablePath: require('electron'), args, cwd: root })
  let second
  try {
    const page = await first.firstWindow()
    await page.waitForSelector('#login-view:not(.hidden)')
    await first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
    assert.equal(await first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false)

    second = spawn(require('electron'), args, { cwd: root, stdio: 'ignore', windowsHide: true })
    const result = await waitForExit(second, 5000)
    assert.equal(result.code, 0)

    await page.waitForFunction(() => document.visibilityState === 'visible')
    const state = await first.evaluate(({ BrowserWindow }) => ({
      count: BrowserWindow.getAllWindows().length,
      visible: BrowserWindow.getAllWindows()[0].isVisible(),
      minimized: BrowserWindow.getAllWindows()[0].isMinimized(),
    }))
    assert.deepEqual(state, { count: 1, visible: true, minimized: false })
    console.log(JSON.stringify({ ok: true, secondExited: true, firstWindowRestored: true, windowCount: 1 }))
  } finally {
    if (second && second.exitCode === null) second.kill()
    await first.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await fs.rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
D:\nodejs\node.exe tools\single-instance-smoke.cjs
```

Expected: FAIL，第二个实例不能在 5 秒内退出，或创建了第二个窗口。

- [ ] **Step 3: 在主进程实现最小单实例门控**

在 `src/main.cjs` 的主进程变量附近申请锁：

```js
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
```

在 `showMainWindow()` 定义之后注册唤醒：

```js
if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    showMainWindow()
  })
}
```

在 `app.whenReady()` 的第一行增加门控：

```js
if (!hasSingleInstanceLock) return
```

未取得锁时不调用 `createWindow()`、`createTray()` 或 `configService.scanLocalConfigs()`。

在 `package.json` 增加：

```json
"test:single-instance": "node tools/single-instance-smoke.cjs"
```

- [ ] **Step 4: 运行单实例测试并确认通过**

Run:

```powershell
D:\nodejs\node.exe tools\single-instance-smoke.cjs
```

Expected: PASS，输出 `secondExited: true`、`firstWindowRestored: true`、`windowCount: 1`。

- [ ] **Step 5: 运行托盘契约测试避免回归**

Run:

```powershell
D:\nodejs\node.exe tools\guide-tray-contract-smoke.cjs
```

Expected: PASS；关闭选择和托盘入口仍存在。

---

### Task 3: 记录待发布内容

**Files:**
- Create: `docs/release-notes/pending.md`
- Modify: `tools/installer-upgrade-contract-smoke.cjs`

**Interfaces:**
- Consumes: 当前版本 `1.0.6`
- Produces: 下一次功能版本可直接合并的更新条目

- [ ] **Step 1: 先扩展契约测试读取待发布说明**

```js
const pending = fs.readFileSync(path.join(root, 'docs', 'release-notes', 'pending.md'), 'utf8')
assert.match(pending, /覆盖原安装目录/)
assert.match(pending, /单实例/)
assert.doesNotMatch(pending, /^# 1\.0\.6/m)
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
D:\nodejs\node.exe tools\installer-upgrade-contract-smoke.cjs
```

Expected: FAIL，`docs/release-notes/pending.md` 不存在。

- [ ] **Step 3: 写入待发布说明**

```markdown
# 待发布更新

- 安装新版时自动使用原安装目录覆盖旧程序文件，不执行静默卸载，并保留用户数据。
- 增加应用单实例锁；重复启动时不创建第二个界面，而是唤醒并聚焦已运行窗口。
```

- [ ] **Step 4: 再次运行契约测试并确认通过**

Run:

```powershell
D:\nodejs\node.exe tools\installer-upgrade-contract-smoke.cjs
```

Expected: PASS，版本仍为 `1.0.6`。

---

### Task 4: 回归验证与重新打包

**Files:**
- Verify: `src/main.cjs`
- Verify: `package.json`
- Rebuild: `dist/AIHub-Desktop-1.0.6.exe`
- Rebuild: `dist/AIHub-Desktop-1.0.6-Setup.exe`
- Rebuild: `dist/AIHub-Desktop-1.0.6-win-x64.zip`

**Interfaces:**
- Consumes: Tasks 1-3 的实现
- Produces: 通过测试和 SHA-256 校验的三种 `1.0.6` 分发产物

- [ ] **Step 1: 运行语法与重点回归测试**

```powershell
D:\nodejs\node.exe --check src\main.cjs
D:\nodejs\node.exe --check src\renderer\app.js
D:\nodejs\node.exe tools\installer-upgrade-contract-smoke.cjs
D:\nodejs\node.exe tools\single-instance-smoke.cjs
D:\nodejs\node.exe tools\guide-tray-contract-smoke.cjs
D:\nodejs\node.exe tools\provider-key-features-smoke.cjs
D:\nodejs\node.exe tools\client-config-ui-smoke.cjs
D:\nodejs\node.exe tools\remember-account-smoke.cjs
D:\nodejs\node.exe tools\payment-flow-smoke.cjs
```

Expected: 全部退出码为 `0`，没有第二窗口残留。

- [ ] **Step 2: 重新构建便携版和安装版**

```powershell
$env:Path='D:\nodejs;'+$env:Path
$env:NODE_OPTIONS='--use-system-ca'
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
D:\nodejs\npm.cmd run dist
```

Expected: electron-builder 退出码 `0`，生成便携版和 NSIS 安装版。

- [ ] **Step 3: 替换完整目录 ZIP**

先确认目标严格位于 `D:\bot\desktop-app\dist`，再删除同版本旧目录和 ZIP；复制最新 `win-unpacked` 为 `AIHub-Desktop-1.0.6-win-x64` 并重新压缩。

- [ ] **Step 4: 校验版本、文件和哈希**

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath `
  'D:\bot\desktop-app\dist\AIHub-Desktop-1.0.6.exe', `
  'D:\bot\desktop-app\dist\AIHub-Desktop-1.0.6-Setup.exe', `
  'D:\bot\desktop-app\dist\AIHub-Desktop-1.0.6-win-x64.zip'
```

Expected: 三个文件存在并输出非空 SHA-256；`dist` 和 `dist-release` 中没有 `1.0.7` 产物。
