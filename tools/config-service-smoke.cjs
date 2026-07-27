'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createConfigService } = require('../src/config-service.cjs')

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-config-service-'))
  const homeDir = path.join(sandbox, 'home')
  const appDataDir = path.join(sandbox, 'roaming')
  const localAppDataDir = path.join(sandbox, 'local')
  const make = (extra = {}) => createConfigService({ homeDir, appDataDir, localAppDataDir, ...extra })
  try {
    const service = make()
    const clients = await service.listClients()
    assert.deepEqual(clients.map(c => c.id), ['codex', 'codex-websocket', 'opencode'])
    assert.deepEqual(clients.find(c => c.id === 'codex').targets, ['config', 'auth'])
    assert.deepEqual(clients.find(c => c.id === 'codex-websocket').targets, ['config', 'auth'])

    const originalConfig = 'model = "original"\n'
    const originalAuth = '{"OPENAI_API_KEY":"old-secret"}'
    await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true })
    await fs.writeFile(path.join(homeDir, '.codex', 'config.toml'), originalConfig)
    await fs.writeFile(path.join(homeDir, '.codex', 'auth.json'), originalAuth)

    const state = await service.getClientState('codex')
    assert.equal(state.installed, false, 'isolated test HOME has no installed CLI executable')
    assert.equal(state.installPath, null)
    assert.equal(state.files.auth.summary.secretFieldCount, 1)
    assert.equal(JSON.stringify(state).includes('old-secret'), false, 'summaries must not leak secrets')
    const importedProfiles = await service.listProfiles('codex')
    assert.equal(importedProfiles.length, 1)
    assert.equal(importedProfiles[0].name, '本机当前配置')
    assert.equal(importedProfiles[0].source, 'detected')
    assert.equal(state.currentProfileId, importedProfiles[0].id)

    await fs.writeFile(path.join(homeDir, '.codex', 'config.toml'), 'model = "detected-later"\n')
    await service.scanLocalConfigs()
    const rescannedProfiles = await service.listProfiles('codex')
    assert.equal(rescannedProfiles.filter(profile => profile.source === 'detected').length, 1)
    await fs.writeFile(path.join(homeDir, '.codex', 'config.toml'), originalConfig)
    const detectedSwitch = await service.switchProfile({ clientId: 'codex', profileId: importedProfiles[0].id })
    assert.match(await fs.readFile(path.join(homeDir, '.codex', 'config.toml'), 'utf8'), /detected-later/)
    await service.restoreBackup({ clientId: 'codex', backupId: detectedSwitch.backupId })
    assert.equal(await fs.readFile(path.join(homeDir, '.codex', 'config.toml'), 'utf8'), originalConfig)

    const fakeBin = path.join(sandbox, 'bin')
    const fakeCodex = path.join(fakeBin, 'codex.cmd')
    await fs.mkdir(fakeBin, { recursive: true })
    await fs.writeFile(fakeCodex, '@echo off')
    let exposeInstalledClient = false
    const detectingService = make({ executableResolver: async (clientId) => exposeInstalledClient && clientId === 'codex' ? fakeCodex : null })
    assert.equal((await detectingService.getClientState('codex')).installed, false)
    exposeInstalledClient = true
    const detectedState = await detectingService.getClientState('codex')
    assert.equal(detectedState.installed, true)
    assert.equal(detectedState.installPath, fakeCodex)
    assert.equal(detectedState.installDir, fakeBin)

    const profile = await service.upsertProfile({
      clientId: 'codex', name: 'AIHub', files: {
        config: 'model_provider = "aihub"\n[model_providers.aihub]\nbase_url = "https://aihub.top/v1"\n',
        auth: '{"OPENAI_API_KEY":"new-secret"}',
      },
    })
    assert.deepEqual(profile.targets, ['config', 'auth'])
    assert.equal(JSON.stringify(await service.listProfiles('codex')).includes('new-secret'), false)
    const switched = await service.switchProfile({ clientId: 'codex', profileId: profile.id })
    assert.equal((await service.getClientState('codex')).currentProfileId, profile.id)
    assert.match(await fs.readFile(path.join(homeDir, '.codex', 'config.toml'), 'utf8'), /aihub/)
    assert.match(await fs.readFile(path.join(homeDir, '.codex', 'auth.json'), 'utf8'), /new-secret/)
    assert.equal((await service.listBackups('codex'))[0].id, switched.backupId)
    await service.restoreBackup({ clientId: 'codex', backupId: switched.backupId })
    assert.equal((await service.getClientState('codex')).currentProfileId, null)
    assert.equal(await fs.readFile(path.join(homeDir, '.codex', 'config.toml'), 'utf8'), originalConfig)
    assert.equal(await fs.readFile(path.join(homeDir, '.codex', 'auth.json'), 'utf8'), originalAuth)

    const rollback = make({ faultInjector: { failAfterWrites: 1 } })
    const rollbackProfile = await rollback.upsertProfile({ clientId: 'codex', name: 'Failure', files: { config: 'changed = true\n', auth: '{"bad":true}' } })
    await assert.rejects(rollback.switchProfile({ clientId: 'codex', profileId: rollbackProfile.id }), /rolled back/)
    assert.equal(await fs.readFile(path.join(homeDir, '.codex', 'config.toml'), 'utf8'), originalConfig)
    assert.equal(await fs.readFile(path.join(homeDir, '.codex', 'auth.json'), 'utf8'), originalAuth)

    await assert.rejects(service.upsertProfile({ clientId: 'codex', name: 'Escape', files: { '../outside': 'x' } }), /Unknown target/)
    await assert.rejects(service.getClientState('../outside'), /Unknown client/)
    await assert.rejects(service.restoreBackup({ clientId: 'codex', backupId: '../../outside' }), /Invalid backup id/)

    const expectedPaths = {
      codex: path.join(homeDir, '.codex', 'config.toml'),
      'codex-websocket': path.join(homeDir, '.codex', 'config.toml'),
      opencode: path.join(homeDir, '.config', 'opencode', 'opencode.json'),
    }
    for (const [clientId, expected] of Object.entries(expectedPaths)) {
      const clientState = await service.getClientState(clientId)
      const first = Object.values(clientState.files)[0]
      assert.equal(first.path, expected)
    }
    console.log(JSON.stringify({ ok: true, clients: clients.length, backupRestore: true, rollback: true, pathGuards: true }))
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true })
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
