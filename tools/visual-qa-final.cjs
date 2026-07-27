'use strict'

const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const outputIndex = process.argv.indexOf('--out')
const output = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : path.join(root, 'artifacts', 'visual-qa-1.1.0'))

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-visual-qa-'))
  await fs.mkdir(output, { recursive: true })
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${path.join(sandbox, 'electron')}`], cwd: root })
  try {
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForSelector('#login-view:not(.hidden)')
    await page.evaluate(() => {
      document.querySelector('#login-view').classList.add('hidden')
      document.querySelector('#app-view').classList.remove('hidden')
      const user = { id: 601, username: 'AIHub Desktop QA User', email: 'qa@example.invalid', avatar_url: '', balance: 42.5, concurrency: 12, status: 'active', balance_notify_enabled: true, balance_notify_threshold: 10, balance_notify_extra_emails: ['notify@example.invalid'] }
      const groups = [{ id: 1, name: 'Primary Group', rate_multiplier: .01, platform: 'openai' }, { id: 2, name: 'Fallback Group', rate_multiplier: .02, platform: 'openai' }]
      const key = { id: 7, name: 'QA Key', key: 'sk-visual-fixture', status: 'active', group_id: 1, group: groups[0], quota: 100, quota_used: 8, max_rate_multiplier: .03, rate_change_notify_enabled: true, failover_enabled: true, failover_strategy: 'manual', failover_group_ids: [2], failover_excluded_group_ids: [], failover_recovery_mode: 'sticky', current_concurrency: 1, today_usage: 1.2, usage_30d: 12, last_used_at: '2026-07-28T00:00:00Z' }
      const usage = { id: 42, request_id: 'req-visual-42', model: 'gpt-5.6-sol', upstream_model: 'gpt-upstream', reasoning_effort: 'xhigh', api_key_id: 7, api_key: { name: 'QA Key' }, group_id: 1, group: { name: 'Primary Group' }, inbound_endpoint: '/v1/responses', request_type: 'responses', billing_type: 'payg', billing_mode: 'actual', input_tokens: 120, output_tokens: 80, cache_read_tokens: 20, cache_creation_tokens: 10, actual_cost: .003, original_cost: .05, first_token_ms: 140, duration_ms: 400, client_ip: '203.0.113.8', created_at: '2026-07-28T01:02:03Z' }
      const failover = { id: 91, api_key_id: 7, api_key_name: 'QA Key', model: 'gpt-5.6-sol', source_group_id: 1, source_group_name: 'Primary Group', target_group_id: 2, target_group_name: 'Fallback Group', source_multiplier: .01, target_multiplier: .02, strategy: 'lowest_rate', recovery_mode: 'prefer_primary', reason: 'upstream_503', health_class: 'unavailable', health_probe: true, upstream_status_code: 503, created_at: '2026-07-28T01:02:03Z' }
      request = async (route, options = {}) => {
        if (route === '/auth/me') return user
        if (route === '/usage/dashboard/stats') return { active_api_keys: 1, total_api_keys: 1, today_requests: 24, total_requests: 2400, today_actual_cost: 1.2, total_actual_cost: 42, today_tokens: 12000, today_input_tokens: 8000, today_output_tokens: 4000, total_tokens: 900000, total_input_tokens: 600000, total_output_tokens: 300000, rpm: 2, tpm: 12000, average_duration_ms: 880, by_platform: [{ platform: 'openai', total_actual_cost: 42, total_requests: 2400, total_tokens: 900000 }] }
        if (route.startsWith('/usage/stats?')) return { actual_cost: .003, standard_cost: .05, requests: 1, input_tokens: 120, output_tokens: 80, cache_read_tokens: 20, cache_creation_tokens: 10, endpoints: [{ inbound_endpoint: '/v1/responses', total_tokens: 230, total_requests: 1, total_actual_cost: .003 }] }
        if (route.startsWith('/usage/dashboard/snapshot-v2')) return { start_date: '2026-07-01', end_date: '2026-07-28', trend: [{ date: '2026-07-28', input_tokens: 120, output_tokens: 80, actual_cost: .003 }], groups: [{ name: 'Primary Group', total_tokens: 230, total_requests: 1, total_actual_cost: .003 }] }
        if (route.startsWith('/usage/dashboard/models?')) return { models: [{ model: 'gpt-5.6-sol', total_tokens: 230, total_requests: 1, total_actual_cost: .003 }] }
        if (route === '/usage/42') return usage
        if (route.startsWith('/usage/failovers?')) return { items: [failover], total: 1, pages: 1 }
        if (route.startsWith('/usage?')) return { items: [usage], total: 1, pages: 1 }
        if (route === '/announcements') return { items: [{ id: 1, title: '视觉 QA 公告', content: 'AIHub Desktop 1.1.0', created_at: '2026-07-28T00:00:00Z' }], total: 1 }
        if (route === '/groups/available') return groups
        if (route === '/keys/7') return key
        if (route.startsWith('/keys?')) return { items: [key], total: 1, pages: 1 }
        if (route.startsWith('/public/monitor/summary')) return { monitoringActive: true, generatedAt: '2026-07-28T00:00:00Z', apis: [{ id: 'qa', group_id: 2, planType: 'Fallback Group', platform: 'openai', available: true, priceMultiplier: .02, firstTokenLatencyMs: 320, outputTokensPerSecond: 70, inputTokens: 800, outputTokens: 200, cacheHitRate: .8, successRates: { '6h': .99, '24h': .98, '7d': .97, '30d': .96 }, checkedAt: '2026-07-28T00:00:00Z' }] }
        if (route === '/public/monitor/series/6h') return { seriesByApiId: { qa: [['2026-07-28T00:00:00Z', 1, 320, 70, 800]] } }
        if (route.startsWith('/invoices/eligible-orders?')) return { items: [{ id: 301, out_trade_no: 'QA-ORDER-301', amount: 300, currency: 'CNY', status: 'COMPLETED', completed_at: '2026-07-28T00:00:00Z', eligible: true, applied: false }], total: 1, pages: 1 }
        if (route.startsWith('/invoices/my?')) return { items: [{ id: 901, payment_order_id: 300, company_title: 'QA Company', tax_number: 'QA-TAX', email: 'invoice@example.invalid', status: 'pending', created_at: '2026-07-28T00:00:00Z' }], total: 1, pages: 1 }
        if (route === '/payment/config') return { payment_enabled: true }
        if (route === '/payment/checkout-info') return { methods: { alipay: { display_name: '支付宝', currency: 'CNY', single_min: 10, single_max: 5000, available: true } }, balance_disabled: false, balance_recharge_multiplier: 1, recharge_fee_rate: 0 }
        if (route.startsWith('/payment/orders/my?')) return { items: [{ id: 88, out_trade_no: 'QA-PAY-88', amount: 20, pay_amount: 20, currency: 'CNY', status: 'PENDING', payment_type: 'alipay', created_at: '2026-07-28T00:00:00Z' }], total: 1, pages: 1 }
        if (route === '/user/profile') return user
        if (route === '/user/aff') return { aff_code: 'QA-CODE', aff_count: 2, aff_quota: 7.5, aff_history_quota: 11.25, aff_frozen_quota: 1.75, effective_rebate_rate_percent: 15, invitees: [{ username: 'Invitee One', email: 'invitee@example.invalid', total_rebate: 3.125, created_at: '2026-07-28T00:00:00Z', direct_rebate: 2.5 }] }
        throw new Error(`Unexpected visual QA route: ${route} ${options.method || 'GET'}`)
      }
    })

    const captures = [
      ['dashboard', 'dashboard', '.single-dashboard-panel'],
      ['keys-list', 'keys', '[data-action="key-apply-filters"]'],
      ['usage', 'usage', '.usage-metrics'],
      ['providers', 'providers', '.provider-row'],
      ['invoices', 'invoices', '#invoice-orders'],
      ['billing-orders', 'billing', '#recharge-form'],
      ['account', 'account', '.account-page'],
      ['affiliate', 'affiliate', '.affiliate-page'],
      ['tutorial', 'guide', '.guide-section'],
    ]
    const results = []
    for (const [name, route, selector] of captures) {
      for (const viewport of [{ width: 1280, height: 820 }, { width: 980, height: 680 }]) {
        await page.setViewportSize(viewport)
        await page.evaluate((target) => navigate(target), route)
        await page.waitForSelector(selector)
        const overflow = await page.evaluate(() => ({ body: document.documentElement.scrollWidth - document.documentElement.clientWidth, content: document.querySelector('#content').scrollWidth - document.querySelector('#content').clientWidth }))
        assert.ok(overflow.body <= 1 && overflow.content <= 1, `${name} ${viewport.width}x${viewport.height}: ${JSON.stringify(overflow)}`)
        const file = `${name}-${viewport.width}x${viewport.height}.png`
        await page.screenshot({ path: path.join(output, file) })
        results.push({ file, overflow })
      }
    }
    for (const viewport of [{ width: 1280, height: 820 }, { width: 980, height: 680 }]) {
      await page.setViewportSize(viewport)
      await page.evaluate(() => navigate('keys'))
      await page.click('[data-action="edit-key"]')
      await page.waitForSelector('#create-key-form')
      const file = `key-editor-${viewport.width}x${viewport.height}.png`
      await page.screenshot({ path: path.join(output, file) })
      results.push({ file, modal: true })
      await page.locator('#modal-root [data-action="close-modal"]').last().click()
    }
    await page.evaluate(() => navigate('logs'))
    await page.getByRole('button', { name: '故障转移', exact: true }).click()
    await page.waitForSelector('.failover-log-table')
    for (const viewport of [{ width: 1280, height: 820 }, { width: 980, height: 680 }]) {
      await page.setViewportSize(viewport)
      const overflow = await page.evaluate(() => ({ body: document.documentElement.scrollWidth - document.documentElement.clientWidth, content: document.querySelector('#content').scrollWidth - document.querySelector('#content').clientWidth }))
      assert.ok(overflow.body <= 1 && overflow.content <= 1)
      const file = `failover-${viewport.width}x${viewport.height}.png`
      await page.screenshot({ path: path.join(output, file) })
      results.push({ file, overflow })
    }
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ ok: true, output, captures: results.length }))
  } finally {
    await app.close()
    await fs.rm(sandbox, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
