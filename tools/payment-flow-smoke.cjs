'use strict'

const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-payment-ui-'))
  const packagedExecutable = process.env.AIHUB_TEST_EXECUTABLE
  const app = await electron.launch({
    executablePath: packagedExecutable || require('electron'),
    args: [...(packagedExecutable ? [] : ['.']), `--user-data-dir=${path.join(sandbox, 'electron')}`],
    cwd: root,
  })
  try {
    const page = await app.firstWindow()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.waitForSelector('#login-view:not(.hidden)')
    await page.setViewportSize({ width: 1280, height: 820 })
    await page.evaluate(async () => {
      document.querySelector('#login-view').classList.add('hidden')
      document.querySelector('#app-view').classList.remove('hidden')
      state.user = { id: 1064, username: 'Desktop User', balance: 88.5 }
      window.__paymentCalls = []
      window.__orderStatus = 'PENDING'
      request = async (route, options = {}) => {
        window.__paymentCalls.push({ route, method: options.method || 'GET', body: options.body })
        if (route === '/subscriptions/summary') return { active_count: 0 }
        if (route === '/subscriptions') return []
        if (route === '/redeem/history') return { items: [], total: 0 }
        if (route === '/auth/me') return { id: 1064, username: 'Desktop User', balance: window.__orderStatus === 'COMPLETED' ? 108.5 : 88.5 }
        if (route === '/payment/config') return { payment_enabled: true }
        if (route === '/payment/checkout-info') return {
          methods: {
            alipay_direct: { display_name: '支付宝', currency: 'CNY', single_min: 10, single_max: 5000, fee_rate: 0, available: true },
            wxpay: { display_name: '微信支付', currency: 'CNY', single_min: 10, single_max: 2000, fee_rate: 0, available: true },
          },
          global_min: 10, global_max: 5000, plans: [], balance_disabled: false,
          balance_recharge_multiplier: 1, subscription_usd_to_cny_rate: 0,
          recharge_fee_rate: 2, help_text: '', help_image_url: '', stripe_publishable_key: '',
        }
        if (route.startsWith('/payment/orders/my')) return { items: [{ id: 88, out_trade_no: 'ORDER-88', amount: 12, currency: 'CNY', status: 'PENDING', created_at: '2026-07-28T00:00:00Z' }], total: 40, pages: 2 }
        if (route === '/payment/orders' && options.method === 'POST') return {
          order_id: 77, amount: options.body.amount, pay_amount: 20.4, currency: 'CNY', fee_rate: 2,
          qr_code: 'https://aihub.top/pay/mock-order-77', out_trade_no: 'DESKTOP-MOCK-77',
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        }
        if (route === '/payment/orders/77') return {
          id: 77, amount: 20, pay_amount: 20.4, currency: 'CNY', out_trade_no: 'DESKTOP-MOCK-77', status: window.__orderStatus,
        }
        if (route === '/payment/orders/verify') {
          window.__orderStatus = 'COMPLETED'
          return { id: 77, amount: 20, pay_amount: 20.4, currency: 'CNY', out_trade_no: 'DESKTOP-MOCK-77', status: 'COMPLETED' }
        }
        throw new Error(`Unexpected mock route: ${route}`)
      }
      await navigate('billing')
    })
    await page.waitForSelector('#recharge-form')
    await page.waitForSelector('[name="order-status"]')
    await page.locator('[data-action="orders-next"]').click()
    await page.waitForFunction(() => window.__paymentCalls.some((call) => call.route.includes('/payment/orders/my?page=2&page_size=20')))
    await page.selectOption('[name="order-page-size"]', '50')
    await page.waitForFunction(() => window.__paymentCalls.some((call) => call.route.includes('/payment/orders/my?page=1&page_size=50')))
    await page.selectOption('[name="order-status"]', 'COMPLETED')
    await page.waitForFunction(() => window.__paymentCalls.some((call) => call.route.includes('/payment/orders/my?page=1&page_size=50&status=COMPLETED')))
    const methods = await page.locator('.payment-method').count()
    await page.fill('#recharge-amount', '20')
    await page.click('[data-method="wxpay"]')
    const total = await page.textContent('#recharge-total')
    const screenshotDir = process.env.AIHUB_SCREENSHOT_DIR
    if (screenshotDir) {
      await fs.mkdir(screenshotDir, { recursive: true })
      await page.screenshot({ path: path.join(screenshotDir, 'billing-recharge.png') })
    }
    await page.click('#create-payment-order')
    await page.waitForSelector('.payment-qr img')
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'payment-qrcode.png') })
    const callsBeforeVerify = await page.evaluate(() => window.__paymentCalls)
    await page.click('[data-action="verify-active-payment"]')
    await page.waitForSelector('.payment-result.success')
    const successText = await page.textContent('.payment-result')
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, 'payment-success.png') })
    }
    const hasAdminCall = callsBeforeVerify.some((call) => call.route.startsWith('/admin'))
    const createCall = callsBeforeVerify.find((call) => call.route === '/payment/orders' && call.method === 'POST')
    if (methods !== 2 || !total.includes('20.40') || !createCall || createCall.body.payment_type !== 'wxpay' || createCall.body.return_url !== 'https://aihub.top/payment/result' || hasAdminCall || !successText.includes('充值已到账') || pageErrors.length) {
      throw new Error(JSON.stringify({ methods, total, createCall, hasAdminCall, successText, pageErrors }))
    }
    console.log(JSON.stringify({ ok: true, methods, total, qrRendered: true, completed: true, noAdminRoutes: true }))
  } finally {
    await app.close()
    await fs.rm(sandbox, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
