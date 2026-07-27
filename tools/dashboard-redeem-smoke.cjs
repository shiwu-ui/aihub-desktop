'use strict'

const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-dashboard-redeem-'))
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${path.join(sandbox, 'electron')}`], cwd: root })
  try {
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForSelector('#login-view:not(.hidden)')
    await page.setViewportSize({ width: 1280, height: 820 })
    await page.evaluate(async () => {
      document.querySelector('#login-view').classList.add('hidden')
      document.querySelector('#app-view').classList.remove('hidden')
      const user = { username: 'Dashboard User', balance: 26.28, concurrency: 270 }
      request = async (route) => {
        if (route === '/auth/me') return user
        if (route === '/usage/dashboard/stats') return { active_api_keys: 29, total_api_keys: 29, today_requests: 1696, total_requests: 41165, today_actual_cost: 6.6977, total_actual_cost: 93.7206, today_tokens: 272800000, today_input_tokens: 18400000, today_output_tokens: 619900, total_tokens: 1164900000, total_input_tokens: 391700000, total_output_tokens: 7300000, rpm: 1, tpm: 108300, average_duration_ms: 6760, by_platform: [{ platform: 'openai', total_actual_cost: 8, today_actual_cost: 2, total_requests: 20, total_tokens: 2000 }] }
        if (route.startsWith('/usage/dashboard/snapshot-v2')) return { start_date: '2026-07-01', end_date: '2026-07-19', trend: [] }
        if (route.startsWith('/usage/dashboard/models?')) return { models: [{ model: 'gpt-5.6-sol', requests: 12, total_tokens: 1200, actual_cost: 7.5, cost: 7.8 }] }
        if (route.startsWith('/usage?start_date=')) return { items: [{ id: 101, model: 'gpt-5.6-sol', created_at: '2026-07-19T10:00:00Z', actual_cost: 1.2, input_tokens: 120, output_tokens: 30 }], total: 1, pages: 1 }
        if (route === '/announcements') return { items: [], total: 0 }
        if (route === '/redeem/history') return { items: [
          { type: 'balance', value: 10, code: 'PAY-907-TEST', used_at: '2026-07-19T05:13:21Z' },
          { type: 'admin_balance', value: 10, notes: '管理员调整', used_at: '2026-07-17T10:14:56Z' },
          { type: 'admin_concurrency', value: 270, used_at: '2026-07-15T15:09:07Z' },
        ], total: 3 }
        if (route.startsWith('/payment/orders/my')) return { items: [], total: 0 }
        if (route === '/payment/config') return { payment_enabled: false }
        if (route === '/payment/checkout-info') return { methods: {}, balance_disabled: true, balance_recharge_multiplier: 1, recharge_fee_rate: 0 }
        throw new Error(`Unexpected route: ${route}`)
      }
      await navigate('dashboard')
    })
    await page.waitForSelector('.single-dashboard-panel')
    const metricCount = await page.locator('.metrics-grid .metric-card').count()
    const dashboardText = await page.textContent('#content')
    ;['按平台拆分', '模型分布', '最近使用', '快捷操作'].forEach((label) => assert.ok(dashboardText.includes(label), `dashboard missing: ${label}`))
    assert.equal(await page.locator('[data-dashboard-route]').count(), 4)
    const screenshotDir = process.env.AIHUB_SCREENSHOT_DIR
    if (screenshotDir) {
      await fs.mkdir(screenshotDir, { recursive: true })
      await page.screenshot({ path: path.join(screenshotDir, 'dashboard-eight-metrics.png') })
    }
    await page.evaluate(() => navigate('redeem'))
    await page.waitForSelector('.redeem-guide')
    const redeemRows = await page.locator('.redeem-activity-row').count()
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'redeem-page.png') })
    const planRoute = await page.evaluate(async () => {
      const normalized = normalizeRoute('plans')
      await navigate('plans')
      return { normalized, route: state.route }
    })
    await page.waitForSelector('.recharge-panel')
    const navLabels = await page.locator('#sidebar-nav .nav-item span').allTextContents()
    await page.evaluate(() => navigate('changelog'))
    await page.waitForSelector('.release-list')
    const releaseCount = await page.locator('.release-item').count()
    await page.evaluate(() => navigate('about'))
    await page.waitForSelector('.about-hero')
    const aboutText = await page.textContent('#content')
    const overflow = await page.evaluate(() => ({ body: document.documentElement.scrollWidth - document.documentElement.clientWidth, content: document.querySelector('#content').scrollWidth - document.querySelector('#content').clientWidth }))
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'about-page.png') })
    assert.equal(navLabels.includes('套餐'), false)
    assert.equal(planRoute.normalized, 'billing')
    assert.equal(planRoute.route, 'billing')
    if (metricCount !== 8 || dashboardText.includes('订阅状态') || !dashboardText.includes('累计 Token') || redeemRows !== 3 || !navLabels.includes('充值') || !navLabels.includes('兑换码') || !navLabels.includes('更新日志') || !navLabels.includes('关于本软件') || releaseCount !== 8 || !aboutText.includes('1.1.0') || overflow.body > 1 || overflow.content > 1 || errors.length) throw new Error(JSON.stringify({ metricCount, dashboardText, redeemRows, navLabels, planRoute, releaseCount, aboutText, overflow, errors }))
    console.log(JSON.stringify({ ok: true, dashboardMetrics: 8, subscriptionRemoved: true, redeemActivity: redeemRows, planRoute, releaseCount, aboutVersion: '1.1.0', overflow }))
  } finally {
    await app.close()
    await fs.rm(sandbox, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
