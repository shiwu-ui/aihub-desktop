'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')

const root = path.resolve(__dirname, '..')

async function run() {
  const mainSource = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8')
  const rendererSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8')

  assert.match(mainSource, /new Tray\(path\.join\(__dirname, '\.\.', 'assets', 'icon\.ico'\)\)/)
  assert.match(mainSource, /buttons: \['取消', '最小化到托盘', '退出软件'\]/)
  assert.match(mainSource, /mainWindow\.hide\(\)/)
  assert.match(mainSource, /tray\.on\('click', showMainWindow\)/)

  assert.match(rendererSource, /request\('\/keys', \{ method: 'POST', body \}\)/)
  assert.match(rendererSource, /request\(`\/keys\/\$\{state\.editingKeyId\}`, \{ method: 'PUT', body \}\)/)
  assert.match(rendererSource, /failover_enabled: enabled/)
  assert.match(rendererSource, /failover_strategy: strategy/)
  assert.match(rendererSource, /failover_group_ids:/)
  assert.doesNotMatch(rendererSource, /retry-proxy|renderRetryProxy|proxyRequest/)

  const sandbox = await fsp.mkdtemp(path.join(os.tmpdir(), 'aihub-guide-tray-'))
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${path.join(sandbox, 'electron')}`], cwd: root })
  try {
    const page = await app.firstWindow()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.waitForSelector('#login-view:not(.hidden)')
    await page.evaluate(() => {
      document.querySelector('#login-view').classList.add('hidden')
      document.querySelector('#app-view').classList.remove('hidden')
      return navigate('guide')
    })
    await page.waitForSelector('.guide-section')
    assert.equal(await page.locator('.guide-section').count(), 8)
    const guide = await page.textContent('#content')
    for (const chapter of [
      'Node.js 环境安装',
      'API 密钥高级功能',
      'CCS 一键导入',
      'Claude Code 配置教程',
      'Codex 配置教程',
      'Gemini CLI 配置教程',
      'AIHubRouter 自动路由工具',
      '社区工具推荐',
    ]) {
      assert.match(guide, new RegExp(chapter))
    }
    assert.match(guide, /当前 1\.0\.6 桌面端/)
    assert.match(guide, /由 AIHub 服务端执行切换/)
    assert.doesNotMatch(guide, /本地代理|号池同步/)
    const guideOverflow = await page.evaluate(() => ({ body: document.body.scrollWidth - document.body.clientWidth, content: document.querySelector('#content').scrollWidth - document.querySelector('#content').clientWidth }))
    assert.deepEqual(guideOverflow, { body: 0, content: 0 })
    await page.setViewportSize({ width: 980, height: 680 })
    const compactGuideOverflow = await page.evaluate(() => ({ body: document.body.scrollWidth - document.body.clientWidth, content: document.querySelector('#content').scrollWidth - document.querySelector('#content').clientWidth }))
    assert.deepEqual(compactGuideOverflow, { body: 0, content: 0 })
    const screenshotDir = process.env.AIHUB_SCREENSHOT_DIR
    if (screenshotDir) {
      await fsp.mkdir(screenshotDir, { recursive: true })
      await page.setViewportSize({ width: 1280, height: 820 })
      await page.screenshot({ path: path.join(screenshotDir, 'guide-1.0.6.png'), fullPage: true })
    }

    await page.evaluate(() => navigate('about'))
    await page.waitForSelector('.attribution-list')
    const about = await page.textContent('.attribution-list')
    assert.match(about, /CC Switch/)
    assert.match(about, /AIHub 官方接口/)
    assert.doesNotMatch(about, /llm-retry-proxy/)
    const aboutOverflow = await page.evaluate(() => ({ body: document.body.scrollWidth - document.body.clientWidth, content: document.querySelector('#content').scrollWidth - document.querySelector('#content').clientWidth }))
    assert.deepEqual(aboutOverflow, { body: 0, content: 0 })
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'about-acknowledgements-1.0.6.png'), fullPage: true })
    assert.deepEqual(pageErrors, [])
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {})
    await fsp.rm(sandbox, { recursive: true, force: true }).catch(() => {})
  }

  console.log(JSON.stringify({ ok: true, guide: '1.0.6', tray: true, failover: 'aihub-api', acknowledgements: true }))
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
