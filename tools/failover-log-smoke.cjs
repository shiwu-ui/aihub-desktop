'use strict'

const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const labels = {
  failover: '\u6545\u969c\u8f6c\u79fb',
  lowestRate: '\u6700\u4f4e\u500d\u7387\u4f18\u5148',
  preferPrimary: '\u79ef\u6781\u56de\u4e3b',
  upstream503: '\u4e0a\u6e38\u8fd4\u56de 503',
  activeProbe: '\u4e3b\u52a8\u63a2\u6d4b',
  accountUnavailable: '\u5f53\u524d\u5206\u7ec4\u8d26\u53f7\u4e0d\u53ef\u7528',
  accountExhausted: '\u5f53\u524d\u5206\u7ec4\u8d26\u53f7\u5df2\u8017\u5c3d',
  upstream429: '\u4e0a\u6e38\u9650\u6d41\uff08429\uff09',
  primaryCooldown: '\u4e3b\u5206\u7ec4\u5904\u4e8e\u5065\u5eb7\u51b7\u5374',
  primaryCooldownNoCandidate: '\u4e3b\u5206\u7ec4\u51b7\u5374\u4e14\u6ca1\u6709\u53ef\u7528\u5907\u7528\u5206\u7ec4',
}

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-failover-log-'))
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', `--user-data-dir=${path.join(sandbox, 'electron')}`],
    cwd: root,
  })

  try {
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.setDefaultTimeout(10000)
    await page.setViewportSize({ width: 1280, height: 820 })
    await page.waitForSelector('#login-view:not(.hidden)')
    await page.evaluate(async () => {
      document.querySelector('#login-view').classList.add('hidden')
      document.querySelector('#app-view').classList.remove('hidden')
      window.__failoverCalls = []

      const keys = [{ id: 7, name: 'Codex Key', status: 'active', group_id: 1 }]
      const groups = [
        { id: 1, name: 'Primary Group', rate_multiplier: 0.02 },
        { id: 2, name: 'Fallback Group', rate_multiplier: 0.03 },
      ]
      const failover = {
        id: 91,
        api_key_id: 7,
        api_key_name: 'Codex Key',
        model: 'gpt-5.6-sol',
        source_group_id: 1,
        source_group_name: 'Primary Group',
        target_group_id: 2,
        target_group_name: 'Fallback Group',
        source_multiplier: 0.02,
        target_multiplier: 0.03,
        strategy: 'lowest_rate',
        recovery_mode: 'prefer_primary',
        reason: 'upstream_503',
        health_class: 'unavailable',
        health_probe: true,
        upstream_status_code: 503,
        created_at: '2026-07-27T01:02:03Z',
      }
      const unknownFailover = {
        ...failover,
        id: 92,
        api_key_name: 'Unknown Key',
        source_group_name: 'Future Source',
        target_group_name: 'Future Target',
        strategy: 0,
        recovery_mode: 'future_recovery',
        reason: 'future_reason',
        health_class: 0,
        health_probe: false,
        upstream_status_code: 0,
      }
      const reasonFailovers = [
        ['account_unavailable', 93],
        ['account_exhausted', 94],
        ['upstream_429', 95],
        ['primary_health_cooldown', 96],
        ['primary_health_cooldown_no_candidate', 97],
      ].map(([reason, id]) => ({ ...failover, id, api_key_name: `Reason ${id}`, reason }))

      request = async (route) => {
        if (route === '/keys?page=1&page_size=100') return { items: keys, total: 1, pages: 1 }
        if (route === '/groups/available') return groups
        if (route.startsWith('/usage/failovers?')) {
          const [, search = ''] = route.split('?')
          window.__failoverCalls.push({
            route,
            params: Object.fromEntries(new URLSearchParams(search)),
          })
          return { items: [failover, unknownFailover, ...reasonFailovers], total: 7, pages: 1 }
        }
        if (route.startsWith('/usage?')) return { items: [], total: 0, pages: 1 }
        throw new Error(`Unexpected mock route: ${route}`)
      }

      await navigate('logs')
    })

    await page.waitForSelector('#log-filter-form')
    const failoverMode = page.getByRole('button', { name: labels.failover, exact: true })
    await failoverMode.waitFor()
    await failoverMode.click()
    await page.waitForFunction(() => window.__failoverCalls.length === 1)

    const initialFailoverCall = await page.evaluate(() => window.__failoverCalls[0])
    assert.ok(initialFailoverCall.params.start_date, 'failover mode must keep the default start date')
    assert.ok(initialFailoverCall.params.end_date, 'failover mode must keep the default end date')
    assert.equal(
      new Date(`${initialFailoverCall.params.end_date}T00:00:00`).getTime() - new Date(`${initialFailoverCall.params.start_date}T00:00:00`).getTime(),
      24 * 60 * 60 * 1000,
      'failover mode must default to the latest 24-hour date range',
    )

    await page.evaluate(() => {
      window.__nativeDateForFailoverTest = Date
      const NativeDate = Date
      const futureNow = NativeDate.now() + 48 * 60 * 60 * 1000
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [futureNow])) }
        static now() { return futureNow }
      }
    })
    await page.locator('[data-action="reset-log-filters"]').click()
    await page.waitForFunction(() => window.__failoverCalls.length === 2)
    await page.evaluate(() => { window.Date = window.__nativeDateForFailoverTest })
    const refreshedFailoverCall = await page.evaluate(() => window.__failoverCalls[1])
    assert.notEqual(refreshedFailoverCall.params.start_date, initialFailoverCall.params.start_date, 'reset must recalculate the default date range')
    assert.equal(
      new Date(`${refreshedFailoverCall.params.end_date}T00:00:00`).getTime() - new Date(`${refreshedFailoverCall.params.start_date}T00:00:00`).getTime(),
      24 * 60 * 60 * 1000,
      'recalculated log defaults must remain a 24-hour date range',
    )

    const failoverForm = page.locator('#log-filter-form')
    if (await failoverForm.locator('[name="group_id"], [name="stream"]').count()) {
      throw new Error('Failover filters must not include usage-only fields')
    }

    const form = page.locator('#log-filter-form')
    await form.locator('[name="start_date"]').fill('2026-07-01')
    await form.locator('[name="end_date"]').fill('2026-07-27')
    await form.locator('[name="model"]').fill('gpt-5.6-sol')
    await form.locator('[name="api_key_id"]').selectOption('7')
    await form.locator('button[type="submit"]').click()
    await page.waitForFunction(() => window.__failoverCalls.length === 3)

    const lastCall = await page.evaluate(() => window.__failoverCalls.at(-1))
    const expectedParams = {
      page: '1',
      page_size: '20',
      start_date: '2026-07-01',
      end_date: '2026-07-27',
      model: 'gpt-5.6-sol',
      api_key_id: '7',
    }
    const actualKeys = Object.keys(lastCall.params).sort()
    const expectedKeys = Object.keys(expectedParams).sort()
    if (
      !lastCall.route.startsWith('/usage/failovers?')
      || JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)
      || expectedKeys.some((key) => lastCall.params[key] !== expectedParams[key])
    ) {
      throw new Error(JSON.stringify({ expectedParams, lastCall }))
    }

    const headers = await page.locator('.failover-log-table thead th').allTextContents()
    assert.deepEqual(headers, ['API 密钥', '模型', '分组切换', '倍率变化', '切换原因', '时间'])
    const row = page.locator('.failover-log-table tbody tr').filter({ hasText: 'Primary Group' }).first()
    await row.waitFor()
    const rowText = await row.textContent()
    const expectedRowText = [
      'Codex Key',
      'gpt-5.6-sol',
      'Primary Group → Fallback Group',
      '0.02 → 0.03',
      labels.lowestRate,
      labels.preferPrimary,
      labels.upstream503,
      labels.activeProbe,
      '503',
      '健康异常',
    ]
    const missingRowText = expectedRowText.filter((text) => !rowText.includes(text))
    const unknownRowText = await page.locator('.failover-log-table tbody tr').filter({ hasText: 'Unknown Key' }).textContent()
    ;['策略：0', '恢复：future_recovery', 'future_reason', '健康：0', '常规转移', '上游：0'].forEach((value) => assert.ok(unknownRowText.includes(value), `unknown failover value must remain raw: ${value}`))
    const failoverTableText = await page.locator('.failover-log-table').textContent()
    ;[labels.accountUnavailable, labels.accountExhausted, labels.upstream429, labels.primaryCooldown, labels.primaryCooldownNoCandidate]
      .forEach((value) => assert.ok(failoverTableText.includes(value), `missing Chinese failover reason: ${value}`))
    const overflow = await page.evaluate(() => {
      const content = document.querySelector('#content')
      return {
        body: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        content: content.scrollWidth - content.clientWidth,
      }
    })
    const screenshotDir = process.env.AIHUB_SCREENSHOT_DIR
    if (screenshotDir) {
      await fs.mkdir(screenshotDir, { recursive: true })
      await page.screenshot({ path: path.join(screenshotDir, 'failover-audit-log.png'), fullPage: true })
    }

    if (missingRowText.length || errors.length || overflow.body > 1 || overflow.content > 1) {
      throw new Error(JSON.stringify({ missingRowText, rowText, errors, overflow }))
    }
    const requestsBeforeDetail = await page.evaluate(() => window.__failoverCalls.length)
    await row.click()
    const modal = page.locator('.modal')
    await modal.waitFor()
    const detailText = await modal.textContent()
    const expectedDetail = await page.evaluate(() => state.currentLogs.find((item) => item.id === 91))
    Object.entries(expectedDetail).forEach(([field, value]) => {
      assert.ok(detailText.includes(field), `detail must include field: ${field}`)
      assert.ok(detailText.includes(typeof value === 'object' ? JSON.stringify(value) : String(value)), `detail must include raw value for: ${field}`)
    })
    assert.equal(await page.evaluate(() => window.__failoverCalls.length), requestsBeforeDetail)
    await page.locator('.modal-footer button[data-action="close-modal"]').click()

    await page.setViewportSize({ width: 980, height: 680 })
    const compact = await row.evaluate((element) => {
      const cells = [...element.cells].map((cell) => Math.round(cell.getBoundingClientRect().top))
      return { rows: new Set(cells).size, cells: cells.length }
    })
    const compactOverflow = await page.evaluate(() => {
      const content = document.querySelector('#content')
      return { body: document.documentElement.scrollWidth - document.documentElement.clientWidth, content: content.scrollWidth - content.clientWidth }
    })
    assert.deepEqual(compact, { rows: 2, cells: 6 })
    assert.ok(compactOverflow.body <= 1 && compactOverflow.content <= 1, JSON.stringify({ compactOverflow }))

    console.log(JSON.stringify({
      ok: true,
      endpoint: lastCall.route,
      failoverMode: true,
      filters: true,
      row: true,
      overflow,
    }))
  } finally {
    await app.close()
    await fs.rm(sandbox, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
