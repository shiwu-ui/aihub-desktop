'use strict'

const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const labels = {
  rules: '\u7533\u8bf7\u89c4\u5219',
  pending: '\u5f85\u5ba1\u6838',
  companyTitle: '\u793a\u4f8b\u79d1\u6280\u6709\u9650\u516c\u53f8',
}

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-invoice-flow-'))
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', `--user-data-dir=${path.join(sandbox, 'electron')}`],
    cwd: root,
  })

  try {
    const page = await app.firstWindow()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.setDefaultTimeout(10000)
    await page.setViewportSize({ width: 1280, height: 820 })
    await page.waitForSelector('#login-view:not(.hidden)')
    assert.equal(await page.locator('.nav-item[data-route="invoices"]').count(), 1, 'invoice navigation item is missing')
    await page.evaluate(async () => {
      document.querySelector('#login-view').classList.add('hidden')
      document.querySelector('#app-view').classList.remove('hidden')
      window.__invoiceCalls = []
      const eligibleOrders = [{
        id: 301,
        out_trade_no: 'DESKTOP-ORDER-301',
        amount: 300,
        currency: 'CNY',
        status: 'COMPLETED',
        completed_at: '2026-07-27T01:02:03Z',
      }]
      const applications = [{
        id: 901,
        payment_order_id: 300,
        company_title: '\u5df2\u7533\u8bf7\u793a\u4f8b\u516c\u53f8',
        tax_number: '91310000EXISTING01',
        email: 'billing@example.com',
        status: 'pending',
        created_at: '2026-07-26T01:02:03Z',
      }]
      request = async (route, options = {}) => {
        window.__invoiceCalls.push({ route, method: options.method || 'GET', body: options.body })
        if (route === '/invoices/eligible-orders') return eligibleOrders
        if (route === '/invoices/my') return { items: applications, total: applications.length, pages: 1 }
        if (route === '/invoices' && options.method === 'POST') return {
          id: 902,
          status: 'pending',
          ...options.body,
          created_at: '2026-07-27T01:02:03Z',
        }
        throw new Error(`Unexpected mock route: ${route}`)
      }
      await navigate('invoices')
    })

    const form = page.locator('#invoice-application-form')
    await form.waitFor()
    const ruleText = await page.locator('#invoice-rules').textContent()
    const applicationText = await page.locator('#invoice-applications').textContent()
    assert.match(ruleText, /300/)
    assert.match(ruleText, /\u7814\u53d1\u670d\u52a1/)
    assert.match(ruleText, /1\s*-\s*3/)
    assert.match(applicationText, new RegExp(labels.pending))

    await form.locator('[name="payment_order_id"]').selectOption('301')
    await form.locator('[name="company_title"]').fill(labels.companyTitle)
    await form.locator('[name="tax_number"]').fill('91310000TEST000001')
    await form.locator('[name="email"]').fill('ops@example.com\uFF0Cfinance@example.com')
    await form.locator('button[type="submit"]').click()
    await page.waitForFunction(() => window.__invoiceCalls.some((call) => call.route === '/invoices' && call.method === 'POST'))

    const calls = await page.evaluate(() => window.__invoiceCalls)
    const createCall = calls.find((call) => call.route === '/invoices' && call.method === 'POST')
    const hasAdminCall = calls.some((call) => call.route.startsWith('/admin'))
    const overflow = await page.evaluate(() => {
      const content = document.querySelector('#content')
      return {
        body: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        content: content.scrollWidth - content.clientWidth,
      }
    })

    assert.deepEqual(createCall?.body, {
      payment_order_id: 301,
      company_title: labels.companyTitle,
      tax_number: '91310000TEST000001',
      email: 'ops@example.com, finance@example.com',
    })
    assert.equal(hasAdminCall, false, 'invoice flow must not use administrator routes')
    assert.equal(pageErrors.length, 0, JSON.stringify({ pageErrors }))
    assert.ok(overflow.body <= 1 && overflow.content <= 1, JSON.stringify({ overflow }))

    console.log(JSON.stringify({
      ok: true,
      eligibleOrder: true,
      pendingApplication: true,
      normalizedEmail: createCall.body.email,
      noAdminRoutes: true,
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
