'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { _electron: electron } = require('playwright-core')

const root = path.resolve(__dirname, '..')
const STARTUP_EVENTS = ['app.ready', 'window.create.begin', 'config.scan.finished']

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Second instance did not exit in time')), timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}

function countStartupEvents(contents) {
  const counts = Object.fromEntries(STARTUP_EVENTS.map((event) => [event, 0]))
  for (const line of contents.split(/\r?\n/)) {
    const event = line.match(/^\S+\s+(\S+)/)?.[1]
    if (event in counts) counts[event] += 1
  }
  return counts
}

async function waitForValue(readValue, isReady, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  let value
  while (Date.now() < deadline) {
    value = await readValue()
    if (isReady(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(value)}`)
}

async function readStartupCounts(logPath) {
  const contents = await fs.readFile(logPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  return countStartupEvents(contents)
}

async function run() {
  const mainSource = await fs.readFile(path.join(root, 'src', 'main.cjs'), 'utf8')
  assert.match(
    mainSource,
    /app\.on\('activate', \(\) => \{\s+if \(!hasSingleInstanceLock\) return\s+if \(BrowserWindow\.getAllWindows\(\)\.length === 0\) createWindow\(\)\s+\}\)/,
  )

  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-single-instance-'))
  const userDataDir = path.join(sandbox, 'electron')
  const homeDir = path.join(sandbox, 'profile')
  const appDataDir = path.join(sandbox, 'appdata')
  const localAppDataDir = path.join(sandbox, 'localappdata')
  await Promise.all([homeDir, appDataDir, localAppDataDir].map((directory) => fs.mkdir(directory, { recursive: true })))
  const env = {
    ...process.env,
    AIHUB_DISABLE_INSTALL_DETECTION: '1',
    USERPROFILE: homeDir,
    HOME: homeDir,
    APPDATA: appDataDir,
    LOCALAPPDATA: localAppDataDir,
  }
  const args = ['.', `--user-data-dir=${userDataDir}`]
  const startupLogPath = path.join(userDataDir, 'startup.log')
  let first
  let second
  try {
    first = await electron.launch({ executablePath: require('electron'), args, cwd: root, env })
    const page = await first.firstWindow()
    await page.waitForSelector('#login-view:not(.hidden)')
    const initialCounts = await waitForValue(
      () => readStartupCounts(startupLogPath),
      (counts) => counts['config.scan.finished'] === 1,
      'the first instance config.scan.finished startup log',
    )
    assert.deepEqual(initialCounts, {
      'app.ready': 1,
      'window.create.begin': 1,
      'config.scan.finished': 1,
    })

    await first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
    assert.equal(await first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false)

    second = spawn(require('electron'), args, { cwd: root, env, stdio: 'ignore', windowsHide: true })
    const result = await waitForExit(second, 5000)
    assert.equal(result.code, 0)

    const finalCounts = await readStartupCounts(startupLogPath)
    assert.deepEqual(finalCounts, {
      'app.ready': 1,
      'window.create.begin': 1,
      'config.scan.finished': 1,
    })

    const state = await waitForValue(
      () => first.evaluate(({ BrowserWindow }) => ({
        count: BrowserWindow.getAllWindows().length,
        visible: BrowserWindow.getAllWindows()[0].isVisible(),
        minimized: BrowserWindow.getAllWindows()[0].isMinimized(),
        focused: BrowserWindow.getAllWindows()[0].isFocused(),
      })),
      (windowState) => windowState.count === 1 && windowState.visible && !windowState.minimized && windowState.focused,
      'the primary BrowserWindow to be restored and focused',
    )
    assert.deepEqual(state, { count: 1, visible: true, minimized: false, focused: true })
    console.log(JSON.stringify({ ok: true, secondExited: true, firstWindowRestored: true, firstWindowFocused: true, windowCount: 1, startupCounts: finalCounts }))
  } finally {
    if (second && second.exitCode === null) {
      second.kill()
      await waitForExit(second, 5000).catch(() => {})
    }
    if (first) await first.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await fs.rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
