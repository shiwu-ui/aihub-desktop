'use strict'

const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-usage-cache-'))
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${path.join(sandbox, 'electron')}`], cwd: root })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('#login-view:not(.hidden)')
    await page.evaluate(async () => {
      document.querySelector('#login-view').classList.add('hidden')
      document.querySelector('#app-view').classList.remove('hidden')
      request = async (route) => {
        if (route.startsWith('/usage/stats')) return { actual_cost: 1.2, requests: 4, input_tokens: 100, output_tokens: 60, cache_read_tokens: 300, cache_creation_tokens: 40 }
        if (route.startsWith('/usage?')) return { items: [{ model: 'gpt-test', input_tokens: 100, output_tokens: 60, cache_read_tokens: 300, cache_creation_tokens: 40, actual_cost: .1, duration_ms: 20, stream: false, created_at: '2026-07-19T01:00:00Z' }], total: 1, pages: 1 }
        throw new Error(`Unexpected route: ${route}`)
      }
      await navigate('usage')
    })
    await page.waitForSelector('.usage-metrics')
    const cards = await page.locator('.usage-metrics .metric-card').count()
    const cacheMetric = await page.locator('.usage-metrics .metric-card').nth(4).textContent()
    const cacheCell = await page.locator('.data-table tbody tr td').nth(3).textContent()
    const overflow = await page.evaluate(() => ({ body: document.documentElement.scrollWidth - document.documentElement.clientWidth, content: document.querySelector('#content').scrollWidth - document.querySelector('#content').clientWidth }))
    if (cards !== 5 || !cacheMetric.includes('340') || !cacheMetric.includes('读取 300') || !cacheMetric.includes('写入 40') || !cacheCell.includes('读 300') || !cacheCell.includes('写 40') || overflow.body > 1 || overflow.content > 1) throw new Error(JSON.stringify({ cards, cacheMetric, cacheCell, overflow }))
    console.log(JSON.stringify({ ok: true, cacheMetric: true, cacheDetail: true, overflow }))
  } finally {
    await app.close()
    await fs.rm(sandbox, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
