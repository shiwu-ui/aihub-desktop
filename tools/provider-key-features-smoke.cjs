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
        { id: 1, name: 'Base', rate_multiplier: 0.01, platform: 'openai' },
        { id: 2, name: 'Stable', rate_multiplier: 0.02, platform: 'openai' },
        { id: 3, name: 'Backup', rate_multiplier: 0.015, platform: 'openai' },
        { id: 4, name: 'Low latency', rate_multiplier: 0.025, platform: 'openai' },
      ]
      const key = {
        id: 7, name: 'Codex Key', key: 'sk-mocked-feature', status: 'active', group_id: 1, group: groups[0],
        quota: 0, quota_used: 0, max_rate_multiplier: 0.02, rate_change_notify_enabled: true,
        failover_enabled: true, failover_strategy: 'fastest', failover_group_ids: [3, 2],
        failover_excluded_group_ids: [3], failover_recovery_mode: 'prefer_primary',
        current_concurrency: 2, today_usage: 4.5, usage_30d: 65.5, expires_at: '2026-12-31T23:59:00Z',
        last_used_at: '2026-07-19T01:00:00Z',
      }
      request = async (route, options = {}) => {
        window.__featureCalls.push({ route, method: options.method || 'GET', body: options.body })
        if (route.startsWith('/public/monitor/summary')) return {
          monitoringActive: true, generatedAt: '2026-07-19T01:00:00Z',
          apis: [{ id: 'stable', group_id: 2, planType: 'Stable', platform: 'openai', available: true, priceMultiplier: 0.02, firstTokenLatencyMs: 420, outputTokensPerSecond: 70, inputTokens: 800, outputTokens: 200, cacheHitRate: 'Insufficient', checkedAt: '2026-07-19T01:00:00Z', successRates: { '6h': 0.99, '24h': 0.98, '7d': 0.97, '30d': 0.96 } }],
        }
        if (route === '/public/monitor/series/6h') return { seriesByApiId: { stable: [['2026-07-19T00:00:00Z', 1, 420, 70, 800]] } }
        if (route === '/groups/available') return groups
        if (route.startsWith('/keys?')) return { items: [key], total: 21, pages: 2 }
        if (route === '/keys/7' && (!options.method || options.method === 'GET')) return key
        if (route === '/keys/7/group' && options.method === 'PUT') return { ...key, group_id: options.body.group_id }
        if (route === '/keys/7' && options.method === 'PUT') return { ...key, ...options.body }
        if (route === '/keys' && options.method === 'POST') return { ...key, id: 8, ...options.body, key: 'sk-created-feature' }
        throw new Error(`Unexpected mock route: ${route}`)
      }
      await navigate('providers')
    })
    await page.waitForSelector('.provider-row')
    assert.deepEqual(await page.locator('[data-provider-sort]').allTextContents(), ['倍率', '最快首字', '可用率'])
    assert.deepEqual(await page.locator('[data-provider-metric]').allTextContents(), ['首字', 'TPS', '输入 Token'])
    assert.deepEqual(await page.evaluate(() => sortedProviders([
      { id: 'missing', priceMultiplier: null, firstTokenLatencyMs: null, successRates: { '6h': null } },
      { id: 'slow', priceMultiplier: 0.02, firstTokenLatencyMs: 800, successRates: { '6h': 0.99 } },
      { id: 'cheap', priceMultiplier: 0.01, firstTokenLatencyMs: 200, successRates: { '6h': 0.8 } },
    ], 'rate').map((item) => item.id)), ['cheap', 'slow', 'missing'])
    const cacheText = await page.textContent('.cache-hit-rate')
    await page.click('[data-action="use-provider-group"]')
    await page.selectOption('#provider-key-switch-form select', '7')
    await page.click('[data-action="switch-provider-key"]')
    await page.waitForSelector('#modal-root .modal', { state: 'detached' })
    await page.evaluate(() => navigate('keys'))
    await page.waitForSelector('[data-action="edit-key"]')
    await page.click('[data-action="edit-key"]')
    await page.waitForSelector('#create-key-form')
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
        advancedFields: ['ip_whitelist', 'ip_blacklist', 'rate_limit_5h', 'rate_limit_1d', 'rate_limit_7d', 'expires_at'].map((name) => Boolean(form.elements[name])),
        updateHidesCustomKey: !form.elements.use_custom_key && !form.elements.custom_key,
        labels: form.textContent,
      }
    })
    assert.deepEqual({ ...initialPolicy, labels: undefined }, {
      rateChangeNotifyEnabled: true,
      failoverStrategies: ['manual', 'lowest_rate', 'fastest'],
      selectedFailoverStrategy: 'fastest',
      orderedFailoverGroupIds: ['3', '2'],
      excludedFailoverGroupIds: ['3'],
      recoveryModes: ['sticky', 'prefer_primary', 'manual_only'],
      selectedRecoveryMode: 'prefer_primary',
      advancedFields: [true, true, true, true, true, true],
      updateHidesCustomKey: true,
      labels: undefined,
    }, 'key editor must hydrate the complete site policy contract')
    for (const label of ['\u6309\u6211\u9009\u62e9\u7684\u5206\u7ec4\u987a\u5e8f', '\u6309\u6700\u4f4e\u500d\u7387\u4f18\u5148', '\u6309\u6700\u5feb\u9996\u5b57\u4f18\u5148', '\u81ea\u7136\u56de\u5207\uff08\u63a8\u8350\uff09', '\u79ef\u6781\u56de\u4e3b', '\u4e0d\u81ea\u52a8\u56de\u5207']) {
      assert.ok(initialPolicy.labels.includes(label), `key editor must expose approved label: ${label}`)
    }
    assert.ok(!initialPolicy.labels.includes('\u6700\u5feb\u54cd\u5e94'))
    assert.ok(!initialPolicy.labels.includes('\u4fdd\u6301\u5f53\u524d'))

    await page.click('[name="rate_change_notify_enabled"]')
    await page.click('[name="rate_change_notify_enabled"]')
    const strategySequence = []
    for (const strategy of ['manual', 'lowest_rate', 'fastest']) {
      await page.click(`.failover-strategy-segments label:has([value="${strategy}"])`)
      strategySequence.push(await page.inputValue('[name="failover_strategy"]:checked'))
    }
    await page.click('[name="failover_strategy"][value="manual"]')
    await page.click('[data-failover-group-id="4"] input')
    await page.click('[data-action="move-failover-group-up"][data-group-id="4"]')
    const orderedCandidates = await page.evaluate(() => Array.from(document.querySelectorAll('[data-failover-group-id]')).filter((row) => row.querySelector('input').checked).map((row) => row.dataset.failoverGroupId))
    const moveBoundaries = await page.evaluate(() => ({
      firstUpDisabled: document.querySelector('[data-failover-group-id="3"] [data-action="move-failover-group-up"]').disabled,
      lastDownDisabled: document.querySelector('[data-failover-group-id="2"] [data-action="move-failover-group-down"]').disabled,
    }))
    const recoverySequence = []
    for (const mode of ['sticky', 'manual_only', 'prefer_primary']) {
      await page.click(`[name="failover_recovery_mode"][value="${mode}"]`)
      recoverySequence.push(await page.inputValue('[name="failover_recovery_mode"]:checked'))
    }
    assert.deepEqual(strategySequence, ['manual', 'lowest_rate', 'fastest'])
    assert.deepEqual(orderedCandidates, ['3', '4', '2'])
    assert.deepEqual(moveBoundaries, { firstUpDisabled: true, lastDownDisabled: true })
    assert.deepEqual(recoverySequence, ['sticky', 'manual_only', 'prefer_primary'])
    await page.fill('[name="max_rate_multiplier"]', '0.03')
    await page.check('[name="enable_ip_restriction"]')
    await page.fill('[name="ip_whitelist"]', '203.0.113.10\n198.51.100.7')
    await page.fill('[name="ip_blacklist"]', '203.0.113.11')
    await page.check('[name="enable_rate_limit"]')
    await page.fill('[name="rate_limit_5h"]', '100')
    await page.fill('[name="rate_limit_1d"]', '300')
    await page.fill('[name="rate_limit_7d"]', '1000')
    await page.fill('[name="expires_at"]', '2026-12-31T23:59')
    await page.click('[data-action="submit-update-key"]')
    await page.waitForSelector('#modal-root .modal', { state: 'detached' })
    const calls = await page.evaluate(() => window.__featureCalls)
    const groupCall = calls.find((call) => call.route === '/keys/7/group' && call.method === 'PUT')
    const updateCall = calls.find((call) => call.route === '/keys/7' && call.method === 'PUT')
    const hasAdminCall = calls.some((call) => call.route.startsWith('/admin'))
    assert.deepEqual(updateCall?.body, {
      name: 'Codex Key', group_id: 1, quota: 0, max_rate_multiplier: 0.03,
      ip_whitelist: ['203.0.113.10', '198.51.100.7'], ip_blacklist: ['203.0.113.11'],
      rate_change_notify_enabled: true, failover_enabled: true, failover_strategy: 'manual',
      failover_group_ids: [3, 4, 2], failover_excluded_group_ids: [], failover_recovery_mode: 'prefer_primary',
      rate_limit_5h: 100, rate_limit_1d: 300, rate_limit_7d: 1000,
      expires_at: new Date('2026-12-31T23:59').toISOString(),
    }, 'PUT /keys/7 must follow the public-site serialization contract')
    assert.ok(!Object.hasOwn(updateCall.body, 'custom_key'))
    assert.ok(!Object.hasOwn(updateCall.body, 'use_custom_key'))

    await page.click('[data-action="edit-key"]')
    await page.waitForSelector('#create-key-form')
    await page.uncheck('[name="enable_ip_restriction"]')
    await page.uncheck('[name="enable_rate_limit"]')
    await page.uncheck('[name="enable_expiration"]')
    await page.evaluate(() => document.querySelector('[name="quota"]').removeAttribute('min'))
    await page.fill('[name="quota"]', '-50')
    await page.click('[data-action="submit-update-key"]')
    await page.waitForSelector('#modal-root .modal', { state: 'detached' })
    const clearedUpdate = (await page.evaluate(() => window.__featureCalls)).filter((call) => call.route === '/keys/7' && call.method === 'PUT').at(-1)
    assert.deepEqual({
      quota: clearedUpdate?.body?.quota,
      ip_whitelist: clearedUpdate?.body?.ip_whitelist,
      ip_blacklist: clearedUpdate?.body?.ip_blacklist,
      rate_limit_5h: clearedUpdate?.body?.rate_limit_5h,
      rate_limit_1d: clearedUpdate?.body?.rate_limit_1d,
      rate_limit_7d: clearedUpdate?.body?.rate_limit_7d,
      expires_at: clearedUpdate?.body?.expires_at,
    }, {
      quota: 0,
      ip_whitelist: [],
      ip_blacklist: [],
      rate_limit_5h: 0,
      rate_limit_1d: 0,
      rate_limit_7d: 0,
      expires_at: '',
    }, 'disabled advanced controls must clear their public-site transport fields')

    await page.click('[data-action="create-key"]')
    await page.waitForSelector('#create-key-form')
    await page.fill('[name="name"]', 'Created Key')
    await page.check('[name="use_custom_key"]')
    await page.fill('[name="custom_key"]', Array.from({ length: 16 }, () => 'a').join(''))
    await page.fill('[name="expires_in_days"]', '30')
    await page.click('[data-action="submit-create-key"]')
    await page.waitForSelector('[data-action="finish-create-key"]')
    const createCall = (await page.evaluate(() => window.__featureCalls)).find((call) => call.route === '/keys' && call.method === 'POST')
    assert.equal(createCall?.body?.expires_in_days, 30)
    assert.equal(createCall?.body?.custom_key?.length, 16)
    await page.click('[data-action="finish-create-key"]')
    await page.waitForSelector('#modal-root .modal', { state: 'detached' })

    await page.evaluate(() => navigate('keys'))
    await page.waitForSelector('[data-action="key-apply-filters"]')
    await page.fill('[name="key-search"]', 'Codex')
    await page.selectOption('[name="key-group-filter"]', '1')
    await page.selectOption('[name="key-status-filter"]', 'active')
    await page.selectOption('[name="key-page-size"]', '20')
    await page.click('[data-action="key-apply-filters"]')
    await page.click('[data-action="keys-next"]')
    await page.waitForFunction(() => window.__featureCalls.some((call) => call.route.includes('/keys?page=2') && call.route.includes('page_size=20') && call.route.includes('search=Codex') && call.route.includes('group_id=1') && call.route.includes('status=active')))
    const listParity = await page.evaluate(() => ({
      columns: ['concurrency', 'todayUsage', 'monthUsage', 'expiresAt'].every((name) => document.querySelector(`[data-key-column="${name}"]`)),
      endpoints: Array.from(document.querySelectorAll('[data-key-endpoint]')).map((link) => link.href),
      configureAction: Boolean(document.querySelector('[data-action="configure-client-key"]')),
    }))
    assert.ok(listParity.columns, 'key list must offer approved optional columns')
    assert.ok(listParity.endpoints.length >= 2 && listParity.endpoints.every((endpoint) => endpoint.startsWith('https://')))
    assert.ok(listParity.configureAction, 'key list must offer selected-key client configuration')
    if (cacheText !== 'Insufficient' || initialMaxRate !== '0.02' || groupCall?.body?.group_id !== 2 || hasAdminCall || errors.length) {
      throw new Error(JSON.stringify({ cacheText, initialMaxRate, groupCall, updateCall, hasAdminCall, errors }))
    }
    console.log(JSON.stringify({ ok: true, cacheHitRate: true, existingKeySwitch: true, advancedPolicy: true, orderedFailover: true, keyListParity: true, noAdminRoutes: true }))
  } finally {
    await app.close()
    await fs.rm(sandbox, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
