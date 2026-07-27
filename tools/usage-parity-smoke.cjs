'use strict'

const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-usage-parity-'))
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${path.join(sandbox, 'electron')}`], cwd: root })
  try {
    const page = await app.firstWindow()
    const errors = []
    const geoRequests = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.setDefaultTimeout(10000)
    await page.setViewportSize({ width: 1280, height: 820 })
    await page.route('https://get.geojs.io/**', async (route) => {
      const url = new URL(route.request().url())
      geoRequests.push(url.href)
      if (url.pathname === '/v1/ip/geo/203.0.113.8.json') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ip: '203.0.113.8', country_code: 'US', region: 'CA', city: 'San Francisco', organization: 'Example Org', timezone: 'America/Los_Angeles' }) })
      }
      if (url.pathname === '/v1/ip/geo.json' && url.searchParams.get('ip') === '198.51.100.9') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ ip: '198.51.100.9', country_code: 'GB', region: 'England', city: 'London' }]) })
      }
      return route.abort()
    })
    await page.waitForSelector('#login-view:not(.hidden)')
    await page.evaluate(async () => {
      document.querySelector('#login-view').classList.add('hidden')
      document.querySelector('#app-view').classList.remove('hidden')
      window.__usageCalls = []
      window.__failUsageModels = false
      window.__failUsageStats = false
      window.__failUsageDetails = false
      state.keys = [{ id: 99, name: 'Filtered Page Key', status: 'active' }]
      state.keyItems = [{ id: 99, name: 'Filtered Page Key', status: 'active' }]
      state.keyReferences = []
      state.clientKeys = []
      state.groups = []
      const detail = {
        id: 42, request_id: 'req-42', model: 'gpt-5.6-sol', upstream_model: 'gpt-upstream', reasoning_effort: 'xhigh',
        api_key_id: 7, api_key: { name: 'Usage Key' }, group_id: 3, group: { name: 'Research' },
        inbound_endpoint: '/v1/responses', upstream_endpoint: 'https://upstream.example/v1/responses',
        request_type: 'responses', billing_type: 'payg', billing_mode: 'actual', stream: true,
        input_tokens: 120, output_tokens: 80, cache_read_tokens: 20, cache_creation_tokens: 10,
        rate_multiplier: 0.06, account_rate_multiplier: 1, original_cost: 0.05, actual_cost: 0.003, account_cost: 0.003,
        first_token_ms: 140, duration_ms: 400, user_agent: 'usage-parity-smoke', client_ip: '203.0.113.8', created_at: '2026-07-28T01:02:03Z',
      }
      const secondDetail = { ...detail, id: 43, request_id: 'req-43', client_ip: '198.51.100.9' }
      request = async (route, options = {}) => {
        window.__usageCalls.push({ route, method: options.method || 'GET', body: options.body })
        if (route === '/keys?page=1&page_size=100') return { items: [{ id: 7, name: 'Usage Key', status: 'active' }], total: 101, pages: 2 }
        if (route === '/keys?page=2&page_size=100') return { items: [{ id: 9, name: 'Second Page Usage Key', status: 'active' }], total: 101, pages: 2 }
        if (route === '/keys?page=1&page_size=50&sort_by=created_at&sort_order=desc') return { items: [{ id: 8, name: 'Client Key', key: 'sk-client-key', status: 'active' }], total: 51, pages: 2 }
        if (route === '/keys?page=2&page_size=50&sort_by=created_at&sort_order=desc') return { items: [{ id: 10, name: 'Second Page Client Key', key: 'sk-second-client-key', status: 'active' }], total: 51, pages: 2 }
        if (route === '/groups/available') return [{ id: 3, name: 'Research' }]
        if (route.startsWith('/usage/stats?')) {
          if (window.__failUsageStats) throw new Error('stats unavailable')
          return { actual_cost: 0.003, standard_cost: 0.05, requests: 1, input_tokens: 120, output_tokens: 80, cache_read_tokens: 20, cache_creation_tokens: 10, endpoints: [{ inbound_endpoint: '/v1/responses', total_tokens: 230, total_actual_cost: 0.003, total_requests: 1 }] }
        }
        if (route.startsWith('/usage/dashboard/snapshot-v2?')) return { trend: [{ date: '2026-07-28', input_tokens: 120, output_tokens: 80, actual_cost: 0.003, cost: 0.05 }], groups: [{ name: 'Research', total_tokens: 230, total_actual_cost: 0.003, total_requests: 1 }] }
        if (route.startsWith('/usage/dashboard/models?')) {
          if (window.__failUsageModels) throw new Error('models unavailable')
          return { models: [{ model: 'gpt-5.6-sol', total_tokens: 230, total_actual_cost: 0.003, total_requests: 1 }] }
        }
        if (route === '/usage/42') return detail
        if (route.startsWith('/usage?')) {
          if (window.__failUsageDetails) throw new Error('details unavailable')
          return { items: [detail, secondDetail, { ...detail, id: 44, request_id: 'req-44' }], total: 33, pages: 2 }
        }
        throw new Error(`Unexpected route: ${route}`)
      }
      await navigate('usage')
    })

    await page.waitForSelector('#usage-analytics-filter')
    assert.equal(await page.locator('#usage-analytics-filter [name="api_key_id"] option[value="7"]').count(), 1)
    assert.equal(await page.locator('#usage-analytics-filter [name="api_key_id"] option[value="9"]').count(), 1)
    assert.equal(await page.locator('#usage-analytics-filter [name="api_key_id"] option[value="99"]').count(), 0)
    assert.equal(await page.locator('#usage-analytics-filter [name="group_id"] option[value="3"]').count(), 1)
    assert.deepEqual(await page.evaluate(async () => (await ensureClientKeys()).map((key) => key.id)), [8, 10])
    assert.ok((await page.evaluate(() => window.__usageCalls.map((call) => call.route))).includes('/keys?page=1&page_size=50&sort_by=created_at&sort_order=desc'))
    await page.evaluate(() => navigate('logs'))
    await page.waitForSelector('#log-filter-form')
    assert.equal(await page.locator('#log-filter-form [name="api_key_id"] option[value="7"]').count(), 1)
    assert.equal(await page.locator('#log-filter-form [name="api_key_id"] option[value="99"]').count(), 0)
    await page.evaluate(() => navigate('usage'))
    await page.waitForSelector('#usage-analytics-filter')
    const text = await page.locator('#content').textContent()
    ;['模型分布', '分组使用分布', '端点分布', 'Token 使用趋势', '标准成本'].forEach((label) => assert.ok(text.includes(label), `missing usage section: ${label}`))
    assert.equal(await page.evaluate(() => safeCsvCell('=1+1')), '"\'=1+1"')
    assert.equal(await page.evaluate(() => safeCsvCell('@cmd')), '"\'@cmd"')

    const form = page.locator('#usage-analytics-filter')
    await form.locator('[name="start_date"]').fill('2026-07-01')
    await form.locator('[name="end_date"]').fill('2026-07-28')
    await form.locator('[name="granularity"]').selectOption('hour')
    await form.locator('[name="api_key_id"]').selectOption('7')
    await form.locator('[name="model"]').fill('gpt 5/sol')
    await form.locator('[name="group_id"]').selectOption('3')
    await form.locator('[name="request_type"]').selectOption('responses')
    await form.locator('[name="billing_type"]').selectOption('payg')
    await form.locator('[name="billing_mode"]').selectOption('actual')
    const snapshotsBefore = await page.evaluate(() => window.__usageCalls.filter((call) => call.route.startsWith('/usage/dashboard/snapshot-v2?')).length)
    await form.locator('button[type="submit"]').click()
    await page.waitForFunction((count) => window.__usageCalls.filter((call) => call.route.startsWith('/usage/dashboard/snapshot-v2?')).length > count, snapshotsBefore)
    const routes = await page.evaluate(() => window.__usageCalls.map((call) => call.route))
    const filtered = routes.filter((route) => route.includes('start_date=2026-07-01')).slice(-4)
    for (const route of filtered) {
      const params = new URLSearchParams(route.split('?')[1])
      assert.equal(params.get('start_date'), '2026-07-01')
      assert.equal(params.get('end_date'), '2026-07-28')
      assert.equal(params.get('api_key_id'), '7')
      assert.equal(params.get('model'), 'gpt 5/sol')
      assert.equal(params.get('group_id'), '3')
      assert.equal(params.get('request_type'), 'responses')
      assert.equal(params.get('billing_type'), 'payg')
      assert.equal(params.get('billing_mode'), 'actual')
    }
    const detailRoute = routes.filter((route) => route.startsWith('/usage?') && route.includes('start_date=2026-07-01')).at(-1)
    const detailParams = new URLSearchParams(detailRoute.split('?')[1])
    assert.equal(detailParams.get('page'), '1')
    assert.equal(detailParams.get('page_size'), '30')
    assert.equal(detailParams.get('sort_by'), 'created_at')
    assert.equal(detailParams.get('sort_order'), 'desc')
    assert.equal(detailParams.has('granularity'), false)
    const snapshotRoute = routes.filter((route) => route.startsWith('/usage/dashboard/snapshot-v2?') && route.includes('start_date=2026-07-01')).at(-1)
    assert.equal(new URLSearchParams(snapshotRoute.split('?')[1]).get('granularity'), 'hour')
    await page.locator('[data-action="usage-next"]').click()
    await page.waitForFunction(() => window.__usageCalls.some((call) => call.route.startsWith('/usage?') && new URLSearchParams(call.route.split('?')[1]).get('page') === '2'))

    await page.locator('[data-action="usage-detail"][data-id="42"]').click()
    const modal = page.locator('.modal')
    await modal.waitFor()
    const detailText = await modal.textContent()
    ;['xhigh', '/v1/responses', 'Research', 'payg', 'actual', '0.06x', '140 ms', '400 ms', '203.0.113.8'].forEach((value) => assert.ok(detailText.includes(value), `missing usage detail: ${value}`))
    await modal.locator('[data-action="usage-region-refresh"]').click()
    await page.waitForFunction(() => document.querySelector('.usage-region-value')?.textContent.includes('US'))
    assert.match(await modal.locator('.usage-region-value').textContent(), /US.*CA.*San Francisco/)
    await modal.locator('[data-action="close-modal"]').last().click()
    await page.locator('[data-action="usage-region-refresh-all"]').click()
    await page.waitForFunction(() => [...document.querySelectorAll('.usage-region-value[data-ip="198.51.100.9"]')].some((node) => node.textContent.includes('GB')))
    assert.equal(geoRequests.filter((url) => new URL(url).pathname === '/v1/ip/geo.json').length, 1)
    const geoCountBeforePrivate = geoRequests.length
    assert.equal(await page.evaluate(async () => { await refreshUsageRegion('127.0.0.1'); return state.usageRegions['127.0.0.1'].status }), 'private')
    assert.equal(geoRequests.length, geoCountBeforePrivate)

    await page.evaluate(() => { window.__failUsageModels = true })
    await form.locator('button[type="submit"]').click()
    await page.waitForSelector('.usage-section-error')
    assert.equal(await page.locator('.usage-metrics .metric-card').count(), 5)
    assert.ok((await page.locator('#content').textContent()).includes('最近调用'))

    await page.evaluate(() => { window.__failUsageModels = false; window.__failUsageStats = true })
    await form.locator('button[type="submit"]').click()
    await page.waitForSelector('.usage-stats-error')
    assert.ok((await page.locator('#content').textContent()).includes('最近调用'))
    assert.ok(await page.locator('[data-action="usage-detail"]').count() > 0)
    assert.doesNotMatch(await page.locator('.usage-detail-panel').textContent(), /标准成本\s*\$0\.00/)

    await page.evaluate(() => { window.__failUsageStats = false; window.__failUsageDetails = true })
    await form.locator('button[type="submit"]').click()
    await page.waitForSelector('.usage-details-error')
    assert.equal(await page.locator('.usage-metrics .metric-card').count(), 5)

    await page.setViewportSize({ width: 980, height: 680 })
    const overflow = await page.evaluate(() => ({ body: document.documentElement.scrollWidth - document.documentElement.clientWidth, content: document.querySelector('#content').scrollWidth - document.querySelector('#content').clientWidth }))
    assert.ok(overflow.body <= 1 && overflow.content <= 1, JSON.stringify({ overflow }))
    assert.equal(errors.length, 0, JSON.stringify({ errors }))
    console.log(JSON.stringify({ ok: true, analytics: true, filters: true, details: true, csvSafe: true, region: true, isolatedFailure: true, overflow }))
  } finally {
    await app.close()
    await fs.rm(sandbox, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
