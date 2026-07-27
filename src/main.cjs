const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, safeStorage, shell, Tray } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { createConfigService } = require('./config-service.cjs')

// The dashboard is 2D-only. Software rendering avoids a class of invisible
// window failures caused by old, remote-desktop, or vendor GPU drivers.
app.disableHardwareAcceleration()

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

const API_BASE = 'https://aihub.top/api/v1'
const ALLOWED_PREFIXES = [
  '/auth/me',
  '/auth/revoke-all-sessions',
  '/user',
  '/keys',
  '/usage',
  '/subscriptions',
  '/announcements',
  '/redeem',
  '/payment',
  '/invoices',
  '/groups',
  '/public/monitor/summary',
]

let mainWindow
let tray
let isQuitting = false
let session = { accessToken: null, refreshToken: null, email: null }
let pendingLogin = null
const configService = createConfigService()
const CONFIG_METHODS = new Set([
  'listClients',
  'getClientState',
  'listProfiles',
  'getProfile',
  'upsertProfile',
  'deleteProfile',
  'switchProfile',
  'listBackups',
  'restoreBackup',
])

function startupLog(message, detail) {
  try {
    const suffix = detail === undefined ? '' : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
    const userData = app.getPath('userData')
    fs.mkdirSync(userData, { recursive: true })
    fs.appendFileSync(path.join(userData, 'startup.log'), `${new Date().toISOString()} ${message}${suffix}\n`, 'utf8')
  } catch {
    // Diagnostics must never prevent the app from starting.
  }
}

function sessionFile() {
  return path.join(app.getPath('userData'), 'session.json')
}

function preferencesFile() {
  return path.join(app.getPath('userData'), 'preferences.json')
}

function readRememberedAccount() {
  try {
    const saved = JSON.parse(fs.readFileSync(preferencesFile(), 'utf8'))
    return typeof saved.rememberedEmail === 'string' ? saved.rememberedEmail : ''
  } catch {
    return ''
  }
}

function updateRememberedAccount(email, rememberAccount) {
  if (!rememberAccount) {
    try {
      fs.rmSync(preferencesFile(), { force: true })
    } catch {
      // Remembering the account is optional and must not block login.
    }
    return
  }
  const rememberedEmail = typeof email === 'string' ? email.trim() : ''
  if (!rememberedEmail) return
  try {
    fs.writeFileSync(preferencesFile(), JSON.stringify({ rememberedEmail }), { mode: 0o600 })
  } catch {
    // Remembering the account is optional and must not block login.
  }
}

function clearSessionFile() {
  try {
    fs.rmSync(sessionFile(), { force: true })
  } catch {
    // The in-memory session is still cleared if local cleanup fails.
  }
}

function saveRefreshToken() {
  if (!session.refreshToken || !safeStorage.isEncryptionAvailable()) return
  const encrypted = safeStorage.encryptString(session.refreshToken).toString('base64')
  fs.writeFileSync(sessionFile(), JSON.stringify({ refreshToken: encrypted, email: session.email }), { mode: 0o600 })
}

function loadRefreshToken() {
  if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(sessionFile())) return false
  try {
    const saved = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'))
    session.refreshToken = safeStorage.decryptString(Buffer.from(saved.refreshToken, 'base64'))
    session.email = saved.email || null
    return true
  } catch {
    clearSessionFile()
    return false
  }
}

async function rawRequest(route, options = {}) {
  let response
  try {
    // Electron's Chromium network stack follows Windows proxy and certificate
    // settings. Node's global fetch does not reliably do this on portable PCs.
    response = await net.fetch(`${API_BASE}${route}`, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'zh-CN',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    })
  } catch (cause) {
    const error = new Error('无法连接 AIHub，请检查网络、系统代理和电脑时间后重试')
    error.code = cause?.name === 'TimeoutError' ? 'NETWORK_TIMEOUT' : 'NETWORK_ERROR'
    error.cause = cause
    throw error
  }
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { message: text || `HTTP ${response.status}` }
  }
  return { response, payload }
}

