'use strict'

// Local, least-privilege configuration manager inspired by CC Switch.
// Only logical targets declared in CLIENT_DEFINITIONS can ever be read or written.
const fs = require('node:fs')
const fsp = fs.promises
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')

const CLIENT_DEFINITIONS = Object.freeze({
  codex: { label: 'codex', command: 'codex', processNames: ['ChatGPT.exe', 'codex.exe'], files: { config: ['.codex', 'config.toml'], auth: ['.codex', 'auth.json'] } },
  'codex-websocket': { label: 'codex (WebSocket)', command: 'codex', processNames: ['ChatGPT.exe', 'codex.exe'], files: { config: ['.codex', 'config.toml'], auth: ['.codex', 'auth.json'] } },
  opencode: { label: 'OpenCode', command: 'opencode', files: { config: ['.config', 'opencode', 'opencode.json'] } },
})

const SECRET_KEY = /(?:key|token|secret|password|authorization|api[-_]?key|credential)/i
const PROFILE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/

function clone(value) { return JSON.parse(JSON.stringify(value)) }
function now() { return new Date().toISOString() }
function jsonPath(value, prefix = '') {
  if (!value || typeof value !== 'object') return { keys: [], secrets: 0, providers: [], models: [] }
  const result = { keys: [], secrets: 0, providers: [], models: [] }
  for (const [key, child] of Object.entries(value)) {
    const p = prefix ? `${prefix}.${key}` : key
    result.keys.push(p)
    if (SECRET_KEY.test(key)) result.secrets++
    if (/provider/i.test(key) && child && typeof child === 'object') result.providers.push(...Object.keys(child).slice(0, 100))
    if (/model/i.test(key) && typeof child === 'string') result.models.push(child)
    const nested = jsonPath(child, p)
    result.keys.push(...nested.keys); result.secrets += nested.secrets
    result.providers.push(...nested.providers); result.models.push(...nested.models)
  }
  return result
}

function summarize(raw, fileName) {
  const out = { format: path.extname(fileName).toLowerCase().replace('.', '') || 'text', bytes: Buffer.byteLength(raw), parseValid: false, topLevelKeys: [], providers: [], models: [], secretFieldCount: 0 }
  if (out.format === 'json') {
    try {
      const data = JSON.parse(raw); const info = jsonPath(data)
      out.parseValid = true; out.topLevelKeys = Object.keys(data || {}).slice(0, 100); out.providers = [...new Set(info.providers)].slice(0, 100); out.models = [...new Set(info.models)].slice(0, 100); out.secretFieldCount = info.secrets
    } catch (_) { /* JSON5 and partially edited files are reported, never rewritten implicitly. */ }
  }
  if (!out.parseValid) {
    out.topLevelKeys = raw.split(/\r?\n/).map((line) => {
      const match = line.match(/^\s*(?:\[([^\]]+)\]|([A-Za-z_][\w-]*))\s*(?:=|:)/)
      return match && (match[1] || match[2])
    }).filter(Boolean).slice(0, 100)
    out.secretFieldCount = raw.split(/\r?\n/).filter(line => SECRET_KEY.test(line.split(/[=:]/)[0] || '')).length
  }
  return out
}

function safeClient(clientId) {
  if (!Object.prototype.hasOwnProperty.call(CLIENT_DEFINITIONS, clientId)) throw new Error(`Unknown client: ${clientId}`)
  return CLIENT_DEFINITIONS[clientId]
}

