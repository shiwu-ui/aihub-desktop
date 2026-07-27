'use strict'

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
  recoveryProbe: '\u6062\u590d\u63a2\u9488',
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
        { id: 2, name: 'Fallback Group', rate_multiplier: 0.07 },
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
        target_multiplier: 0.07,
        strategy: 'lowest_rate',
        recovery_mode: 'prefer_primary',
        reason: 'upstream_503',
        health_class: 'unavailable',
        health_probe: true,
        upstream_status_code: 503,
        created_at: '2026-07-27T01:02:03Z',
      }

      request = async (route) => {
        if (route === '/keys?page=1&page_size=100') return { items: keys, total: 1, pages: 1 }
        if (route === '/groups/available') return groups
        if (route.startsWith('/usage/failovers?')) {
          const [, search = ''] = route.split('?')
          window.__failoverCalls.push({
            route,
            params: Object.fromEntries(new URLSearchParams(search)),
          })
          return { items: [failover], total: 1, pages: 1 }
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
    await page.waitForFunction(() => window.__failoverCalls.length === 2)

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

    const row = page.locator('.data-table tbody tr').filter({ hasText: 'Primary Group' }).first()
    await row.waitFor()
    const rowText = await row.textContent()
    const expectedRowText = [
      'Codex Key',
      'gpt-5.6-sol',
      'Primary Group',
      'Fallback Group',
      '0.02',
      '0.07',
      labels.lowestRate,
      labels.preferPrimary,
      labels.upstream503,
      labels.recoveryProbe,
      '503',
    ]
    const missingRowText = expectedRowText.filter((text) => !rowText.includes(text))
    const overflow = await page.evaluate(() => {
      const content = document.querySelector('#content')
      return {
        body: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        content: content.scrollWidth - content.clientWidth,
      }
    })

    if (missingRowText.length || errors.length || overflow.body > 1 || overflow.content > 1) {
      throw new Error(JSON.stringify({ missingRowText, rowText, errors, overflow }))
    }

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
