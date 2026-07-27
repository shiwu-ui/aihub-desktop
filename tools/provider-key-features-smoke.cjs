'use strict'

const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-provider-features-'))
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', `--user-data-dir=${path.join(sandbox, 'electron')}`],
    cwd: root,
  })
  try {
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForSelector('#login-view:not(.hidden)')
    await page.evaluate(async () => {
      document.querySelector('#login-view').classList.add('hidden')
      document.querySelector('#app-view').classList.remove('hidden')
      window.__featureCalls = []
      const groups = [
        { id: 1, name: '基础组', rate_multiplier: 0.01, platform: 'openai' },
        { id: 2, name: '稳定组', rate_multiplier: 0.02, platform: 'openai' },
        { id: 3, name: '备用组', rate_multiplier: 0.015, platform: 'openai' },
      ]
      const key = {
        id: 7, name: 'Codex Key', key: 'sk-mocked-feature', status: 'active', group_id: 1, group: groups[0],
        quota: 0, quota_used: 0, max_rate_multiplier: 0.02, rate_change_notify_enabled: true,
        failover_enabled: true, failover_strategy: 'fastest', failover_group_ids: [3, 2],
        failover_excluded_group_ids: [3], failover_recovery_mode: 'prefer_primary',
        last_used_at: '2026-07-19T01:00:00Z',
      }
      request = async (route, options = {}) => {
        window.__featureCalls.push({ route, method: options.method || 'GET', body: options.body })
        if (route.startsWith('/public/monitor/summary')) return {
          monitoringActive: true, generatedAt: '2026-07-19T01:00:00Z',
          apis: [{ id: 'stable', group_id: 2, planType: '稳定组', platform: 'openai', available: true, priceMultiplier: 0.02, firstTokenLatencyMs: 420, outputTokensPerSecond: 70, inputTokens: 800, outputTokens: 200, cacheHitRate: '样本不足', checkedAt: '2026-07-19T01:00:00Z', successRates: { '6h': 0.99, '24h': 0.98, '7d': 0.97, '30d': 0.96 } }],
        }
        if (route === '/groups/available') return groups
        if (route.startsWith('/keys?')) return { items: [key], total: 1, pages: 1 }
        if (route === '/keys/7' && (!options.method || options.method === 'GET')) return key
        if (route === '/keys/7/group' && options.method === 'PUT') return { ...key, group_id: options.body.group_id }
        if (route === '/keys/7' && options.method === 'PUT') return { ...key, ...options.body }
        throw new Error(`Unexpected mock route: ${route}`)
      }
      await navigate('providers')
    })
    await page.waitForSelector('.provider-row')
    const screenshotDir = process.env.AIHUB_SCREENSHOT_DIR
    if (screenshotDir) {
      await fs.mkdir(screenshotDir, { recursive: true })
      await page.setViewportSize({ width: 1280, height: 820 })
      await page.screenshot({ path: path.join(screenshotDir, 'provider-hall-updated.png') })
    }
    const cacheText = await page.textContent('.cache-hit-rate')
    await page.click('[data-action="use-provider-group"]')
    await page.selectOption('#provider-key-switch-form select', '7')
    await page.click('[data-action="switch-provider-key"]')
    await page.waitForSelector('#modal-root .modal', { state: 'detached' })
    await page.evaluate(() => navigate('keys'))
    await page.waitForSelector('[data-action="edit-key"]')
    await page.click('[data-action="edit-key"]')
    await page.waitForSelector('#create-key-form')
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'key-policy-editor.png') })
    const initialMaxRate = await page.inputValue('[name="max_rate_multiplier"]')
    const initialPolicy = await page.evaluate(() => {
      const form = document.querySelector('#create-key-form')
      const values = (name) => [...form.querySelectorAll(`[name="${name}"]`)].map((input) => input.value)
      const selected = (name) => form.querySelector(`[name="${name}"]:checked`)?.value || null
      const checkedValues = (name) => [...new FormData(form).getAll(name)].map(String)
      return {
        rateChangeNotifyEnabled: form.elements.rate_change_notify_enabled?.checked ?? null,
        failoverStrategies: values('failover_strategy'),
        selectedFailoverStrategy: selected('failover_strategy'),
        orderedFailoverGroupIds: checkedValues('failover_group_ids'),
        excludedFailoverGroupIds: checkedValues('failover_excluded_group_ids'),
        recoveryModes: values('failover_recovery_mode'),
        selectedRecoveryMode: selected('failover_recovery_mode'),
      }
    })
    assert.deepEqual(initialPolicy, {
      rateChangeNotifyEnabled: true,
      failoverStrategies: ['manual', 'lowest_rate', 'fastest'],
      selectedFailoverStrategy: 'fastest',
      orderedFailoverGroupIds: ['3', '2'],
      excludedFailoverGroupIds: ['3'],
      recoveryModes: ['sticky', 'prefer_primary', 'manual_only'],
      selectedRecoveryMode: 'prefer_primary',
    }, 'key editor must hydrate the complete site policy contract')

    await page.click('[name="rate_change_notify_enabled"]')
    await page.click('[name="rate_change_notify_enabled"]')
    const strategySequence = []
    for (const strategy of ['manual', 'lowest_rate', 'fastest']) {
      await page.click(`.failover-strategy-segments label:has([value="${strategy}"])`)
      strategySequence.push(await page.inputValue('[name="failover_strategy"]:checked'))
    }
    const orderedCandidates = await page.evaluate(() => new FormData(document.querySelector('#create-key-form')).getAll('failover_group_ids').map(String))
    const recoverySequence = []
    for (const mode of ['sticky', 'manual_only', 'prefer_primary']) {
      await page.click(`[name="failover_recovery_mode"][value="${mode}"]`)
      recoverySequence.push(await page.inputValue('[name="failover_recovery_mode"]:checked'))
    }
    assert.deepEqual(strategySequence, ['manual', 'lowest_rate', 'fastest'])
    assert.deepEqual(orderedCandidates, ['3', '2'])
    assert.deepEqual(recoverySequence, ['sticky', 'manual_only', 'prefer_primary'])
    await page.fill('[name="max_rate_multiplier"]', '0.03')
    await page.click('[data-action="submit-update-key"]')
    await page.waitForSelector('#modal-root .modal', { state: 'detached' })
    const calls = await page.evaluate(() => window.__featureCalls)
    const groupCall = calls.find((call) => call.route === '/keys/7/group' && call.method === 'PUT')
    const updateCall = calls.find((call) => call.route === '/keys/7' && call.method === 'PUT')
    const hasAdminCall = calls.some((call) => call.route.startsWith('/admin'))
    assert.deepEqual(updateCall?.body, {
      name: 'Codex Key',
      group_id: 1,
      quota: 0,
      max_rate_multiplier: 0.03,
      rate_change_notify_enabled: true,
      failover_enabled: true,
      failover_strategy: 'fastest',
      failover_group_ids: [],
      failover_excluded_group_ids: [3],
      failover_recovery_mode: 'prefer_primary',
    }, 'PUT /keys/7 must persist the complete key policy')
    if (cacheText !== '样本不足' || initialMaxRate !== '0.02' || groupCall?.body?.group_id !== 2 || hasAdminCall || errors.length) {
      throw new Error(JSON.stringify({ cacheText, initialMaxRate, groupCall, updateCall, hasAdminCall, errors }))
    }
    console.log(JSON.stringify({ ok: true, cacheHitRate: true, existingKeySwitch: true, maxRate: true, failover: true, noAdminRoutes: true }))
  } finally {
    await app.close()
    await fs.rm(sandbox, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