function createConfigService(options = {}) {
  const homeDir = path.resolve(options.homeDir || process.env.USERPROFILE || process.env.HOME || require('node:os').homedir())
  const appData = path.resolve(options.appDataDir || process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'AIHub Desktop', 'config-switch')
  const localAppData = path.resolve(options.localAppDataDir || process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'))
  const profileFile = path.join(appData, 'profiles.json')
  const currentFile = path.join(appData, 'current.json')
  const backupRoot = path.join(appData, 'backups')
  const failAt = options.faultInjector && options.faultInjector.failAfterWrites
  const detectInstall = options.detectInstall ?? (!options.homeDir && process.env.AIHUB_DISABLE_INSTALL_DETECTION !== '1')
  const executableResolver = options.executableResolver
  const installDetectionCacheMs = options.installDetectionCacheMs ?? 30000
  let queue = Promise.resolve()
  let scanPromise = null
  const executableCache = new Map()
  const executableInflight = new Map()

  const serial = (fn) => { const run = queue.then(fn); queue = run.catch(() => {}); return run }
  const targetPath = (clientId, targetId) => {
    const def = safeClient(clientId); const parts = def.files[targetId]
    if (!parts) throw new Error(`Unknown target '${targetId}' for ${clientId}`)
    const base = homeDir
    const resolved = path.resolve(base, ...parts)
    const allowed = path.resolve(base, parts.slice(0, -1).join(path.sep) || '.')
    if (resolved !== path.resolve(allowed, parts[parts.length - 1]) || !resolved.startsWith(allowed + path.sep)) throw new Error('Target path escaped allowlist')
    return resolved
  }
  const readCurrent = async () => { try { return JSON.parse(await fsp.readFile(currentFile, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return {}; throw e } }
  const readProfilesRaw = async () => { try { return JSON.parse(await fsp.readFile(profileFile, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return []; throw e } }
  const readProfiles = readProfilesRaw
  const writeAtomic = async (file, data) => {
    await fsp.mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.aihub-${process.pid}-${crypto.randomBytes(5).toString('hex')}.tmp`
    try { await fsp.writeFile(temp, data, { flag: 'wx', mode: 0o600 }); await fsp.rename(temp, file) } finally { await fsp.rm(temp, { force: true }).catch(() => {}) }
  }
  const metadata = p => ({ id: p.id, clientId: p.clientId, name: p.name, source: p.source || 'saved', createdAt: p.createdAt, updatedAt: p.updatedAt, targets: Object.keys(p.files) })

  const findExecutableUncached = async (clientId) => {
    if (typeof executableResolver === 'function') {
      const resolved = await executableResolver(clientId)
      return resolved && path.isAbsolute(resolved) && fs.existsSync(resolved) ? path.resolve(resolved) : null
    }
    if (!detectInstall) return null
    const command = safeClient(clientId).command
    const fromPath = await new Promise((resolve) => {
      execFile(process.platform === 'win32' ? 'where.exe' : 'which', [command], { windowsHide: true, timeout: 2500 }, (error, stdout) => {
        if (error) return resolve(null)
        const first = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean)
        resolve(first ? path.resolve(first) : null)
      })
    })
    if (fromPath && fs.existsSync(fromPath)) return fromPath
    const def = safeClient(clientId)
    // Desktop clients often bundle their CLI inside the app and do not register it in PATH.
    // Query running processes so portable and custom-drive installs are recognized too.
    if (def.processNames?.length && process.platform === 'win32') {
      const names = def.processNames.map((name) => `'${path.basename(name, '.exe').replace(/'/g, "''")}'`).join(',')
      const running = await new Promise((resolve) => {
        const script = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Get-Process -Name ${names} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path`
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 3500, maxBuffer: 1024 * 1024 }, (error, stdout) => {
          if (error) return resolve([])
          resolve(String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => path.isAbsolute(line) && fs.existsSync(line)))
        })
      })
      const preferred = running.find((candidate) => path.basename(candidate).toLowerCase() === 'chatgpt.exe') || running[0]
      if (preferred) return path.resolve(preferred)
    }
    const roots = [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env.ProgramW6432, homeDir].filter(Boolean)
    const candidates = roots.flatMap((root) => [
      path.join(root, 'npm', `${command}.cmd`), path.join(root, 'npm', `${command}.exe`),
      path.join(root, '.local', 'bin', `${command}.exe`), path.join(root, '.local', 'bin', command),
      ...(clientId.startsWith('codex') ? [path.join(root, 'Codex', 'Codex.exe'), path.join(root, 'Codex', 'ChatGPT.exe'), path.join(root, 'Programs', 'Codex', 'Codex.exe')] : []),
    ])
    return candidates.find((candidate) => fs.existsSync(candidate)) || null
  }

  const findExecutable = async (clientId) => {
    const def = safeClient(clientId)
    // Injected resolvers are used by tests and integrations and may change
    // between calls; only cache real OS-level detection.
    if (typeof executableResolver === 'function') return findExecutableUncached(clientId)
    const cacheKey = `${def.command}|${(def.processNames || []).join('|')}`
    const cached = executableCache.get(cacheKey)
    if (cached && Date.now() - cached.checkedAt < installDetectionCacheMs) {
      if (!cached.path || fs.existsSync(cached.path)) return cached.path
      executableCache.delete(cacheKey)
    }
    if (executableInflight.has(cacheKey)) return executableInflight.get(cacheKey)
    const pending = findExecutableUncached(clientId)
      .then((resolved) => {
        executableCache.set(cacheKey, { path: resolved, checkedAt: Date.now() })
        return resolved
      })
      .finally(() => executableInflight.delete(cacheKey))
    executableInflight.set(cacheKey, pending)
    return pending
  }

  async function scanLocalConfigs() {
    if (scanPromise) return scanPromise
    scanPromise = (async () => {
      const all = await readProfilesRaw()
      const current = await readCurrent()
      let changed = false
      for (const [clientId, def] of Object.entries(CLIENT_DEFINITIONS)) {
        const files = {}
        for (const targetId of Object.keys(def.files)) {
          try { files[targetId] = await fsp.readFile(targetPath(clientId, targetId), 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
        }
        if (!Object.keys(files).length) continue
        const detected = all.find((profile) => profile.clientId === clientId && (profile.source === 'detected' || profile.source === 'imported' || profile.id === `imported-${clientId}` || profile.id === `detected-${clientId}`))
        if (detected) {
          if (JSON.stringify(detected.files) !== JSON.stringify(files) || detected.source !== 'detected' || detected.name !== '本机当前配置') {
            detected.files = files
            detected.name = '本机当前配置'
            detected.source = 'detected'
            detected.updatedAt = now()
            changed = true
          }
        } else {
          const id = `detected-${clientId}`
          all.push({ id, clientId, name: '本机当前配置', source: 'detected', files, createdAt: now(), updatedAt: now() })
          if (!current[clientId]) current[clientId] = id
          changed = true
        }
      }
      if (changed) {
        await writeAtomic(profileFile, JSON.stringify(all, null, 2))
        await writeAtomic(currentFile, JSON.stringify(current, null, 2))
      }
      return { changed }
    })().finally(() => { scanPromise = null })
    return scanPromise
  }

  async function listClients() { return Object.entries(CLIENT_DEFINITIONS).map(([id, d]) => ({ id, label: d.label, targets: Object.keys(d.files) })) }
  async function getClientState(clientId) {
    await scanLocalConfigs()
    const def = safeClient(clientId); const files = {}
    for (const targetId of Object.keys(def.files)) { const file = targetPath(clientId, targetId); try { const st = await fsp.stat(file); const raw = await fsp.readFile(file, 'utf8'); files[targetId] = { path: file, exists: true, size: st.size, modifiedAt: st.mtime.toISOString(), summary: summarize(raw, file) } } catch (e) { if (e.code !== 'ENOENT') throw e; files[targetId] = { path: file, exists: false, size: 0, summary: null } } }
    const current = await readCurrent()
    const executablePath = await findExecutable(clientId)
    return { id: clientId, label: def.label, installed: Boolean(executablePath), installPath: executablePath, installDir: executablePath ? path.dirname(executablePath) : null, currentProfileId: current[clientId] || null, files }
  }
  async function listProfiles(clientId) { if (clientId) safeClient(clientId); await scanLocalConfigs(); const all = await readProfiles(); return all.filter(p => !clientId || p.clientId === clientId).map(metadata) }
  async function getProfile(profileId) { if (!PROFILE_ID.test(String(profileId || ''))) throw new Error('Invalid profile id'); await scanLocalConfigs(); const profile = (await readProfiles()).find(p => p.id === profileId); if (!profile) throw new Error('Profile not found'); return clone({ id: profile.id, clientId: profile.clientId, name: profile.name, source: profile.source || 'saved', files: profile.files }) }
  async function upsertProfile(input) { return serial(async () => { safeClient(input.clientId); if (!input || typeof input.name !== 'string' || !input.name.trim()) throw new Error('Profile name is required'); const files = input.files || {}; for (const [target, content] of Object.entries(files)) { targetPath(input.clientId, target); if (typeof content !== 'string' || Buffer.byteLength(content) > 10 * 1024 * 1024) throw new Error(`Invalid content for ${target}`) } const all = await readProfiles(); const id = input.id || crypto.randomUUID(); if (!PROFILE_ID.test(id)) throw new Error('Invalid profile id'); const old = all.find(p => p.id === id); if (old && old.clientId !== input.clientId) throw new Error('Profile client cannot change'); const item = { id, clientId: input.clientId, name: input.name.trim().slice(0, 120), files: clone(files), createdAt: old?.createdAt || now(), updatedAt: now() }; const next = [...all.filter(p => p.id !== id), item]; await writeAtomic(profileFile, JSON.stringify(next, null, 2)); return metadata(item) }) }
  async function deleteProfile(id) { return serial(async () => { const all = await readProfiles(); await writeAtomic(profileFile, JSON.stringify(all.filter(p => p.id !== id), null, 2)); const current = await readCurrent(); for (const clientId of Object.keys(current)) if (current[clientId] === id) delete current[clientId]; await writeAtomic(currentFile, JSON.stringify(current, null, 2)); return true }) }
  async function createBackup(clientId, originals) { const id = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`; const dir = path.join(backupRoot, clientId, id); await fsp.mkdir(dir, { recursive: true }); const manifest = { id, clientId, createdAt: now(), files: {} }; for (const [target, snap] of Object.entries(originals)) { manifest.files[target] = { existed: !!snap, file: `${target}.bak` }; if (snap) await fsp.writeFile(path.join(dir, manifest.files[target].file), snap, { mode: 0o600 }) } await writeAtomic(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2)); return id }
  async function switchProfile({ clientId, profileId }) { return serial(async () => { safeClient(clientId); const profile = (await readProfiles()).find(p => p.id === profileId && p.clientId === clientId); if (!profile) throw new Error('Profile not found'); const originals = {}; for (const target of Object.keys(profile.files)) { const file = targetPath(clientId, target); try { originals[target] = await fsp.readFile(file) } catch (e) { if (e.code !== 'ENOENT') throw e; originals[target] = null } } const backupId = await createBackup(clientId, originals); const written = []; try { for (const [target, content] of Object.entries(profile.files)) { if (failAt && written.length >= failAt) throw new Error('Injected write failure'); await writeAtomic(targetPath(clientId, target), content); written.push(target) } } catch (error) { for (const [target, snap] of Object.entries(originals)) { const file = targetPath(clientId, target); if (snap === null) await fsp.rm(file, { force: true }); else await writeAtomic(file, snap) } throw Object.assign(new Error(`Profile switch rolled back: ${error.message}`), { cause: error, backupId }) } const current = await readCurrent(); current[clientId] = profileId; await writeAtomic(currentFile, JSON.stringify(current, null, 2)); return { clientId, profileId, backupId, writtenTargets: written } }) }
  async function listBackups(clientId) { safeClient(clientId); const dir = path.join(backupRoot, clientId); let names = []; try { names = await fsp.readdir(dir) } catch (e) { if (e.code !== 'ENOENT') throw e; return [] } const out = []; for (const id of names) { if (!/^[0-9]+-[a-f0-9]+$/.test(id)) continue; try { const m = JSON.parse(await fsp.readFile(path.join(dir, id, 'manifest.json'), 'utf8')); out.push({ id: m.id, clientId: m.clientId, createdAt: m.createdAt, targets: Object.keys(m.files) }) } catch (_) {} } return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  async function restoreBackup({ clientId, backupId }) { return serial(async () => { safeClient(clientId); if (!/^[0-9]+-[a-f0-9]+$/.test(backupId)) throw new Error('Invalid backup id'); const dir = path.join(backupRoot, clientId, backupId); const manifest = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8')); if (manifest.clientId !== clientId || manifest.id !== backupId) throw new Error('Backup manifest mismatch'); for (const [target, info] of Object.entries(manifest.files)) { const file = targetPath(clientId, target); if (info.file !== `${target}.bak`) throw new Error('Invalid backup file mapping'); if (info.existed) await writeAtomic(file, await fsp.readFile(path.join(dir, info.file))); else await fsp.rm(file, { force: true }) } const current = await readCurrent(); if (current[clientId]) delete current[clientId]; await writeAtomic(currentFile, JSON.stringify(current, null, 2)); return { clientId, backupId, restoredTargets: Object.keys(manifest.files) } }) }
  return { listClients, scanLocalConfigs, getClientState, listProfiles, getProfile, upsertProfile, deleteProfile, switchProfile, listBackups, restoreBackup }
}

module.exports = { CLIENT_DEFINITIONS, createConfigService }