function unwrap(response, payload) {
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error?.message || `请求失败 (${response.status})`)
    error.status = response.status
    error.code = payload?.code
    throw error
  }
  if (payload && typeof payload === 'object' && 'code' in payload) {
    if (payload.code !== 0) {
      const error = new Error(payload.message || '接口返回错误')
      error.code = payload.code
      throw error
    }
    return payload.data
  }
  return payload
}

async function refreshAccessToken() {
  if (!session.refreshToken) throw new Error('登录已过期，请重新登录')
  const { response, payload } = await rawRequest('/auth/refresh', {
    method: 'POST',
    body: { refresh_token: session.refreshToken },
  })
  const data = unwrap(response, payload)
  session.accessToken = data.access_token
  session.refreshToken = data.refresh_token
  saveRefreshToken()
  return data
}

function isAllowedRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.includes('://') || route.includes('..')) return false
  const pathname = route.split('?')[0]
  if (pathname.startsWith('/admin') || pathname.includes('/admin/')) return false
  return ALLOWED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

async function authenticatedRequest(route, method = 'GET', body) {
  if (!isAllowedRoute(route)) throw new Error('桌面端拒绝访问未授权接口')
  if (!session.accessToken) await refreshAccessToken()
  let result = await rawRequest(route, { method, body, token: session.accessToken })
  if (result.response.status === 401 && session.refreshToken) {
    await refreshAccessToken()
    result = await rawRequest(route, { method, body, token: session.accessToken })
  }
  return unwrap(result.response, result.payload)
}

function publicError(error) {
  return {
    message: error?.message || '请求失败',
    status: error?.status || 0,
    code: error?.code || null,
  }
}

function createWindow() {
  startupLog('window.create.begin', { platform: process.platform, version: process.getSystemVersion(), gpu: 'disabled' })
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#f5f5f7',
    show: true,
    title: 'AIHub Desktop',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f5f5f7',
      symbolColor: '#1d1d1f',
      height: 46,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch((error) => {
    startupLog('window.load.failed', error.message)
    mainWindow?.show()
    dialog.showErrorBox('AIHub Desktop 启动失败', `界面文件加载失败：${error.message}\n\n诊断日志：${path.join(app.getPath('userData'), 'startup.log')}`)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    startupLog('window.load.finished')
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    startupLog('renderer.gone', details)
    dialog.showErrorBox('AIHub Desktop 界面异常退出', `渲染进程已退出（${details.reason}）。请重新打开应用。\n\n诊断日志：${path.join(app.getPath('userData'), 'startup.log')}`)
  })
  mainWindow.on('unresponsive', () => startupLog('window.unresponsive'))
  mainWindow.on('responsive', () => startupLog('window.responsive'))
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      title: '关闭 AIHub Desktop',
      message: '要如何处理当前窗口？',
      detail: '最小化到系统托盘后，仍可从托盘菜单重新打开。',
      buttons: ['取消', '最小化到托盘', '退出软件'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    })
    if (choice === 1) {
      mainWindow.hide()
    } else if (choice === 2) {
      isQuitting = true
      app.quit()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    showMainWindow()
  })
}

function createTray() {
  if (process.platform !== 'win32' || tray) return
  tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.ico'))
  tray.setToolTip('AIHub Desktop')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 AIHub Desktop', click: showMainWindow },
    { type: 'separator' },
    { label: '退出软件', click: () => { isQuitting = true; app.quit() } },
  ]))
  tray.on('click', showMainWindow)
}

ipcMain.handle('auth:login', async (_event, credentials) => {
  try {
    const email = typeof credentials?.email === 'string' ? credentials.email.trim() : ''
    const password = typeof credentials?.password === 'string' ? credentials.password : ''
    const rememberAccount = credentials?.rememberAccount === true
    const { response, payload } = await rawRequest('/auth/login', { method: 'POST', body: { email, password } })
    const data = unwrap(response, payload)
    if (data.requires_2fa) {
      pendingLogin = { email, rememberAccount }
      return { ok: false, requires2FA: true, tempToken: data.temp_token }
    }
    pendingLogin = null
    session = { accessToken: data.access_token, refreshToken: data.refresh_token, email }
    saveRefreshToken()
    updateRememberedAccount(email, rememberAccount)
    return { ok: true, user: data.user }
  } catch (error) {
    pendingLogin = null
    return { ok: false, error: publicError(error) }
  }
})

