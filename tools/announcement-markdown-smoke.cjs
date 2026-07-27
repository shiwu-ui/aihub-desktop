'use strict'

const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-announcement-'))
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${path.join(sandbox, 'electron')}`], cwd: root })
  try {
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForSelector('#login-view:not(.hidden)')
    await page.evaluate(async () => {
      document.querySelector('#login-view').classList.add('hidden')
      document.querySelector('#app-view').classList.remove('hidden')
      window.__announcementCalls = []
      request = async (route, options = {}) => {
        window.__announcementCalls.push({ route, method: options.method || 'GET' })
        if (route === '/auth/me') return { username: 'Markdown User', balance: 10 }
        if (route === '/usage/dashboard/stats') return { today_actual_cost: 0, today_requests: 0, today_tokens: 0, average_duration_ms: 0, active_api_keys: 1, total_api_keys: 1 }
        if (route.startsWith('/usage/dashboard/snapshot-v2')) return { trend: [] }
        if (route === '/subscriptions/summary') return { active_count: 0, subscriptions: [] }
        if (route === '/announcements') return { items: [{ id: 19, title: '桌面公告测试', content: '## 更新内容\n\n- 支持 **Markdown**\n- 支持表格\n\n```toml\nmodel = "gpt-test"\n```\n\n| 功能 | 状态 |\n| --- | --- |\n| 公告 | 正常 |\n\n[打开官网](https://aihub.top)\n\n<script>window.__unsafe = true</script><img src=x onerror="window.__unsafe = true">', created_at: '2026-07-19T02:00:00Z', read_at: null }], total: 1 }
        if (route === '/announcements/19/read' && options.method === 'POST') return { message: 'ok' }
        throw new Error(`Unexpected mock route: ${route}`)
      }
      await navigate('dashboard')
    })
    await page.click('[data-action="announcement-detail"]')
    await page.waitForSelector('.announcement-markdown h2')
    const checks = await page.evaluate(() => ({
      heading: document.querySelector('.announcement-markdown h2')?.textContent,
      list: document.querySelectorAll('.announcement-markdown li').length,
      code: document.querySelector('.announcement-markdown pre code')?.textContent,
      table: document.querySelectorAll('.announcement-markdown table').length,
      links: document.querySelectorAll('.announcement-markdown a').length,
      scripts: document.querySelectorAll('.announcement-markdown script').length,
      unsafeAttrs: document.querySelectorAll('.announcement-markdown [onerror], .announcement-markdown [onclick]').length,
      unsafeExecuted: window.__unsafe === true,
      readCalled: window.__announcementCalls.some((call) => call.route === '/announcements/19/read' && call.method === 'POST'),
    }))
    const screenshotDir = process.env.AIHUB_SCREENSHOT_DIR
    if (screenshotDir) {
      await fs.mkdir(screenshotDir, { recursive: true })
      await page.setViewportSize({ width: 1280, height: 820 })
      await page.screenshot({ path: path.join(screenshotDir, 'announcement-markdown.png') })
    }
    if (checks.heading !== '更新内容' || checks.list !== 2 || !checks.code.includes('model = "gpt-test"') || checks.table !== 1 || checks.links !== 1 || checks.scripts !== 0 || checks.unsafeAttrs !== 0 || checks.unsafeExecuted || !checks.readCalled || errors.length) {
      throw new Error(JSON.stringify({ checks, errors }))
    }
    console.log(JSON.stringify({ ok: true, markdown: true, sanitized: true, markedRead: true }))
  } finally {
    await app.close()
    await fs.rm(sandbox, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
