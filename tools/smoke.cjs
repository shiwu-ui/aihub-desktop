const { _electron: electron } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const profile = path.join(root, '.smoke-profile')
const artifacts = path.join(root, '.smoke-artifacts')

if (!profile.startsWith(root) || !artifacts.startsWith(root)) throw new Error('Unsafe smoke-test path')
fs.mkdirSync(profile, { recursive: true })
fs.mkdirSync(artifacts, { recursive: true })

async function run() {
  if (!process.env.AIHUB_TEST_EMAIL || !process.env.AIHUB_TEST_PASSWORD) throw new Error('Missing smoke-test credentials')
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', `--user-data-dir=${profile}`],
    cwd: root,
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`))

  await page.waitForSelector('#login-view:not(.hidden)')
  await page.screenshot({ path: path.join(artifacts, 'login.png') })
  await page.fill('#login-email', process.env.AIHUB_TEST_EMAIL)
  await page.fill('#login-password', process.env.AIHUB_TEST_PASSWORD)
  await page.click('#login-form button[type="submit"]')
  await page.waitForSelector('#app-view:not(.hidden)', { timeout: 30000 })
  await page.waitForSelector('.metric-card', { timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('#content .skeleton'), null, { timeout: 30000 })
  await page.waitForSelector('.official-ad', { timeout: 30000 })
  await page.waitForSelector('#usage-trend-chart', { timeout: 30000 })
  await page.waitForTimeout(650)
  const chartPixels = await page.$eval('#usage-trend-chart', (canvas) => {
    const context = canvas.getContext('2d')
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let painted = 0
    for (let index = 3; index < pixels.length; index += 160) {
      if (pixels[index] > 0) painted += 1
    }
    return painted
  })
  await page.screenshot({ path: path.join(artifacts, 'dashboard.png') })

  const routes = ['dashboard', 'keys', 'usage', 'logs', 'providers', 'clients', 'billing', 'affiliate', 'account']
  const expectedTitles = { dashboard: '总览', keys: 'API Key', usage: '用量', logs: '调用日志', providers: '供应商大厅', clients: '客户端配置', billing: '充值', affiliate: '邀请返利', account: '账户' }
  const visited = []
  for (const route of routes) {
    await page.click(`[data-route="${route}"]`)
    await page.waitForFunction((expected) => document.querySelector('#page-title')?.textContent === expected, expectedTitles[route], { timeout: 30000 })
    await page.waitForFunction(() => !document.querySelector('#content .skeleton'), null, { timeout: 30000 })
    const title = await page.textContent('#page-title')
    const body = await page.textContent('#content')
    visited.push({ route, title, hasContent: body.trim().length > 20 })
  }

  await page.click('[data-route="logs"]')
  await page.waitForSelector('#log-filter-form')
  const logRows = await page.locator('tr[data-action="log-detail"]').count()
  const bubbleTrigger = page.locator('[data-bubble]').first()
  if (await bubbleTrigger.count()) {
    await bubbleTrigger.hover()
    await page.waitForSelector('#info-bubble.visible')
  }
  await page.screenshot({ path: path.join(artifacts, 'logs.png') })
  await page.click('[data-route="providers"]')
  await page.waitForSelector('.provider-hall-panel')
  const providerRows = await page.locator('.provider-row').count()
  await page.click('[data-provider-window="24h"]')
  await page.waitForSelector('[data-provider-window="24h"].active')
  await page.screenshot({ path: path.join(artifacts, 'providers-hall.png') })

  await page.evaluate(() => window.aihub.logout())
  await app.close()
  console.log(JSON.stringify({ visited, chartPixels, logRows, providerRows, errors }, null, 2))
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    if (profile.startsWith(root)) fs.rmSync(profile, { recursive: true, force: true })
  })