ipcMain.handle('auth:login-2fa', async (_event, input) => {
  try {
    const { response, payload } = await rawRequest('/auth/login/2fa', { method: 'POST', body: input })
    const data = unwrap(response, payload)
    session.accessToken = data.access_token
    session.refreshToken = data.refresh_token
    session.email = pendingLogin?.email || session.email
    saveRefreshToken()
    if (pendingLogin) updateRememberedAccount(pendingLogin.email, pendingLogin.rememberAccount)
    pendingLogin = null
    return { ok: true, user: data.user }
  } catch (error) {
    return { ok: false, error: publicError(error) }
  }
})

ipcMain.handle('auth:remembered-account', () => ({ email: readRememberedAccount() }))

ipcMain.handle('auth:restore', async () => {
  try {
    if (!session.refreshToken && !loadRefreshToken()) return { ok: false }
    const user = await authenticatedRequest('/auth/me')
    return { ok: true, user }
  } catch {
    session = { accessToken: null, refreshToken: null, email: null }
    clearSessionFile()
    return { ok: false }
  }
})

ipcMain.handle('auth:logout', async () => {
  try {
    if (session.refreshToken) {
      await rawRequest('/auth/logout', {
        method: 'POST',
        token: session.accessToken,
        body: { refresh_token: session.refreshToken },
      })
    }
  } finally {
    session = { accessToken: null, refreshToken: null, email: null }
    clearSessionFile()
  }
  return { ok: true }
})

ipcMain.handle('api:request', async (_event, request) => {
  try {
    const data = await authenticatedRequest(request.route, request.method, request.body)
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: publicError(error) }
  }
})

ipcMain.handle('cc-switch:invoke', async (_event, input) => {
  try {
    if (!input || !CONFIG_METHODS.has(input.method)) throw new Error('不支持的客户端配置操作')
    const args = Array.isArray(input.args) ? input.args : []
    if (args.length > 2) throw new Error('客户端配置参数无效')
    const data = await configService[input.method](...args)
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: publicError(error) }
  }
})

ipcMain.handle('app:open-external', async (_event, url) => {
  if (typeof url === 'string' && url.startsWith('https://')) await shell.openExternal(url)
})

ipcMain.on('app:set-titlebar-theme', (_event, dark) => {
  if (!mainWindow || typeof mainWindow.setTitleBarOverlay !== 'function') return
  mainWindow.setTitleBarOverlay({
    color: dark ? '#0b0c0f' : '#f5f6f8',
    symbolColor: dark ? '#c9d3dc' : '#1f2933',
    height: 46,
  })
})

ipcMain.handle('app:copy-text', (_event, value) => {
  if (typeof value !== 'string' || value.length > 8192) return false
  clipboard.writeText(value)
  return true
})

ipcMain.handle('app:save-text', async (_event, input) => {
  if (!input || typeof input.content !== 'string' || input.content.length > 20 * 1024 * 1024) return { ok: false }
  const suggested = String(input.filename || 'export.csv').replaceAll(/[\\/:*?"<>|]/g, '_')
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出文件',
    defaultPath: path.join(app.getPath('downloads'), suggested),
    filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
  })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  fs.writeFileSync(result.filePath, `\uFEFF${input.content}`, 'utf8')
  return { ok: true, path: result.filePath }
})

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  startupLog('app.ready')
  try {
    createWindow()
    createTray()
  } catch (error) {
    startupLog('window.create.failed', error.message)
    dialog.showErrorBox('AIHub Desktop 启动失败', `无法创建窗口：${error.message}`)
    app.quit()
    return
  }
  configService.scanLocalConfigs()
    .then((result) => startupLog('config.scan.finished', result))
    .catch((error) => startupLog('config.scan.failed', error.message))
})
app.on('before-quit', () => {
  isQuitting = true
  if (tray) {
    tray.destroy()
    tray = null
  }
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (!hasSingleInstanceLock) return
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
