'use strict'

const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-client-ui-'))
  const home = path.join(sandbox, 'home')
  const appData = path.join(sandbox, 'roaming')
  const localAppData = path.join(sandbox, 'local')
  await Promise.all([home, appData, localAppData].map((dir) => fs.mkdir(dir, { recursive: true })))
  await fs.mkdir(path.join(home, '.codex'), { recursive: true })
  await fs.writeFile(path.join(home, '.codex', 'config.toml'), 'model_provider = "existing"\n')
  await fs.writeFile(path.join(home, '.codex', 'auth.json'), '{"OPENAI_API_KEY":"sandbox"}\n')
  const packagedExecutable = process.env.AIHUB_TEST_EXECUTABLE
  const app = await electron.launch({
    executablePath: packagedExecutable || require('electron'),
    args: [...(packagedExecutable ? [] : ['.']), `--user-data-dir=${path.join(sandbox, 'electron')}`],
    cwd: root,
    env: { ...process.env, AIHUB_DISABLE_INSTALL_DETECTION: '1', USERPROFILE: home, HOME: home, APPDATA: appData, LOCALAPPDATA: localAppData },
  })
  try {
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForSelector('#login-view:not(.hidden)')
    if (process.env.AIHUB_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.AIHUB_SCREENSHOT_DIR, { recursive: true })
      await page.setViewportSize({ width: 1280, height: 820 })
      await page.screenshot({ path: path.join(process.env.AIHUB_SCREENSHOT_DIR, 'login.png') })
    }
    const result = await page.evaluate(async () => window.aihub.ccSwitch.listClients())
    if (!result.ok || result.data.length !== 3) throw new Error('Client IPC did not return three clients')
    await page.evaluate(async () => {
      document.querySelector('#login-view').classList.add('hidden')
      document.querySelector('#app-view').classList.remove('hidden')
      await navigate('clients')
    })
    await page.waitForSelector('.client-config-page')
    const clientRaceSafety = await page.evaluate(async () => {
      const originalRequest = request
      const cachedClient = { clientState: { installed: false, targets: [] }, profiles: [], backups: [] }
      state.clientCache.codex = cachedClient
      state.clientCache.opencode = cachedClient

      async function runRenderRace(mutate) {
        let releaseKeys
        request = async (route, options) => {
          if (route.startsWith('/keys?')) return new Promise((resolve) => { releaseKeys = () => resolve({ items: [], total: 0, pages: 1 }) })
          return originalRequest(route, options)
        }
        state.route = 'clients'
        state.clientId = 'codex'
        state.clientKeys = []
        state.clientKeysPromise = null
        const pending = renderClients()
        while (!releaseKeys) await Promise.resolve()
        mutate()
        $('#content').innerHTML = '<div id="client-race-sentinel">current page</div>'
        releaseKeys()
        await pending
        return Boolean($('#client-race-sentinel'))
      }

      const routeStayedCurrent = await runRenderRace(() => { state.route = 'billing' })
      const clientStayedCurrent = await runRenderRace(() => { state.clientId = 'opencode' })

      let releaseModalKeys
      request = async (route, options) => {
        if (route.startsWith('/keys?')) return new Promise((resolve) => { releaseModalKeys = () => resolve({ items: [], total: 0, pages: 1 }) })
        return originalRequest(route, options)
      }
      state.route = 'clients'
      state.clientId = 'codex'
      state.clientKeys = []
      state.clientKeysPromise = null
      const newProfileButton = document.createElement('button')
      newProfileButton.dataset.action = 'new-client-profile'
      const modalPending = handleContentClick({ target: newProfileButton })
      while (!releaseModalKeys) await Promise.resolve()
      state.route = 'billing'
      $('#content').innerHTML = '<div id="client-modal-race-sentinel">billing</div>'
      releaseModalKeys()
      await modalPending
      const modalStayedClosed = !$('#modal-root .modal') && Boolean($('#client-modal-race-sentinel'))
      closeModal()
      request = originalRequest
      state.route = 'clients'
      state.clientId = 'codex'
      state.clientKeys = []
      state.clientKeysPromise = null
      return { routeStayedCurrent, clientStayedCurrent, modalStayedClosed }
    })
    if (!clientRaceSafety.routeStayedCurrent || !clientRaceSafety.clientStayedCurrent || !clientRaceSafety.modalStayedClosed) {
      throw new Error(`stale client work painted after navigation: ${JSON.stringify(clientRaceSafety)}`)
    }
    await page.evaluate(() => navigate('clients'))
    await page.waitForSelector('.client-config-page')
    await page.setViewportSize({ width: 980, height: 680 })
    const tabCount = await page.locator('[data-client-tab]').count()
    const title = await page.textContent('#page-title')
    const dragRegions = await page.evaluate(() => ({
      titlebar: getComputedStyle(document.querySelector('.window-drag-region')).webkitAppRegion,
      topbar: getComputedStyle(document.querySelector('.topbar')).webkitAppRegion,
      action: getComputedStyle(document.querySelector('#theme-toggle')).webkitAppRegion,
    }))
    const overflow = await page.evaluate(() => ({ body: document.documentElement.scrollWidth - document.documentElement.clientWidth, content: document.querySelector('#content').scrollWidth - document.querySelector('#content').clientWidth }))
    const installText = await page.textContent('.client-install-status')
    await page.click('[data-client-tab="codex"]')
    await page.waitForFunction(() => document.querySelector('.client-tabs button.active')?.dataset.clientTab === 'codex')
    const importedText = await page.textContent('.profile-list')
    const viewButton = page.locator('[data-action="view-client-profile"]').first()
    await viewButton.click()
    await page.waitForSelector('.profile-content-viewer pre')
    const viewedConfig = await page.locator('.profile-content-viewer pre').first().textContent()
    await page.locator('[data-action="copy-profile-target"]').first().click()
    await page.locator('button[data-action="close-modal"]').last().click()
    await page.waitForSelector('#modal-root .modal', { state: 'detached' })
    await page.click('[data-client-tab="codex-websocket"]')
    await page.waitForFunction(() => document.querySelector('.client-tabs button.active')?.dataset.clientTab === 'codex-websocket')
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
    const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    if (process.env.AIHUB_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.AIHUB_SCREENSHOT_DIR, 'client-page-dark.png') })
    await page.click('#theme-toggle')
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
    const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    if (process.env.AIHUB_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.AIHUB_SCREENSHOT_DIR, 'client-page.png') })
    await page.click('#theme-toggle')
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
    await page.evaluate(() => {
      state.clientId = 'codex'
      state.clientKeys = [{ id: 1, name: 'Sandbox Key', status: 'active', key: 'sk-sandbox-only' }]
      createClientProfileModal()
    })
    const templateLabels = await page.locator('.template-field > span').allTextContents()
    await page.selectOption('#client-template-key', '1')
    await page.fill('#client-template-model', 'gpt-test')
    await page.click('[data-action="fill-aihub-template"]')
    const generated = await page.locator('[data-config-target="config"]').inputValue()
    const generatedAuth = await page.locator('[data-config-target="auth"]').inputValue()
    const codexTemplate = await page.evaluate(() => buildAIHubClientFiles('codex', 'sk-codex-sandbox', 'gpt-test', 'Codex AIHub', 'OpenAI'))
    const websocketTemplate = await page.evaluate(() => buildAIHubClientFiles('codex-websocket', 'sk-ws-sandbox', 'gpt-test', 'Codex WS', 'OpenAI'))
    const openCodeTemplate = await page.evaluate(() => JSON.parse(buildAIHubClientFiles('opencode', 'sk-opencode-sandbox', '', 'OpenCode').config))
    const codexConfigValid = codexTemplate.config.includes('model_provider = "OpenAI"') && codexTemplate.config.includes('[model_providers.OpenAI]') && codexTemplate.config.includes('requires_openai_auth = false') && codexTemplate.config.includes('http_headers') && codexTemplate.config.includes('goals = true') && !codexTemplate.config.includes('sk-codex-sandbox') && JSON.parse(codexTemplate.auth).OPENAI_API_KEY === 'sk-codex-sandbox'
    const websocketConfigValid = websocketTemplate.config.includes('supports_websockets = true') && JSON.parse(websocketTemplate.auth).OPENAI_API_KEY === 'sk-ws-sandbox'
    const openCodeConfigValid = openCodeTemplate.provider.openai.options.apiKey === 'sk-opencode-sandbox' && openCodeTemplate.provider.openai.models['gpt-5.6-sol'].limit.context === 1050000 && openCodeTemplate.provider.openai.models['codex-mini-latest'].variants.high && openCodeTemplate.agent.build.options.store === false
    if (tabCount !== 3 || title !== '客户端配置' || dragRegions.titlebar !== 'drag' || dragRegions.topbar !== 'drag' || dragRegions.action !== 'no-drag' || overflow.body > 1 || overflow.content > 1 || darkBackground !== 'rgb(11, 12, 15)' || lightBackground !== 'rgb(245, 246, 248)' || darkBackground === lightBackground || !installText.includes('未安装') || installText.includes('安装目录') || !importedText.includes('当前配置') || !viewedConfig.includes('model_provider') || !templateLabels.includes('AIHub API Key') || !templateLabels.includes('模型供应商标识') || !templateLabels.includes('默认模型名称') || !generated.includes('https://aihub.top') || generated.includes('sk-sandbox-only') || !generatedAuth.includes('sk-sandbox-only') || !codexConfigValid || !websocketConfigValid || !openCodeConfigValid || errors.length) throw new Error(JSON.stringify({ tabCount, title, dragRegions, overflow, darkBackground, lightBackground, installText, imported: importedText.includes('当前配置'), viewed: !!viewedConfig, templateLabels, generated: !!generated, codexConfigValid, websocketConfigValid, openCodeConfigValid, errors }))
    if (process.env.AIHUB_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.AIHUB_SCREENSHOT_DIR, 'config-modal.png') })
      await page.evaluate(async () => {
        closeModal()
        const trend = Array.from({ length: 18 }, (_, index) => ({ date: `2026-07-${String(index + 1).padStart(2, '0')}`, actual_cost: 1.2 + Math.sin(index / 2) * .55 + index * .08, requests: 40 + index * 4 }))
        request = async (route) => {
          if (route === '/auth/me') return { username: 'adesk', balance: 128.42, frozen_balance: 3.25 }
          if (route === '/usage/dashboard/stats') return { today_actual_cost: 4.86, today_requests: 126, today_tokens: 184200, average_duration_ms: 842, active_api_keys: 3, total_api_keys: 4 }
          if (route.startsWith('/usage/dashboard/snapshot-v2')) return { start_date: '2026-07-01', end_date: '2026-07-18', trend }
          if (route === '/subscriptions/summary') return { active_count: 2, subscriptions: [{ group_name: 'GPT Premium', days_remaining: 28, status: 'active' }, { group_name: 'Codex Priority', days_remaining: 12, status: 'active' }] }
          if (route === '/announcements') return { items: [{ title: 'Responses WebSocket 已上线', content: 'codex WebSocket 分组现已开放。', created_at: '2026-07-18T08:00:00Z' }, { title: '服务维护完成', content: '全部线路已恢复正常。', created_at: '2026-07-17T09:00:00Z' }], total: 2 }
          if (route.startsWith('/public/monitor/summary')) return { monitoringActive: true, generatedAt: '2026-07-19T01:00:00Z', apis: [{ id: 'openai-main', group_id: 1, planType: 'Codex Priority', platform: 'openai', available: true, priceMultiplier: .8, firstTokenLatencyMs: 520, outputTokensPerSecond: 68.4, outputTokens: 1200, inputTokens: 8400, checkedAt: '2026-07-19T00:59:00Z', successRates: { '6h': .998, '24h': .996, '7d': .992, '30d': .989 } }, { id: 'openai-fast', group_id: 2, planType: 'Fast Lane', platform: 'openai', available: true, priceMultiplier: 1.2, firstTokenLatencyMs: 310, outputTokensPerSecond: 92.1, outputTokens: 1800, inputTokens: 9100, checkedAt: '2026-07-19T00:58:00Z', successRates: { '6h': 1, '24h': .999, '7d': .997, '30d': .995 } }] }
          return { items: [], total: 0 }
        }
        await navigate('dashboard')
      })
      await page.setViewportSize({ width: 1280, height: 820 })
      await page.waitForSelector('#usage-trend-chart')
      await page.screenshot({ path: path.join(process.env.AIHUB_SCREENSHOT_DIR, 'dashboard.png') })
      await page.evaluate(() => navigate('providers'))
      await page.waitForSelector('.provider-row')
      await page.screenshot({ path: path.join(process.env.AIHUB_SCREENSHOT_DIR, 'providers.png') })
    }
    console.log(JSON.stringify({ ok: true, tabCount, title, overflow, darkTheme: true, importedExisting: true, installHiddenWhenMissing: true, codexTemplateValid: true, websocketTemplateValid: true, openCodeTemplateValid: true, isolatedHome: true, templateGenerated: true }))
  } finally {
    await app.close()
    await fs.rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
