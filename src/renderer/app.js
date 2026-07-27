const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

const THEME_STORAGE_KEY = 'aihub-theme-v2'
const APP_VERSION = '1.1.0'
const savedTheme = localStorage.getItem(THEME_STORAGE_KEY)
document.documentElement.classList.toggle('dark', savedTheme ? savedTheme === 'dark' : true)

const state = {
  route: 'dashboard',
  user: null,
  settings: null,
  keys: [],
  groups: [],
  usagePeriod: 'month',
  dashboardChart: null,
  logs: { page: 1, pageSize: 20, mode: 'usage', filters: {} },
  providerWindow: '6h',
  providerCharts: [],
  announcements: [],
  preferredGroupId: null,
  clientId: 'codex',
  clientDefinitions: [],
  clientProfiles: [],
  clientBackups: [],
  clientCache: Object.create(null),
  clientLoads: Object.create(null),
  clientKeysPromise: null,
  payment: {
    checkout: null,
    selectedMethod: '',
    activeOrder: null,
    pollTimer: null,
    billingTimer: null,
    verifyAttempts: 0,
    lastVerifyAt: 0,
  },
}

const PAYMENT_METHOD_ORDER = ['alipay', 'wxpay', 'stripe', 'airwallex']
const PAYMENT_METHOD_ALIASES = { alipay: 'alipay', alipay_direct: 'alipay', wxpay: 'wxpay', wxpay_direct: 'wxpay', stripe: 'stripe', airwallex: 'airwallex' }
const PAYMENT_STATUS = {
  PENDING: '等待支付', PAID: '已支付', RECHARGING: '入账中', COMPLETED: '已完成',
  EXPIRED: '已过期', CANCELLED: '已取消', FAILED: '失败', REFUND_REQUESTED: '退款申请中',
  REFUNDING: '退款中', REFUND_PENDING: '退款处理中', PARTIALLY_REFUNDED: '部分退款',
  REFUNDED: '已退款', REFUND_FAILED: '退款失败',
}

const routeMeta = {
  dashboard: ['OVERVIEW', '总览'],
  keys: ['CREDENTIALS', 'API Key'],
  usage: ['ANALYTICS', '用量'],
  logs: ['REQUEST LOGS', '调用日志'],
  providers: ['PROVIDER HALL', '供应商大厅'],
  clients: ['CLIENT CONFIG', '客户端配置'],
  guide: ['USER GUIDE', '使用教程'],
  billing: ['RECHARGE', '充值'],
  invoices: ['INVOICES', '自助发票'],
  redeem: ['REDEEM', '兑换码'],
  affiliate: ['AFFILIATE', '邀请返利'],
  account: ['ACCOUNT', '账户'],
  changelog: ['CHANGELOG', '更新日志'],
  about: ['ABOUT', '关于本软件'],
}

function icons(root = document) {
  if (window.lucide) window.lucide.createIcons({ root })
}

function syncThemeControl() {
  const button = $('#theme-toggle')
  if (!button) return
  const dark = document.documentElement.classList.contains('dark')
  window.aihub.setTitlebarTheme?.(dark)
  button.innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}"></i>`
  button.title = dark ? '切换到浅色主题' : '切换到深色主题'
  button.setAttribute('aria-label', button.title)
  icons(button)
}

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function number(value, digits = 0) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(Number(value || 0))
}

function compactNumber(value, digits = 1) {
  const numeric = Number(value || 0)
  if (Math.abs(numeric) < 1000) return number(numeric, digits)
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: digits }).format(numeric)
}

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(value || 0))
}

function gatewayMoney(value, currency = 'CNY') {
  const normalized = String(currency || 'CNY').trim().toUpperCase()
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: normalized, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))
  } catch {
    return `${normalized} ${number(value, 2)}`
  }
}

function paymentMethodLabel(type, fallback = '') {
  return ({ alipay: '支付宝', wxpay: '微信支付', stripe: 'Stripe', airwallex: 'Airwallex' })[type] || fallback || type
}

function paymentMethodIcon(type) {
  return ({ alipay: 'scan-line', wxpay: 'message-circle-more', stripe: 'credit-card', airwallex: 'globe-2' })[type] || 'wallet-cards'
}

function visiblePaymentMethods(methods = {}) {
  const visible = {}
  Object.entries(methods || {}).forEach(([rawType, limit]) => {
    const type = PAYMENT_METHOD_ALIASES[String(rawType).trim()] || String(rawType).trim()
    if (!type) return
    if (!visible[type] || rawType === type) visible[type] = { ...limit, type }
  })
  return PAYMENT_METHOD_ORDER.filter((type) => visible[type]).map((type) => visible[type])
}

function paymentStatusLabel(status) {
  const normalized = String(status || '').toUpperCase()
  return PAYMENT_STATUS[normalized] || normalized || '-'
}

function paymentStatusClass(status) {
  const normalized = String(status || '').toLowerCase()
  if (['paid', 'recharging'].includes(normalized)) return 'pending'
  if (['cancelled', 'expired'].includes(normalized)) return normalized
  if (['failed', 'refund_failed'].includes(normalized)) return 'failed'
  return normalized
}

function normalizeInvoiceEmails(value) {
  const emails = String(value || '').split(/[\s,，;；]+/).map((email) => email.trim()).filter(Boolean)
  if (!emails.length || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return ''
  const normalized = emails.join(', ')
  return new TextEncoder().encode(normalized).length <= 255 ? normalized : ''
}

function cleanupPaymentPolling(clearBilling = false) {
  if (state.payment.pollTimer) clearInterval(state.payment.pollTimer)
  state.payment.pollTimer = null
  if (clearBilling && state.payment.billingTimer) clearInterval(state.payment.billingTimer)
  if (clearBilling) state.payment.billingTimer = null
}

function dateTime(value) {
  if (!value) return '从未'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

function shortDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
}

function paginated(data) {
  if (Array.isArray(data)) return { items: data, total: data.length, pages: 1 }
  return { items: data?.items || data?.data || [], total: data?.total || 0, pages: data?.pages || 1 }
}

async function request(route, options = {}) {
  const result = await window.aihub.request(route, options)
  if (!result.ok) {
    if (result.error?.status === 401) showLogin()
    const error = new Error(result.error?.message || '请求失败')
    error.status = result.error?.status
    error.code = result.error?.code
    throw error
  }
  return result.data
}

async function ccRequest(method, ...args) {
  const result = await window.aihub.ccSwitch[method](...args)
  if (!result?.ok) throw new Error(result?.error?.message || result?.error || '客户端配置操作失败')
  return result.data
}

function toast(message, type = 'success') {
  const node = document.createElement('div')
  node.className = `toast ${type}`
  node.innerHTML = `<i data-lucide="${type === 'error' ? 'circle-alert' : 'circle-check'}"></i><span>${escapeHTML(message)}</span>`
  $('#toast-root').append(node)
  icons(node)
  setTimeout(() => node.remove(), 3400)
}

function setBusy(button, busy, label = '处理中') {
  if (!button) return
  if (busy) {
    button.dataset.original = button.innerHTML
    button.disabled = true
    button.textContent = label
  } else {
    button.disabled = false
    if (button.dataset.original) button.innerHTML = button.dataset.original
    icons(button)
  }
}

function loadingPage() {
  $('#content').innerHTML = `
    <div class="page-stack">
      <div class="metrics-grid">${Array.from({ length: 4 }, () => '<div class="metric-card"><div class="skeleton" style="width:40%"></div><div class="skeleton" style="width:65%;height:28px"></div><div class="skeleton" style="width:52%"></div></div>').join('')}</div>
      <div class="panel"><div class="panel-header"><div class="skeleton" style="width:140px"></div></div><div class="panel-body"><div class="skeleton" style="height:240px"></div></div></div>
    </div>`
}

function metric(label, value, foot, icon, tone = '') {
  return `<article class="metric-card"><div class="metric-top"><span>${escapeHTML(label)}</span><span class="metric-icon ${tone}"><i data-lucide="${icon}"></i></span></div><div><div class="metric-value">${escapeHTML(value)}</div><div class="metric-foot">${escapeHTML(foot)}</div></div></article>`
}

function empty(icon, title, description, action = '') {
  return `<div class="empty-state"><i data-lucide="${icon}"></i><strong>${escapeHTML(title)}</strong><p>${escapeHTML(description)}</p>${action}</div>`
}

function markdownPreview(value, maxLength = 96) {
  const text = String(value || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-+*]|\d+[.)])\s+/gm, '')
    .replace(/[*_~`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function renderMarkdown(value) {
  const content = String(value || '')
  if (!content) return '<p>暂无内容</p>'
  if (!window.marked || !window.DOMPurify) return `<p>${escapeHTML(content)}</p>`
  window.marked.setOptions({ breaks: true, gfm: true })
  const html = window.marked.parse(content)
  return window.DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['style'],
  })
}

function showLogin() {
  $('#boot').classList.add('hidden')
  $('#app-view').classList.add('hidden')
  $('#login-view').classList.remove('hidden')
  setTimeout(() => $('#login-email').focus(), 50)
  icons()
}

async function loadRememberedAccount() {
  const remembered = await window.aihub.rememberedAccount()
  if (remembered?.email) {
    $('#login-email').value = remembered.email
    $('#remember-account').checked = true
  }
  return remembered
}

function showApp(user) {
  state.user = user
  $('#boot').classList.add('hidden')
  $('#login-view').classList.add('hidden')
  $('#app-view').classList.remove('hidden')
  const name = user?.username || user?.email || '账户'
  $('#account-name').textContent = name
  $('#account-avatar').textContent = name.slice(0, 1).toUpperCase()
  navigate('dashboard')
}

function normalizeRoute(route) {
  return route === 'plans' ? 'billing' : route
}

async function navigate(route) {
  route = normalizeRoute(route)
  if (state.route === 'billing' && route !== 'billing') cleanupPaymentPolling(true)
  if (state.dashboardChart) {
    state.dashboardChart.destroy()
    state.dashboardChart = null
  }
  state.providerCharts.forEach((chart) => chart.destroy())
  state.providerCharts = []
  state.route = route
  $$('.nav-item[data-route]').forEach((button) => button.classList.toggle('active', button.dataset.route === route))
  $('#page-eyebrow').textContent = routeMeta[route][0]
  $('#page-title').textContent = routeMeta[route][1]
  loadingPage()
  try {
    await ({ dashboard: renderDashboard, keys: renderKeys, usage: renderUsage, logs: renderLogs, providers: renderProviders, clients: renderClients, guide: renderGuide, billing: renderBilling, invoices: renderInvoices, redeem: renderRedeem, affiliate: renderAffiliate, account: renderAccount, changelog: renderChangelog, about: renderAbout }[route])()
  } catch (error) {
    $('#content').innerHTML = `<div class="page-stack">${empty('cloud-off', '暂时无法载入', error.message, '<button class="secondary-button" data-action="retry"><i data-lucide="refresh-cw"></i>重试</button>')}</div>`
    icons($('#content'))
  }
  $('#content').focus({ preventScroll: true })
}

function renderDashboardChart(points) {
  const canvas = $('#usage-trend-chart')
  if (!canvas || !window.Chart || !points.length) return
  const theme = getComputedStyle(document.documentElement)
  const accent = theme.getPropertyValue('--accent-cyan').trim() || '#12b8c4'
  const muted = theme.getPropertyValue('--muted').trim() || '#607080'
  const grid = theme.getPropertyValue('--line-soft').trim() || 'rgba(91, 109, 126, .13)'
  const tooltip = document.documentElement.classList.contains('dark') ? '#0b1117' : '#14202b'
  window.Chart.defaults.font.family = 'Inter, "SF Pro Text", "Segoe UI Variable", "Segoe UI", sans-serif'
  window.Chart.defaults.color = muted
  const values = points.map((item) => Number(item.actual_cost ?? item.cost ?? 0))
  state.dashboardChart = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels: points.map((item) => shortDate(item.date || item.time)),
      datasets: [{
        data: values,
        borderColor: accent,
        backgroundColor: document.documentElement.classList.contains('dark') ? 'rgba(67, 209, 212, .10)' : 'rgba(18, 184, 196, .12)',
        borderWidth: 2.2,
        fill: true,
        tension: 0.38,
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        pointHitRadius: 14,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: '#ffffff',
        pointHoverBorderColor: accent,
        pointHoverBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 420, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 8, right: 4, bottom: 0, left: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          backgroundColor: tooltip,
          titleColor: '#b5b5ba',
          bodyColor: '#ffffff',
          padding: 10,
          cornerRadius: 6,
          titleFont: { size: 10, weight: 'normal' },
          bodyFont: { size: 12, weight: 'bold' },
          callbacks: { label: (context) => `消费 ${money(context.parsed.y)}` },
        },
      },
      scales: {
        x: {
          border: { display: false },
          grid: { display: false },
          ticks: { color: muted, font: { size: 9 }, maxTicksLimit: 6, maxRotation: 0 },
        },
        y: {
          position: 'right',
          beginAtZero: true,
          border: { display: false },
          grid: { color: grid, drawTicks: false },
          ticks: {
            color: muted,
            font: { size: 9 },
            padding: 8,
            maxTicksLimit: 5,
            callback: (value) => `$${number(value, Number(value) < 1 ? 2 : 1)}`,
          },
        },
      },
    },
  })
}

async function renderDashboard() {
  const [user, stats, snapshot, announcements] = await Promise.all([
    request('/auth/me'),
    request('/usage/dashboard/stats'),
    request('/usage/dashboard/snapshot-v2?include_trend=true'),
    request('/announcements'),
  ])
  state.user = user
  const name = user?.username || user?.email || '账户'
  $('#account-name').textContent = name
  $('#account-avatar').textContent = name.slice(0, 1).toUpperCase()
  const noticeItems = paginated(announcements).items
  state.announcements = noticeItems
  const trend = snapshot?.trend || []
  const chartPoints = trend.slice(-30)
  const periodCost = chartPoints.reduce((sum, item) => sum + Number(item.actual_cost ?? item.cost ?? 0), 0)
  const periodRequests = chartPoints.reduce((sum, item) => sum + Number(item.requests ?? item.total_requests ?? 0), 0)
  const chartBody = chartPoints.length
    ? `<div class="chart-summary"><div class="chart-summary-item"><span>周期消费</span><strong>${money(periodCost)}</strong></div><div class="chart-summary-item secondary"><span>请求总数</span><strong>${number(periodRequests)} 次</strong></div></div><div class="chart-canvas-wrap"><canvas id="usage-trend-chart" aria-label="消费趋势折线图"></canvas></div>`
    : '<div class="empty-state" style="width:100%;min-height:244px;border:0"><i data-lucide="chart-no-axes-column"></i><strong>暂无趋势数据</strong><p>产生调用后，这里会展示消费变化。</p></div>'
  const notices = noticeItems.length
    ? noticeItems.slice(0, 5).map((item) => `<button class="announcement-row" data-action="announcement-detail" data-id="${escapeHTML(item.id)}"><span class="announcement-copy"><span class="announcement-title">${item.read_at ? '' : '<i class="announcement-unread" aria-label="未读"></i>'}<strong>${escapeHTML(item.title)}</strong></span><span>${escapeHTML(markdownPreview(item.content))}</span></span><time>${escapeHTML(shortDate(item.created_at))}</time><i data-lucide="chevron-right"></i></button>`).join('')
    : empty('bell-off', '暂无公告', '站点公告会显示在这里。')

  $('#content').innerHTML = `<div class="page-stack">
    <div class="metrics-grid">
      ${metric('余额', money(user.balance), user.frozen_balance ? `冻结 ${money(user.frozen_balance)}` : '当前可用额度', 'wallet', 'green')}
      ${metric('API 密钥', number(stats.active_api_keys), `${number(stats.total_api_keys)} 个启用`, 'key-round', 'blue')}
      ${metric('今日请求', compactNumber(stats.today_requests), `累计 ${compactNumber(stats.total_requests)}`, 'chart-no-axes-combined', 'green')}
      ${metric('今日消费', money(stats.today_actual_cost), `累计 ${money(stats.total_actual_cost)}`, 'circle-dollar-sign', 'purple')}
      ${metric('今日 Token', compactNumber(stats.today_tokens), `输入 ${compactNumber(stats.today_input_tokens)} / 输出 ${compactNumber(stats.today_output_tokens)}`, 'binary', 'amber')}
      ${metric('累计 Token', compactNumber(stats.total_tokens), `输入 ${compactNumber(stats.total_input_tokens)} / 输出 ${compactNumber(stats.total_output_tokens)}`, 'database', 'blue')}
      ${metric('性能指标', `${compactNumber(stats.rpm)} RPM`, `${compactNumber(stats.tpm)} TPM`, 'zap', 'purple')}
      ${metric('平均响应', `${(Number(stats.average_duration_ms || 0) / 1000).toFixed(2)}s`, '平均响应时间', 'clock-3', 'red')}
    </div>
    <section class="official-ad" aria-label="AIHub 官网推广">
      <img src="../../assets/icon.png" alt="AIHub" />
      <div class="official-ad-copy">
        <p class="eyebrow">AIHUB.TOP</p>
        <h2>让常用 AI 模型，共用一个 API 入口。</h2>
        <p>访问 AIHub 官网，查看服务公告、模型支持与最新活动。</p>
      </div>
      <div class="official-ad-actions">
        <button class="ad-link" data-action="open-aihub-ad">访问官网<i data-lucide="arrow-up-right"></i></button>
        <button class="icon-button ad-close" data-action="dismiss-aihub-ad" title="关闭推广" aria-label="关闭推广"><i data-lucide="x"></i></button>
      </div>
    </section>
    <div class="dashboard-grid single-dashboard-panel"><section class="panel"><div class="panel-header"><div><h2>消费趋势</h2><p>${escapeHTML(snapshot?.start_date || '')} 至 ${escapeHTML(snapshot?.end_date || '')}</p></div><button class="icon-button" data-route-jump="usage" title="查看用量"><i data-lucide="arrow-up-right"></i></button></div><div class="panel-body">${chartBody}</div></section></div>
    <section class="panel"><div class="panel-header"><div><h2>站点公告</h2><p>来自 AIHub 的最新消息</p></div></div><div class="panel-body announcement-list">${notices}</div></section>
  </div>`
  icons($('#content'))
  renderDashboardChart(chartPoints)
}

async function renderKeys() {
  const [keysData, groupsData] = await Promise.all([
    request('/keys?page=1&page_size=50&sort_by=created_at&sort_order=desc'),
    request('/groups/available'),
  ])
  const keys = paginated(keysData)
  state.keys = keys.items
  state.groups = Array.isArray(groupsData) ? groupsData : groupsData?.groups || groupsData?.items || []
  const rows = keys.items.map((key) => {
    const quotaPercent = key.quota > 0 ? Math.min(100, (Number(key.quota_used || 0) / Number(key.quota)) * 100) : 0
    return `<tr>
      <td style="width:28%"><div class="cell-title"><strong>${escapeHTML(key.name || '未命名 Key')}</strong><span>${escapeHTML(key.key ? `${key.key.slice(0, 8)}••••${key.key.slice(-4)}` : `ID ${key.id}`)}</span></div></td>
      <td style="width:13%"><span class="status-badge ${escapeHTML(key.status)}">${escapeHTML(key.status)}</span></td>
      <td style="width:17%"><div class="cell-title"><strong>${escapeHTML(key.group?.name || '默认分组')}</strong><span>${number(key.group?.rate_multiplier ?? key.group?.user_rate ?? 1, 2)}x</span></div></td>
      <td style="width:18%"><div class="cell-title"><strong>${key.quota > 0 ? `${money(key.quota_used)} / ${money(key.quota)}` : '不限额'}</strong>${key.quota > 0 ? `<span class="progress-track"><span class="progress-fill" style="width:${quotaPercent}%"></span></span>` : '<span>按余额扣费</span>'}</div></td>
      <td style="width:16%"><div class="cell-title"><strong>${Number(key.max_rate_multiplier || 0) > 0 ? `最高 ${number(key.max_rate_multiplier, 2)}x` : '倍率不限'}</strong><span>${key.failover_enabled ? (key.failover_strategy === 'lowest_rate' ? '最低倍率故障转移' : `自选 ${number(key.failover_group_ids?.length)} 个备用组`) : '未启用故障转移'}</span></div></td>
      <td style="width:11%">${escapeHTML(dateTime(key.last_used_at))}</td>
      <td style="width:10%"><div class="row-actions">
        ${key.key ? `<button class="icon-button" data-action="copy-key" data-id="${key.id}" title="复制 Key"><i data-lucide="copy"></i></button>` : ''}
        <button class="icon-button" data-action="edit-key" data-id="${key.id}" title="编辑策略"><i data-lucide="settings-2"></i></button>
        <button class="icon-button" data-action="toggle-key" data-id="${key.id}" title="${key.status === 'active' ? '停用' : '启用'}"><i data-lucide="${key.status === 'active' ? 'pause' : 'play'}"></i></button>
        <button class="icon-button" data-action="delete-key" data-id="${key.id}" title="删除"><i data-lucide="trash-2"></i></button>
      </div></td>
    </tr>`
  }).join('')
  $('#content').innerHTML = `<div class="page-stack">
    <div class="page-toolbar"><div class="toolbar-copy"><h2>你的访问凭据</h2><p>用于模型调用，不是账户管理密钥。</p></div><button class="primary-button" data-action="create-key"><i data-lucide="plus"></i>新建 Key</button></div>
    <section class="panel">${rows ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>名称</th><th>状态</th><th>分组</th><th>额度</th><th>调用策略</th><th>最后使用</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('key-round', '还没有 API Key', '创建一个 Key 后即可连接 Claude、OpenAI 或 Gemini 客户端。', '<button class="primary-button" data-action="create-key"><i data-lucide="plus"></i>新建 Key</button>')}</section>
  </div>`
  icons($('#content'))
}

async function renderUsage() {
  const period = state.usagePeriod
  const [stats, logs] = await Promise.all([
    request(`/usage/stats?period=${encodeURIComponent(period)}`),
    request('/usage?page=1&page_size=30&sort_by=created_at&sort_order=desc'),
  ])
  const items = paginated(logs).items
  const cacheReadTokens = Number(stats.cache_read_tokens ?? stats.total_cache_read_tokens ?? 0)
  const cacheCreationTokens = Number(stats.cache_creation_tokens ?? stats.total_cache_creation_tokens ?? 0)
  const rows = items.map((item) => `<tr>
    <td style="width:18%"><div class="cell-title"><strong>${escapeHTML(item.model || '未知模型')}</strong><span>${escapeHTML(item.request_id || '')}</span></div></td>
    <td style="width:13%">${escapeHTML(item.api_key?.name || `Key #${item.api_key_id}`)}</td>
    <td style="width:12%"><div class="cell-title"><strong>${number(Number(item.input_tokens || 0) + Number(item.output_tokens || 0))}</strong><span>入 ${number(item.input_tokens)} · 出 ${number(item.output_tokens)}</span></div></td>
    <td style="width:14%"><div class="cell-title"><strong>${number(Number(item.cache_read_tokens || 0) + Number(item.cache_creation_tokens || 0))}</strong><span>读 ${number(item.cache_read_tokens)} · 写 ${number(item.cache_creation_tokens)}</span></div></td>
    <td style="width:11%">${money(item.actual_cost)}</td>
    <td style="width:11%">${item.duration_ms == null ? '-' : `${number(item.duration_ms)} ms`}</td>
    <td style="width:9%">${item.stream ? '流式' : '非流式'}</td>
    <td style="width:12%">${escapeHTML(dateTime(item.created_at))}</td>
  </tr>`).join('')
  $('#content').innerHTML = `<div class="page-stack">
    <div class="page-toolbar"><div class="toolbar-copy"><h2>调用与消费</h2><p>仅显示你自己的调用记录。</p></div><div class="segmented" data-period>${[['today','今日'],['week','本周'],['month','本月']].map(([value, label]) => `<button data-period-value="${value}" class="${period === value ? 'active' : ''}">${label}</button>`).join('')}</div></div>
    <div class="metrics-grid usage-metrics">
      ${metric('实际消费', money(stats.actual_cost ?? stats.total_actual_cost), '所选周期', 'circle-dollar-sign')}
      ${metric('请求数', number(stats.requests ?? stats.total_requests), '全部模型', 'send', 'green')}
      ${metric('输入 Token', number(stats.input_tokens ?? stats.total_input_tokens), '提示与上下文', 'arrow-down-to-line', 'amber')}
      ${metric('输出 Token', number(stats.output_tokens ?? stats.total_output_tokens), '模型生成', 'arrow-up-from-line', 'dark')}
      ${metric('缓存 Token', number(cacheReadTokens + cacheCreationTokens), `读取 ${number(cacheReadTokens)} · 写入 ${number(cacheCreationTokens)}`, 'database-zap', 'green')}
    </div>
    <section class="panel"><div class="panel-header"><div><h2>最近调用</h2><p>${number(paginated(logs).total)} 条记录</p></div></div>${rows ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>模型</th><th>API Key</th><th>输入 / 输出</th><th>缓存读 / 写</th><th>消费</th><th>耗时</th><th>模式</th><th>时间</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('activity', '暂无调用记录', '使用 API Key 发起请求后会显示在这里。')}</section>
  </div>`
  icons($('#content'))
}

function queryString(params) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== '' && value !== null && value !== undefined) query.set(key, value)
  }
  return query.toString()
}

function failoverLabel(value, labels) {
  return labels[String(value)] || String(value || '-')
}

function failoverProbeLabel(value) {
  if (value === true) return '主动探测'
  if (value === false) return '常规转移'
  return String(value || '-')
}

function failoverRows(items) {
  const strategyLabels = { manual: '自选分组', lowest_rate: '最低倍率优先', fastest: '最快响应优先' }
  const recoveryLabels = { sticky: '保持当前', prefer_primary: '积极回主', manual_only: '仅手动切换' }
  const reasonLabels = { upstream_503: '上游返回 503', timeout: '请求超时', unavailable: '分组不可用' }
  return items.map((item) => `<tr>
    <td><div class="cell-title"><strong>${escapeHTML(item.api_key_name || item.api_key?.name || `Key #${item.api_key_id}`)}</strong><span>${escapeHTML(dateTime(item.created_at))}</span></div></td>
    <td>${escapeHTML(item.model || '-')}</td>
    <td>${escapeHTML(item.source_group_name || item.source_group?.name || item.source_group_id || '-')}</td>
    <td>${escapeHTML(item.target_group_name || item.target_group?.name || item.target_group_id || '-')}</td>
    <td>${number(item.source_multiplier, 2)}</td>
    <td>${number(item.target_multiplier, 2)}</td>
    <td>${escapeHTML(failoverLabel(item.strategy, strategyLabels))}</td>
    <td>${escapeHTML(failoverLabel(item.recovery_mode, recoveryLabels))}</td>
    <td>${escapeHTML(failoverLabel(item.reason, reasonLabels))}</td>
    <td>${escapeHTML(failoverProbeLabel(item.health_probe))}</td>
    <td>${escapeHTML(item.upstream_status_code ?? '-')}</td>
  </tr>`).join('')
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function usageCSV(items) {
  const columns = [
    ['时间', (item) => item.created_at],
    ['请求 ID', (item) => item.request_id],
    ['模型', (item) => item.model],
    ['API Key', (item) => item.api_key?.name || item.api_key_id],
    ['分组', (item) => item.group?.name || item.group_id],
    ['输入 Token', (item) => item.input_tokens],
    ['输出 Token', (item) => item.output_tokens],
    ['缓存读取 Token', (item) => item.cache_read_tokens],
    ['实际消费', (item) => item.actual_cost],
    ['耗时 ms', (item) => item.duration_ms],
    ['流式', (item) => item.stream ? '是' : '否'],
    ['请求类型', (item) => item.request_type],
  ]
  return [columns.map(([label]) => csvCell(label)).join(','), ...items.map((item) => columns.map(([, get]) => csvCell(get(item))).join(','))].join('\r\n')
}

async function loadLogsForExport(filters) {
  const items = []
  let page = 1
  let pages = 1
  do {
    const result = paginated(await request(`/usage?${queryString({ page, page_size: 100, sort_by: 'created_at', sort_order: 'desc', ...filters })}`))
    items.push(...result.items)
    pages = Math.min(Number(result.pages || 1), 50)
    page += 1
  } while (page <= pages && items.length < 5000)
  return items.slice(0, 5000)
}

async function renderLogs() {
  const logState = state.logs
  const isFailover = logState.mode === 'failover'
  if (!state.keys.length) {
    const keyData = await request('/keys?page=1&page_size=100')
    state.keys = paginated(keyData).items
  }
  if (!state.groups.length) {
    const groups = await request('/groups/available')
    state.groups = Array.isArray(groups) ? groups : groups?.items || groups?.groups || []
  }
  const params = {
    page: logState.page,
    page_size: logState.pageSize,
    ...logState.filters,
  }
  const logs = paginated(await request(isFailover
    ? `/usage/failovers?${queryString(params)}`
    : `/usage?${queryString({ ...params, sort_by: 'created_at', sort_order: 'desc' })}`))
  state.currentLogs = logs.items
  const keyOptions = state.keys.map((key) => `<option value="${key.id}" ${String(logState.filters.api_key_id || '') === String(key.id) ? 'selected' : ''}>${escapeHTML(key.name)}</option>`).join('')
  const groupOptions = state.groups.map((group) => `<option value="${group.id}" ${String(logState.filters.group_id || '') === String(group.id) ? 'selected' : ''}>${escapeHTML(group.name)}</option>`).join('')
  const rows = logs.items.map((item) => {
    const totalTokens = Number(item.input_tokens || 0) + Number(item.output_tokens || 0)
    return `<tr data-action="log-detail" data-id="${item.id}" style="cursor:pointer">
      <td style="width:17%"><div class="cell-title"><strong>${escapeHTML(dateTime(item.created_at))}</strong><span>${escapeHTML(item.request_id || `#${item.id}`)}</span></div></td>
      <td style="width:18%"><span class="log-model">${item.stream ? '<span class="stream-mark"></span>' : ''}<strong>${escapeHTML(item.model || '-')}</strong></span></td>
      <td style="width:14%">${escapeHTML(item.api_key?.name || `Key #${item.api_key_id}`)}</td>
      <td style="width:12%">${escapeHTML(item.group?.name || item.group_id || '-')}</td>
      <td style="width:12%"><span class="bubble-trigger" data-bubble="输入 ${number(item.input_tokens)} · 输出 ${number(item.output_tokens)} · 缓存读取 ${number(item.cache_read_tokens)}">${number(totalTokens)}<i data-lucide="circle-help"></i></span></td>
      <td style="width:11%">${money(item.actual_cost)}</td>
      <td style="width:10%"><span class="bubble-trigger" data-bubble="首 Token ${item.first_token_ms == null ? '-' : `${number(item.first_token_ms)} ms`}">${item.duration_ms == null ? '-' : `${number(item.duration_ms)} ms`}<i data-lucide="circle-help"></i></span></td>
      <td style="width:6%"><i data-lucide="chevron-right" style="width:15px"></i></td>
    </tr>`
  }).join('')
  const table = isFailover
    ? (logs.items.length ? `<div class="data-table-wrap failover-log-table"><table class="data-table"><thead><tr><th>API Key / 时间</th><th>模型</th><th>主分组</th><th>备用分组</th><th>主倍率</th><th>备倍率</th><th>策略</th><th>恢复</th><th>原因</th><th>探测</th><th>状态</th></tr></thead><tbody>${failoverRows(logs.items)}</tbody></table></div>` : empty('git-branch', '暂无故障转移记录', '发生分组故障转移后，会在这里保留审计记录。'))
    : (rows ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>时间 / 请求 ID</th><th>模型</th><th>API Key</th><th>分组</th><th>Token</th><th>消费</th><th>耗时</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('list-x', '没有匹配的调用', '调整筛选条件或产生新的 API 请求后再查看。'))
  $('#content').innerHTML = `<div class="page-stack">
    <div class="page-toolbar"><div class="toolbar-copy"><h2>个人调用记录</h2><p>仅包含你的请求，不含管理员审计与上游账号信息。</p></div><div class="button-row"><button class="secondary-button" data-action="reset-log-filters"><i data-lucide="rotate-ccw"></i>重置</button>${isFailover ? '' : '<button class="primary-button" data-action="export-logs"><i data-lucide="download"></i>导出 CSV</button>'}</div></div>
    <section class="panel"><form id="log-filter-form" class="filter-panel">
      <div class="log-mode-tabs segmented"><button type="button" data-log-mode="usage" class="${isFailover ? '' : 'active'}">调用日志</button><button type="button" data-log-mode="failover" class="${isFailover ? 'active' : ''}">故障转移</button></div>
      <label><span>开始日期</span><input name="start_date" type="date" value="${escapeHTML(logState.filters.start_date || '')}" /></label>
      <label><span>结束日期</span><input name="end_date" type="date" value="${escapeHTML(logState.filters.end_date || '')}" /></label>
      <label><span>API Key</span><select name="api_key_id"><option value="">全部</option>${keyOptions}</select></label>
      ${isFailover ? '' : `<label><span>分组</span><select name="group_id"><option value="">全部</option>${groupOptions}</select></label>`}
      <label><span>模型</span><input name="model" value="${escapeHTML(logState.filters.model || '')}" placeholder="例如 claude" /></label>
      ${isFailover ? '' : `<label><span>请求模式</span><select name="stream"><option value="">全部</option><option value="true" ${logState.filters.stream === 'true' ? 'selected' : ''}>流式</option><option value="false" ${logState.filters.stream === 'false' ? 'selected' : ''}>非流式</option></select></label>`}
      <div class="button-row" style="grid-column:1/-1;justify-content:flex-end"><button type="submit" class="secondary-button"><i data-lucide="list-filter"></i>应用筛选</button></div>
    </form></section>
    <section class="panel">${table}
      <div class="pagination-bar"><span>共 ${number(logs.total)} 条 · 每页 ${number(logState.pageSize)} 条</span><div class="pagination-controls"><button class="icon-button toolbar-button" data-action="logs-prev" ${logState.page <= 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i></button><strong>${number(logState.page)} / ${number(logs.pages || 1)}</strong><button class="icon-button toolbar-button" data-action="logs-next" ${logState.page >= (logs.pages || 1) ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button></div></div>
    </section>
  </div>`
  icons($('#content'))
}

function providerStateLabel(item) {
  if (item.enabled === false) return ['disabled', '已停用']
  if (item.available === false) return ['failed', '不可用']
  if (item.warningReasons?.length) return ['pending', '警告']
  return ['operational', '可用']
}

function providerSparkline(item) {
  const rates = ['6h', '24h', '7d', '30d'].map((key) => Number(item.successRates?.[key] ?? 0) * 100)
  return `<div class="provider-sparkline" data-rates="${escapeHTML(JSON.stringify(rates))}" data-bubble="6h ${number(rates[0], 1)}% · 24h ${number(rates[1], 1)}% · 7d ${number(rates[2], 1)}% · 30d ${number(rates[3], 1)}%"><canvas width="150" height="34" aria-label="${escapeHTML(item.planType)} 可用率趋势"></canvas></div>`
}

function providerCacheHitLabel(value) {
  if (value === null || value === undefined || value === '') return '样本不足'
  if (typeof value === 'number') {
    const percent = value >= 0 && value <= 1 ? value * 100 : value
    return `${number(percent, 1)}%`
  }
  return String(value)
}

function providerCacheHitInsufficient(value) {
  return value === null || value === undefined || value === '' || String(value).includes('样本不足')
}

function renderProviderSparklines() {
  state.providerCharts.forEach((chart) => chart.destroy())
  state.providerCharts = []
  $$('.provider-sparkline').forEach((container) => {
    const canvas = $('canvas', container)
    const rates = JSON.parse(container.dataset.rates || '[]')
    if (!canvas || !window.Chart) return
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-cyan').trim() || '#12b8c4'
    state.providerCharts.push(new window.Chart(canvas, {
      type: 'line',
      data: { labels: ['6h', '24h', '7d', '30d'], datasets: [{ data: rates, borderColor: accent, borderWidth: 1.8, pointRadius: 0, pointHoverRadius: 3, tension: .34, fill: false }] },
      options: { responsive: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false, min: 0, max: 100 } }, elements: { line: { capBezierPoints: true } } },
    }))
  })
}

async function renderProviders() {
  const summary = await request(`/public/monitor/summary?timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai')}`)
  const items = (summary?.apis || []).slice().sort((a, b) => String(a.planType || '').localeCompare(String(b.planType || ''), 'en', { numeric: true }))
  const period = state.providerWindow
  const columns = items.map((item) => {
    const [statusClass, statusLabel] = providerStateLabel(item)
    const rate = Number(item.successRates?.[period] ?? 0) * 100
    const firstToken = item.firstTokenLatencyMs
    const tps = item.outputTokensPerSecond
    return `<div class="provider-row">
      <div class="provider-name"><span class="provider-symbol">${escapeHTML(String(item.platform || '?').slice(0, 2))}</span><div><strong>${escapeHTML(item.planType || '未知分组')}</strong><span>${escapeHTML(item.platform || '')} · ${escapeHTML(item.id || '')}</span></div></div>
      <span class="price-multiplier">${number(item.priceMultiplier, 2)}</span>
      <span class="status-badge ${statusClass}">${statusLabel}<span class="bubble-trigger" data-bubble="${escapeHTML((item.warningReasons || []).map((reason) => reason.message || reason).join('；') || (item.errorMessage || '最近一次探测成功'))}"><i data-lucide="circle-help"></i></span></span>
      <div class="cell-title"><strong>${firstToken == null ? '-' : `${number(firstToken)} ms`}</strong><span>${tps == null ? 'TPS -' : `TPS ${number(tps, 2)}/s`}</span><span>↑ ${number(item.outputTokens || 0)} · ↓ ${number(item.inputTokens || 0)}</span></div>
      <span class="cache-hit-rate ${providerCacheHitInsufficient(item.cacheHitRate) ? 'insufficient' : ''}">${escapeHTML(providerCacheHitLabel(item.cacheHitRate))}</span>
      <span class="availability-number">${number(rate, 1)}%</span>
      ${providerSparkline(item)}
      <span class="last-checked">${escapeHTML(dateTime(item.checkedAt))}</span>
      <button class="secondary-button use-group-button" data-action="use-provider-group" data-group-id="${escapeHTML(item.group_id)}" data-group-name="${escapeHTML(item.planType || `分组 ${item.group_id}`)}" data-group-rate="${escapeHTML(item.priceMultiplier)}" ${Number(item.group_id) > 0 ? '' : 'disabled'}>使用此分组</button>
    </div>`
  }).join('')
  const overall = summary?.monitoringActive === false ? ['pending', '监控暂停'] : items.some((item) => item.available === false) ? ['failed', '有服务不可用'] : items.some((item) => item.warningReasons?.length) ? ['pending', '存在告警'] : ['operational', '监测中']
  $('#content').innerHTML = `<div class="page-stack"><section class="panel provider-hall-panel"><div class="provider-hall-toolbar"><div><div class="provider-title-line"><h2>供应商大厅</h2><span class="status-badge ${overall[0]}">${overall[1]}</span></div><p>首 Token 可能因技术限制与中转站后台不一致；缓存样本不足 1000 条时不展示命中率。</p></div><div class="provider-toolbar-actions"><div class="segmented">${[['6h', '6h'], ['24h', '24h'], ['7d', '7d'], ['30d', '30d']].map(([value, label]) => `<button data-provider-window="${value}" class="${period === value ? 'active' : ''}">${label}</button>`).join('')}</div><span class="last-generated">${escapeHTML(dateTime(summary?.generatedAt))}</span><button class="secondary-button" data-action="refresh-providers"><i data-lucide="refresh-cw"></i>刷新</button></div></div><div class="provider-table-head"><span>分组</span><span>倍率</span><span>最新状态</span><span>最新首 Token</span><span>缓存命中率</span><span>可用率 ↓</span><span>曲线</span><span>最近监测</span><span>使用此分组</span></div>${columns ? `<div class="provider-list">${columns}</div>` : empty('store', '暂无供应商数据', '站点暂时没有发布可用的供应商分组。')}</section></div>`
  icons($('#content'))
  renderProviderSparklines()
}

function clientTargetRows(clientState) {
  const targets = Array.isArray(clientState?.targets)
    ? clientState.targets
    : Object.entries(clientState?.files || {}).map(([id, file]) => ({ id, ...file, format: file.summary?.format }))
  if (!targets.length) return '<p class="client-empty-copy">尚未检测到配置文件，首次应用配置时会自动创建。</p>'
  return targets.map((target) => `<div class="client-target-row">
    <span class="target-format">${escapeHTML(String(target.format || target.id || 'CFG').toUpperCase())}</span>
    <div><strong>${escapeHTML(target.label || target.id || '配置文件')}</strong><p>${escapeHTML(target.path || '')}</p></div>
    <span class="status-badge ${target.exists ? 'active' : 'inactive'}">${target.exists ? '已检测' : '未创建'}</span>
  </div>`).join('')
}

async function ensureClientKeys() {
  if (state.keys.length) return state.keys
  if (!state.clientKeysPromise) {
    state.clientKeysPromise = request('/keys?page=1&page_size=50&sort_by=created_at&sort_order=desc')
      .then((data) => {
        state.keys = paginated(data).items
        return state.keys
      })
      .catch(() => [])
      .finally(() => { state.clientKeysPromise = null })
  }
  return state.clientKeysPromise
}

function loadClientData(clientId) {
  if (state.clientLoads[clientId]) return state.clientLoads[clientId]
  const pending = Promise.all([
    ccRequest('getClientState', clientId),
    ccRequest('listProfiles', clientId),
    ccRequest('listBackups', clientId),
  ]).then(([clientState, profiles, backups]) => {
    const data = {
      clientState,
      profiles: Array.isArray(profiles) ? profiles : [],
      backups: Array.isArray(backups) ? backups : [],
      loadedAt: Date.now(),
    }
    state.clientCache[clientId] = data
    return data
  }).finally(() => { delete state.clientLoads[clientId] })
  state.clientLoads[clientId] = pending
  return pending
}

function clientTabsMarkup() {
  return state.clientDefinitions.map((client) => `<button data-client-tab="${escapeHTML(client.id)}" class="${client.id === state.clientId ? 'active' : ''}"><i data-lucide="${escapeHTML(client.icon || 'square-terminal')}"></i><span>${escapeHTML(client.name || client.label || client.id)}</span></button>`).join('')
}

function renderClientLoading(selected) {
  const selectedName = selected.name || selected.label || selected.id
  $('#content').innerHTML = `<div class="page-stack client-config-page">
    <div class="page-toolbar"><div class="toolbar-copy"><h2>CC Switch</h2><p>统一管理本机 AI 编程客户端，切换前自动备份，失败时自动回滚。</p></div><button class="primary-button" data-action="new-client-profile"><i data-lucide="plus"></i>新建配置档</button></div>
    <div class="client-tabs">${clientTabsMarkup()}</div>
    <div class="client-layout client-loading-grid"><section class="panel"><div class="panel-header"><h2>${escapeHTML(selectedName)}</h2></div><div class="panel-body"><div class="skeleton" style="height:40px"></div><div class="skeleton" style="height:90px;margin-top:12px"></div></div></section><section class="panel"><div class="panel-header"><div class="skeleton" style="width:110px"></div></div><div class="panel-body"><div class="skeleton" style="height:132px"></div></div></section></div>
  </div>`
  icons($('#content'))
}

function paintClients(selected, data) {
  const { clientState, profiles, backups } = data
  state.clientProfiles = profiles
  state.clientBackups = backups
  const selectedName = selected.name || selected.label || selected.id
  const profileRows = profiles.map((profile) => `<div class="profile-row">
    <div class="client-app-icon"><i data-lucide="server-cog"></i></div>
    <div class="profile-copy"><strong>${escapeHTML(profile.name)}</strong><p>${profile.source === 'detected' || profile.source === 'imported' ? '自动同步本机现有配置' : escapeHTML((profile.targets || []).join(' · ') || '配置档')}</p></div>
    ${clientState?.currentProfileId === profile.id ? '<span class="status-badge active">使用中</span>' : ''}
    <button class="icon-button" data-action="view-client-profile" data-id="${escapeHTML(profile.id)}" title="查看配置内容" aria-label="查看配置内容"><i data-lucide="eye"></i></button>
    <button class="secondary-button" data-action="activate-client-profile" data-id="${escapeHTML(profile.id)}"><i data-lucide="refresh-cw"></i>应用</button>
    <button class="icon-button" data-action="delete-client-profile" data-id="${escapeHTML(profile.id)}" title="删除配置档" aria-label="删除配置档"><i data-lucide="trash-2"></i></button>
  </div>`).join('')
  const backupRows = backups.slice(0, 8).map((backup) => `<div class="backup-row"><div><strong>${escapeHTML(dateTime(backup.createdAt))}</strong><p>${escapeHTML((backup.targets || backup.writtenTargets || []).join(' · ') || '切换前备份')}</p></div><button class="secondary-button" data-action="restore-client-backup" data-id="${escapeHTML(backup.id)}"><i data-lucide="history"></i>恢复</button></div>`).join('')
  $('#content').innerHTML = `<div class="page-stack client-config-page">
    <div class="page-toolbar"><div class="toolbar-copy"><h2>CC Switch</h2><p>统一管理本机 AI 编程客户端，切换前自动备份，失败时自动回滚。</p></div><button class="primary-button" data-action="new-client-profile"><i data-lucide="plus"></i>新建配置档</button></div>
    <div class="client-tabs">${clientTabsMarkup()}</div>
    <div class="client-layout">
      <section class="panel client-status-panel"><div class="panel-header"><div><h2>${escapeHTML(selectedName)}</h2><p>${escapeHTML(selected.description || '本地配置状态')}</p></div><span class="status-badge ${clientState?.installed ? 'active' : 'inactive'}">${clientState?.installed ? '已安装' : '未安装'}</span></div><div class="panel-body"><div class="client-install-status"><span class="client-install-dot ${clientState?.installed ? 'installed' : ''}"></span><div><strong>${clientState?.installed ? '客户端已安装' : '客户端未安装'}</strong>${clientState?.installed && clientState.installDir ? `<p>安装目录：${escapeHTML(clientState.installDir)}</p>` : ''}</div></div><div class="client-target-list">${clientTargetRows(clientState)}</div></div></section>
      <section class="panel"><div class="panel-header"><div><h2>配置档</h2><p>${number(profiles.length)} 个可切换配置</p></div></div><div class="panel-body profile-list">${profileRows || empty('layers-3', '暂无配置档', '新建配置档后即可安全切换客户端连接。')}</div></section>
    </div>
    <section class="panel"><div class="panel-header"><div><h2>配置备份</h2><p>每次应用前自动保存原始文件</p></div></div><div class="panel-body backup-list">${backupRows || empty('archive-restore', '暂无备份', '首次切换配置后会在这里显示恢复点。')}</div></section>
  </div>`
  icons($('#content'))
}

function prefetchOtherClients() {
  state.clientDefinitions.forEach((client) => {
    if (client.id !== state.clientId && !state.clientCache[client.id]) loadClientData(client.id).catch(() => {})
  })
}

async function renderClients() {
  if (!state.clientDefinitions.length) {
    const clients = await ccRequest('listClients')
    state.clientDefinitions = Array.isArray(clients) ? clients : []
  }
  if (!state.clientDefinitions.some((item) => item.id === state.clientId)) state.clientId = state.clientDefinitions[0]?.id || 'codex'
  const selected = state.clientDefinitions.find((item) => item.id === state.clientId) || { id: state.clientId, label: state.clientId, targets: [] }
  const requestedClientId = state.clientId
  const cached = state.clientCache[requestedClientId]
  if (cached) paintClients(selected, cached)
  else renderClientLoading(selected)
  ensureClientKeys().catch(() => {})
  const data = await loadClientData(requestedClientId)
  if (state.route !== 'clients' || state.clientId !== requestedClientId) return
  paintClients(selected, data)
  setTimeout(prefetchOtherClients, 0)
}

async function openLogDetail(id) {
  const item = await request(`/usage/${id}`)
  openModal('调用详情', `<div class="detail-list">
    <div class="detail-row"><span>请求 ID</span><strong>${escapeHTML(item.request_id || `#${item.id}`)}</strong></div>
    <div class="detail-row"><span>模型</span><strong>${escapeHTML(item.model || '-')}</strong></div>
    <div class="detail-row"><span>API Key</span><strong>${escapeHTML(item.api_key?.name || item.api_key_id || '-')}</strong></div>
    <div class="detail-row"><span>分组</span><strong>${escapeHTML(item.group?.name || item.group_id || '-')}</strong></div>
    <div class="detail-row"><span>输入 / 输出 Token</span><strong>${number(item.input_tokens)} / ${number(item.output_tokens)}</strong></div>
    <div class="detail-row"><span>缓存读取 / 写入</span><strong>${number(item.cache_read_tokens)} / ${number(item.cache_creation_tokens)}</strong></div>
    <div class="detail-row"><span>实际消费</span><strong>${money(item.actual_cost)}</strong></div>
    <div class="detail-row"><span>请求耗时</span><strong>${item.duration_ms == null ? '-' : `${number(item.duration_ms)} ms`}</strong></div>
    <div class="detail-row"><span>创建时间</span><strong>${escapeHTML(dateTime(item.created_at))}</strong></div>
  </div>`, '<button class="primary-button" data-action="close-modal">完成</button>')
}

function redeemHistoryTitle(item) {
  if (item.type === 'balance') return '余额充值（兑换）'
  if (item.type === 'concurrency') return '并发增加（兑换）'
  if (item.type === 'subscription') return '套餐已分配'
  if (item.type === 'admin_balance') return item.value >= 0 ? '余额充值（管理员）' : '余额扣除（管理员）'
  if (item.type === 'admin_concurrency') return item.value >= 0 ? '并发增加（管理员）' : '并发减少（管理员）'
  return '兑换记录'
}

function redeemHistoryValue(item) {
  if (item.type === 'subscription') return `${number(item.validity_days || item.value)} 天${item.group?.name ? ` · ${escapeHTML(item.group.name)}` : ''}`
  if (item.type === 'concurrency' || item.type === 'admin_concurrency') return `${item.value >= 0 ? '+' : ''}${number(item.value)} 请求`
  return `${item.value >= 0 ? '+' : ''}${money(item.value)}`
}

async function renderRedeem() {
  const [user, historyData] = await Promise.all([request('/auth/me'), request('/redeem/history').catch(() => ({ items: [] }))])
  state.user = user
  const history = paginated(historyData).items
  const rows = history.map((item) => `<div class="redeem-activity-row"><div class="redeem-activity-icon ${item.type?.includes('concurrency') ? 'blue' : 'green'}"><i data-lucide="${item.type?.includes('concurrency') ? 'zap' : 'circle-dollar-sign'}"></i></div><div class="redeem-activity-copy"><strong>${escapeHTML(redeemHistoryTitle(item))}</strong><span>${escapeHTML(dateTime(item.used_at || item.created_at))}</span></div><div class="redeem-activity-value"><strong>${redeemHistoryValue(item)}</strong><span>${item.code ? escapeHTML(`${String(item.code).slice(0, 8)}...`) : '管理员调整'}</span></div></div>`).join('')
  $('#content').innerHTML = `<div class="page-stack redeem-page">
    <section class="redeem-hero"><div><p class="eyebrow">REDEEM CODE</p><h2>兑换码</h2><p>兑换余额、并发额度或套餐权益，到账后会立即更新账户。</p></div><div class="redeem-balance"><span>当前余额</span><strong>${money(user.balance)}</strong><small>并发 ${number(user.concurrency)} 请求</small></div></section>
    <section class="panel redeem-form-panel"><div class="panel-header"><div><h2>输入兑换码</h2><p>每个兑换码只能使用一次</p></div></div><div class="panel-body"><form id="redeem-form" class="redeem-form"><input name="code" placeholder="请输入兑换码" autocomplete="off" required /><button class="primary-button" type="submit"><i data-lucide="ticket-check"></i>立即兑换</button></form></div></section>
    <section class="redeem-guide"><div class="redeem-guide-icon"><i data-lucide="info"></i></div><div><strong>关于兑换码</strong><ul><li>每个兑换码只能使用一次</li><li>兑换码可以增加余额、并发数或试用权限</li><li>如有兑换问题，请联系客服 <span class="contact-pill">Tg：@DEWENBOSS</span></li><li>余额和并发数兑换后即时更新</li></ul></div></section>
    <section class="panel"><div class="panel-header"><div><h2>最近活动</h2><p>${number(history.length)} 条兑换与账户调整记录</p></div></div><div class="panel-body redeem-activity-list">${rows || empty('clock-3', '暂无活动记录', '兑换成功后，记录会显示在这里。')}</div></section>
  </div>`
  icons($('#content'))
}

async function renderBilling() {
  const [ordersData, paymentConfig, checkout, user] = await Promise.all([
    request('/payment/orders/my?page=1&page_size=20').catch(() => ({ items: [], total: 0 })),
    request('/payment/config').catch((error) => ({ payment_enabled: false, unavailable_reason: error.message })),
    request('/payment/checkout-info').catch(() => ({ methods: {}, plans: [], balance_disabled: true, balance_recharge_multiplier: 1, recharge_fee_rate: 0 })),
    request('/auth/me'),
  ])
  state.user = user
  state.payment.checkout = checkout
  const methods = visiblePaymentMethods(checkout?.methods)
  const enabledMethods = methods.filter((item) => item.available !== false)
  if (!enabledMethods.some((item) => item.type === state.payment.selectedMethod)) state.payment.selectedMethod = enabledMethods[0]?.type || ''
  const rechargeEnabled = paymentConfig?.payment_enabled !== false && checkout?.balance_disabled !== true && enabledMethods.length > 0
  const orders = paginated(ordersData).items
  const orderRows = orders.map((item) => {
    const pending = String(item.status).toUpperCase() === 'PENDING'
    return `<tr><td><div class="cell-title"><strong>${escapeHTML(item.out_trade_no || `订单 #${item.id}`)}</strong><span>${escapeHTML(paymentMethodLabel(PAYMENT_METHOD_ALIASES[item.payment_type] || item.payment_type, item.payment_type))}</span></div></td><td><div class="cell-title"><strong>${escapeHTML(gatewayMoney(item.pay_amount ?? item.amount, item.currency || 'CNY'))}</strong><span>到账 ${money(item.amount)}</span></div></td><td><span class="status-badge ${escapeHTML(paymentStatusClass(item.status))}">${escapeHTML(paymentStatusLabel(item.status))}</span></td><td>${escapeHTML(dateTime(item.created_at))}</td><td><div class="table-actions">${pending && item.out_trade_no ? `<button class="icon-button" data-action="verify-payment-order" data-order-no="${escapeHTML(item.out_trade_no)}" title="查询支付状态" aria-label="查询支付状态"><i data-lucide="refresh-cw"></i></button>` : ''}${pending ? `<button class="icon-button" data-action="cancel-payment-order" data-id="${escapeHTML(item.id)}" title="取消订单" aria-label="取消订单"><i data-lucide="x"></i></button>` : ''}</div></td></tr>`
  }).join('')
  $('#content').innerHTML = `<div class="page-stack">
    <div class="metrics-grid">
      ${metric('历史订单', number(paginated(ordersData).total), '仅你的订单', 'receipt-text')}
      ${metric('账户余额', money(user?.balance), rechargeEnabled ? '可在线充值' : '在线充值暂不可用', 'wallet-cards', rechargeEnabled ? 'green' : 'dark')}
      ${metric('待处理订单', number(orders.filter((item) => String(item.status).toUpperCase() === 'PENDING').length), '等待支付确认', 'clock-3', 'amber')}
      ${metric('已完成订单', number(orders.filter((item) => String(item.status).toUpperCase() === 'COMPLETED').length), '最近 20 笔订单', 'circle-check', 'green')}
    </div>
    <section class="panel recharge-panel">
      <div class="panel-header"><div><h2>在线充值</h2><p>由 AIHub 官方支付系统处理，到账后自动更新余额</p></div><span class="status-badge ${rechargeEnabled ? 'active' : 'inactive'}">${rechargeEnabled ? '可用' : '未开放'}</span></div>
      ${rechargeEnabled ? `<form id="recharge-form" class="recharge-layout">
        <div class="recharge-controls">
          <label><span>充值金额</span><div class="amount-input"><span>$</span><input id="recharge-amount" name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" value="20" required /></div></label>
          <div class="amount-presets" aria-label="快捷金额">${[10, 20, 50, 100, 200, 500].map((amount) => `<button type="button" data-action="set-recharge-amount" data-amount="${amount}" class="${amount === 20 ? 'active' : ''}">$${amount}</button>`).join('')}</div>
          <fieldset class="payment-methods"><legend>支付方式</legend>${enabledMethods.map((item) => `<button type="button" class="payment-method ${item.type === state.payment.selectedMethod ? 'active' : ''}" data-action="select-payment-method" data-method="${escapeHTML(item.type)}"><i data-lucide="${paymentMethodIcon(item.type)}"></i><span><strong>${escapeHTML(item.display_name || paymentMethodLabel(item.type))}</strong><small>${item.single_min > 0 || item.single_max > 0 ? `${item.single_min > 0 ? `最低 ${gatewayMoney(item.single_min, item.currency)}` : ''}${item.single_min > 0 && item.single_max > 0 ? ' · ' : ''}${item.single_max > 0 ? `最高 ${gatewayMoney(item.single_max, item.currency)}` : ''}` : '按渠道实时结算'}</small></span><i data-lucide="check"></i></button>`).join('')}</fieldset>
          <p id="recharge-error" class="form-error hidden" role="alert"></p>
        </div>
        <aside class="recharge-summary">
          <div><span>充值余额</span><strong id="recharge-credit">$20.00</strong></div>
          <div><span>手续费</span><strong id="recharge-fee">$0.00</strong></div>
          <div class="recharge-total"><span>实际支付</span><strong id="recharge-total">$20.00</strong></div>
          <p id="recharge-rate-note" class="muted"></p>
          <button id="create-payment-order" class="primary-button wide" type="submit"><i data-lucide="shield-check"></i>创建充值订单</button>
          <p class="payment-security"><i data-lucide="lock-keyhole"></i>支付在 AIHub 官方渠道完成</p>
        </aside>
      </form>` : empty('wallet-cards', '在线充值暂不可用', paymentConfig?.unavailable_reason || (paymentConfig?.payment_enabled === false ? 'AIHub 当前未启用在线支付。' : checkout?.balance_disabled ? 'AIHub 当前关闭了余额充值。' : 'AIHub 当前没有可用支付渠道。'))}
    </section>
    <section class="panel"><div class="panel-header"><div><h2>订单记录</h2><p>支付与退款状态</p></div></div>${orderRows ? `<div class="data-table-wrap"><table class="data-table payment-orders"><thead><tr><th>订单号</th><th>金额</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${orderRows}</tbody></table></div>` : empty('receipt', '暂无订单', '创建充值订单后会显示在这里。')}</section>
  </div>`
  icons($('#content'))
  updateRechargePreview()
  cleanupPaymentPolling(true)
  if (orders.some((item) => ['PENDING', 'PAID', 'RECHARGING'].includes(String(item.status).toUpperCase()))) {
    state.payment.billingTimer = setInterval(() => {
      if (state.route === 'billing' && !state.payment.activeOrder && !document.body.classList.contains('modal-open')) renderBilling().catch(() => {})
    }, 12000)
  }
}

async function renderInvoices() {
  const [eligibleData, applicationsData] = await Promise.all([
    request('/invoices/eligible-orders'),
    request('/invoices/my'),
  ])
  const eligibleOrders = paginated(eligibleData).items
  const applications = paginated(applicationsData).items
  const orderOptions = eligibleOrders.map((order) => `<option value="${escapeHTML(order.id)}">#${escapeHTML(order.out_trade_no || order.id)} · ${escapeHTML(gatewayMoney(order.amount, order.currency || 'CNY'))} · ${escapeHTML(dateTime(order.completed_at || order.created_at))}</option>`).join('')
  const applicationRows = applications.map((item) => {
    const processed = String(item.status || '').toLowerCase() === 'processed'
    return `<tr><td>#${escapeHTML(item.payment_order_id)}</td><td><div class="cell-title"><strong>${escapeHTML(item.company_title || '-')}</strong><span>${escapeHTML(item.tax_number || '-')}</span></div></td><td>${escapeHTML(item.email || '-')}</td><td><span class="status-badge ${processed ? 'active' : 'pending'}">${processed ? '已处理' : '待审核'}</span></td><td>${escapeHTML(dateTime(item.created_at))}</td></tr>`
  }).join('')
  $('#content').innerHTML = `<div class="page-stack invoice-page">
    <section id="invoice-rules" class="invoice-rules"><div class="invoice-rules-icon"><i data-lucide="file-check-2"></i></div><div><p class="eyebrow">申请规则</p><h2>充值满 300，可申请研发服务发票</h2><p>单笔已完成充值达到 300 方可申请，同一订单不能重复提交。发票内容为“研发服务”，预计 1 - 3 个工作日发送到收票邮箱。</p></div></section>
    <div class="two-column invoice-columns">
      <section class="panel"><div class="panel-header"><div><h2>提交申请</h2><p>支持填写多个收票邮箱</p></div></div><div class="panel-body">${eligibleOrders.length ? `<form id="invoice-application-form" class="form-grid">
        <label class="span-two"><span>充值订单</span><select name="payment_order_id" required><option value="">请选择符合条件的订单</option>${orderOptions}</select></label>
        <label class="span-two"><span>公司 / 个人抬头</span><input name="company_title" maxlength="200" required /></label>
        <label class="span-two"><span>税号</span><input name="tax_number" maxlength="64" required /></label>
        <label class="span-two"><span>收票邮箱</span><input name="email" inputmode="email" maxlength="255" placeholder="多个邮箱可用逗号、分号或空格分隔" required /><small>提交前会统一为英文逗号分隔，最长 255 字节。</small></label>
        <div class="span-two button-row"><button type="submit" class="primary-button"><i data-lucide="send"></i>提交发票申请</button></div>
      </form>` : empty('receipt-text', '暂无可申请订单', '单笔已完成充值达到 300 后，可在这里提交发票申请。')}</div></section>
      <section class="panel invoice-delivery"><div class="panel-header"><div><h2>邮件交付</h2><p>站内不保存发票文件</p></div></div><div class="panel-body detail-list"><div class="detail-row"><span>开票内容</span><strong>研发服务</strong></div><div class="detail-row"><span>预计时效</span><strong>1 - 3 个工作日</strong></div><div class="detail-row"><span>交付方式</span><strong>发送到收票邮箱</strong></div></div></section>
    </div>
    <section id="invoice-applications" class="panel"><div class="panel-header"><div><h2>申请记录</h2><p>${number(applications.length)} 条记录</p></div></div>${applicationRows ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>订单</th><th>抬头 / 税号</th><th>邮箱</th><th>状态</th><th>申请时间</th></tr></thead><tbody>${applicationRows}</tbody></table></div>` : empty('clock-3', '暂无申请记录', '提交发票申请后，处理状态会显示在这里。')}</section>
  </div>`
  icons($('#content'))
}

function updateRechargePreview() {
  const form = $('#recharge-form')
  if (!form || !state.payment.checkout) return
  const amount = Number($('#recharge-amount')?.value || 0)
  const methods = visiblePaymentMethods(state.payment.checkout.methods)
  const method = methods.find((item) => item.type === state.payment.selectedMethod)
  const error = $('#recharge-error')
  let message = ''
  if (!Number.isFinite(amount) || amount <= 0) message = '请输入有效的充值金额。'
  else if (!method) message = '请选择支付方式。'
  else if (method.available === false) message = '该支付方式当前不可用。'
  else if (Number(method.single_min) > 0 && amount < Number(method.single_min)) message = `该渠道最低充值 ${gatewayMoney(method.single_min, method.currency)}。`
  else if (Number(method.single_max) > 0 && amount > Number(method.single_max)) message = `该渠道最高充值 ${gatewayMoney(method.single_max, method.currency)}。`
  const feeRate = Number(state.payment.checkout.recharge_fee_rate || 0)
  const fee = feeRate > 0 && amount > 0 ? Math.ceil((amount * feeRate / 100) * 100) / 100 : 0
  const total = Math.round((Math.max(0, amount) + fee) * 100) / 100
  const multiplier = Number(state.payment.checkout.balance_recharge_multiplier || 1) > 0 ? Number(state.payment.checkout.balance_recharge_multiplier || 1) : 1
  const credited = Math.round(Math.max(0, amount) * multiplier * 100) / 100
  const currency = method?.currency || 'CNY'
  $('#recharge-credit').textContent = money(credited)
  $('#recharge-fee').textContent = gatewayMoney(fee, currency)
  $('#recharge-total').textContent = gatewayMoney(total, currency)
  $('#recharge-rate-note').textContent = multiplier !== 1 ? `充值汇率：每 $1.00 到账 $${multiplier.toFixed(2)}` : feeRate > 0 ? `渠道手续费 ${number(feeRate, 2)}%` : '当前渠道不收取充值手续费'
  error.textContent = message
  error.classList.toggle('hidden', !message)
  $('#create-payment-order').disabled = Boolean(message)
}

function paymentQRCodeMarkup(value) {
  if (!value) return ''
  if (String(value).startsWith('data:image/')) return `<img src="${escapeHTML(value)}" alt="支付二维码" />`
  if (typeof window.qrcode !== 'function') return '<p class="form-error">二维码组件未加载，请使用“打开支付页面”。</p>'
  try {
    const code = window.qrcode(0, 'M')
    code.addData(String(value))
    code.make()
    return code.createImgTag(7, 12, '支付二维码')
  } catch {
    return '<p class="form-error">无法生成二维码，请使用“打开支付页面”。</p>'
  }
}

function officialPaymentRoute(order) {
  const base = 'https://aihub.top'
  if (order.paymentType === 'airwallex' && order.client_secret && order.intent_id) {
    const params = new URLSearchParams({ order_id: String(order.order_id) })
    if (order.out_trade_no) params.set('out_trade_no', order.out_trade_no)
    if (order.resume_token) params.set('resume_token', order.resume_token)
    return `${base}/payment/airwallex?${params}`
  }
  if (order.client_secret) {
    const params = new URLSearchParams({ order_id: String(order.order_id), client_secret: order.client_secret })
    if (order.resume_token) params.set('resume_token', order.resume_token)
    if (order.paymentType === 'alipay') params.set('method', 'alipay')
    if (order.paymentType === 'wxpay') params.set('method', 'wechat_pay')
    return `${base}/payment/stripe?${params}`
  }
  return order.pay_url || ''
}

function showPaymentOrder(order) {
  cleanupPaymentPolling()
  state.payment.activeOrder = order
  state.payment.verifyAttempts = 0
  state.payment.lastVerifyAt = 0
  const launchUrl = officialPaymentRoute(order)
  order.launchUrl = launchUrl
  openModal('完成支付', `<div class="payment-waiting">
    <div class="payment-order-status"><span class="status-badge pending" id="payment-live-status">等待支付</span><span id="payment-countdown">--:--</span></div>
    ${order.qr_code ? `<div class="payment-qr">${paymentQRCodeMarkup(order.qr_code)}</div><h3>请使用${escapeHTML(paymentMethodLabel(order.paymentType))}扫码</h3>` : '<div class="payment-launch-icon"><i data-lucide="external-link"></i></div><h3>请在 AIHub 官方支付页面完成付款</h3>'}
    <p id="payment-live-hint" class="muted">桌面端正在等待 AIHub 确认支付结果，请勿重复创建订单。</p>
    <div class="payment-order-summary"><div><span>充值余额</span><strong>${money(order.amount)}</strong></div><div><span>实际支付</span><strong>${gatewayMoney(order.pay_amount, order.currency || 'CNY')}</strong></div><div><span>订单号</span><code>${escapeHTML(order.out_trade_no || `#${order.order_id}`)}</code></div></div>
  </div>`, `${launchUrl ? '<button class="secondary-button" data-action="open-payment-page"><i data-lucide="external-link"></i>打开支付页面</button>' : ''}<button class="secondary-button" data-action="verify-active-payment"><i data-lucide="refresh-cw"></i>查询状态</button><button class="danger-button" data-action="cancel-active-payment">取消订单</button>`)
  if (launchUrl && !order.qr_code) window.aihub.openExternal(launchUrl)
  updatePaymentCountdown()
  state.payment.pollTimer = setInterval(() => pollActivePayment(false), 3000)
}

function updatePaymentCountdown() {
  const node = $('#payment-countdown')
  const order = state.payment.activeOrder
  if (!node || !order) return
  const seconds = Math.max(0, Math.floor((new Date(order.expires_at).getTime() - Date.now()) / 1000))
  node.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

async function pollActivePayment(manual) {
  const active = state.payment.activeOrder
  if (!active || active.polling) return
  active.polling = true
  try {
    let order = await request(`/payment/orders/${active.order_id}`)
    const status = String(order.status || '').toUpperCase()
    const shouldVerify = status === 'PENDING' && active.out_trade_no && (manual || (active.paymentType === 'wxpay' && state.payment.verifyAttempts < 6 && Date.now() - state.payment.lastVerifyAt >= 15000))
    if (shouldVerify) {
      state.payment.lastVerifyAt = Date.now()
      state.payment.verifyAttempts += 1
      order = await request('/payment/orders/verify', { method: 'POST', body: { out_trade_no: active.out_trade_no } })
    }
    active.status = String(order.status || '').toUpperCase()
    updatePaymentCountdown()
    const badge = $('#payment-live-status')
    if (badge) {
      badge.className = `status-badge ${paymentStatusClass(active.status)}`
      badge.textContent = paymentStatusLabel(active.status)
    }
    const hint = $('#payment-live-hint')
    if (hint && ['PAID', 'RECHARGING'].includes(active.status)) hint.textContent = '支付已确认，AIHub 正在将金额计入账户余额。'
    if (active.status === 'COMPLETED') return finishActivePayment(order)
    if (['CANCELLED', 'EXPIRED', 'FAILED'].includes(active.status)) return finishActivePayment(order)
    if (manual) toast(`订单状态：${paymentStatusLabel(active.status)}`)
  } catch (error) {
    if (manual) toast(error.message, 'error')
  } finally {
    active.polling = false
  }
}

async function finishActivePayment(order) {
  cleanupPaymentPolling()
  const success = String(order.status).toUpperCase() === 'COMPLETED'
  if (success) {
    try { state.user = await request('/auth/me') } catch {}
  }
  const body = success
    ? `<div class="payment-result success"><i data-lucide="circle-check-big"></i><h3>充值已到账</h3><p>当前余额 ${money(state.user?.balance)}</p><div class="payment-order-summary"><div><span>充值金额</span><strong>${money(order.amount)}</strong></div><div><span>订单号</span><code>${escapeHTML(order.out_trade_no)}</code></div></div></div>`
    : `<div class="payment-result"><i data-lucide="circle-x"></i><h3>${escapeHTML(paymentStatusLabel(order.status))}</h3><p>该订单未完成充值，你可以返回后重新创建订单。</p></div>`
  openModal(success ? '充值成功' : '订单已结束', body, '<button class="primary-button" data-action="finish-payment">完成</button>')
}

async function renderAffiliate() {
  const aff = await request('/user/aff')
  const invitees = aff?.invitees || []
  const rows = invitees.map((item) => `<tr><td><div class="cell-title"><strong>${escapeHTML(item.username || '用户')}</strong><span>${escapeHTML(item.email || '')}</span></div></td><td>${money(item.total_rebate)}</td><td>${escapeHTML(dateTime(item.created_at))}</td></tr>`).join('')
  $('#content').innerHTML = `<div class="page-stack">
    <div class="metrics-grid">
      ${metric('已邀请', number(aff.aff_count), '成功注册用户', 'users-round', 'green')}
      ${metric('可转余额', money(aff.aff_quota), '可转入账户余额', 'coins')}
      ${metric('累计返利', money(aff.aff_history_quota), '历史总额', 'chart-spline', 'amber')}
      ${metric('返利比例', `${number(aff.effective_rebate_rate_percent, 2)}%`, '当前有效比例', 'percent', 'dark')}
    </div>
    <section class="panel"><div class="panel-header"><div><h2>邀请链接</h2><p>分享给需要 AI API 的朋友</p></div></div><div class="panel-body"><div class="inline-form"><input id="affiliate-link" readonly value="${escapeHTML(`https://aihub.top/register?aff=${aff.aff_code || ''}`)}" /><button class="secondary-button" data-action="copy-affiliate"><i data-lucide="copy"></i>复制</button>${Number(aff.aff_quota || 0) > 0 ? '<button class="primary-button" data-action="transfer-affiliate"><i data-lucide="arrow-right-left"></i>转入余额</button>' : ''}</div></div></section>
    <section class="panel"><div class="panel-header"><div><h2>邀请记录</h2><p>${number(invitees.length)} 位用户</p></div></div>${rows ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>用户</th><th>贡献返利</th><th>注册时间</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('user-plus', '还没有邀请记录', '复制邀请链接分享后，成功注册的用户会显示在这里。')}</section>
  </div>`
  icons($('#content'))
}

async function renderAccount() {
  const profile = await request('/user/profile')
  state.user = profile
  $('#content').innerHTML = `<div class="page-stack">
    <div class="two-column">
      <section class="panel"><div class="panel-header"><div><h2>个人资料</h2><p>账户公开信息</p></div></div><div class="panel-body"><form id="profile-form" class="form-grid">
        <label class="span-two"><span>用户名</span><input name="username" value="${escapeHTML(profile.username || '')}" required /></label>
        <label class="span-two"><span>邮箱</span><input value="${escapeHTML(profile.email || '')}" disabled /></label>
        <label><span>账户状态</span><input value="${escapeHTML(profile.status || '')}" disabled /></label>
        <label><span>并发额度</span><input value="${number(profile.concurrency)}" disabled /></label>
        <div class="span-two button-row"><button type="submit" class="primary-button"><i data-lucide="save"></i>保存资料</button></div>
      </form></div></section>
      <section class="panel"><div class="panel-header"><div><h2>账户概览</h2><p>只读信息</p></div></div><div class="panel-body detail-list">
        <div class="detail-row"><span>账户 ID</span><strong>${number(profile.id)}</strong></div>
        <div class="detail-row"><span>可用余额</span><strong>${money(profile.balance)}</strong></div>
        <div class="detail-row"><span>每分钟限制</span><strong>${profile.rpm_limit ? `${number(profile.rpm_limit)} RPM` : '不限制'}</strong></div>
        <div class="detail-row"><span>创建时间</span><strong>${escapeHTML(dateTime(profile.created_at))}</strong></div>
        <div class="detail-row"><span>最近活跃</span><strong>${escapeHTML(dateTime(profile.last_active_at))}</strong></div>
      </div></section>
    </div>
    <section class="panel"><div class="panel-header"><div><h2>安全设置</h2><p>修改密码或撤销其他设备会话</p></div></div><div class="panel-body"><form id="password-form" class="form-grid">
      <label><span>当前密码</span><input name="old_password" type="password" autocomplete="current-password" required /></label>
      <label><span>新密码</span><input name="new_password" type="password" minlength="8" autocomplete="new-password" required /></label>
      <div class="span-two button-row"><button type="submit" class="secondary-button"><i data-lucide="lock-keyhole"></i>修改密码</button><button type="button" class="danger-button" data-action="revoke-sessions"><i data-lucide="log-out"></i>退出所有设备</button></div>
    </form></div></section>
  </div>`
  icons($('#content'))
}

function renderGuide() {
  const sections = [
    { number: '01', title: 'Node.js 环境安装', icon: 'square-terminal', body: '<p>Claude Code、Codex 和 Gemini CLI 都可通过 npm 安装。建议使用 Node.js 20 LTS 或更高版本，安装后重新打开终端。</p>', code: 'node -v\nnpm -v', link: ['https://nodejs.org/en/download', '下载 Node.js LTS'] },
    { number: '02', title: 'API 密钥高级功能', icon: 'key-round', body: '<p>创建或编辑密钥时可同时设置最大倍率、倍率变动邮件、三种故障转移策略、候选或排除分组，以及自然回切、积极回切和不自动回切。</p><p>转移依据真实分组样本、供应商大厅探测与满足前两项后的主动探测，并由 AIHub 服务端执行切换。</p>', action: ['keys', '管理 API Key'] },
    { number: '03', title: 'CCS 一键导入', icon: 'import', body: '<p>推荐先安装 CC Switch，再从 AIHub 密钥列表发起一键导入。写入前请核对应用类型、API 端点、模型和密钥掩码。</p>', link: ['https://github.com/farion1231/cc-switch/releases/latest', '下载 CC Switch'] },
    { number: '04', title: 'Claude Code 配置教程', icon: 'bot', body: '<p>安装 Anthropic 官方 CLI，并在 <code>~/.claude/settings.json</code> 中把请求地址与认证令牌指向 AIHub。配置文件包含明文 Key，请勿提交或分享。</p>', code: 'npm install -g @anthropic-ai/claude-code\nclaude --version\n\nANTHROPIC_BASE_URL=https://api.aihub.top\nANTHROPIC_AUTH_TOKEN=<AIHUB_API_KEY>' },
    { number: '05', title: 'Codex 配置教程', icon: 'code-2', body: '<p>通过自定义模型提供商连接 AIHub 的 OpenAI 兼容接口。配置保存在 <code>~/.codex/config.toml</code> 和 <code>~/.codex/auth.json</code>。</p>', code: 'npm install -g @openai/codex@latest\ncodex --version\n\nbase_url = "https://aihub.top/v1"\nexperimental_bearer_token = "<AIHUB_API_KEY>"' },
    { number: '06', title: 'Gemini CLI 配置教程', icon: 'sparkles', body: '<p>使用 Gemini API Key 鉴权模式，把 <code>~/.gemini/.env</code> 中的网关地址设置为 AIHub。</p>', code: 'npm install -g @google/gemini-cli\ngemini --version\n\nGEMINI_API_KEY=<AIHUB_API_KEY>\nGOOGLE_GEMINI_BASE_URL=https://api.aihub.top' },
    { number: '07', title: 'AIHubRouter 自动路由工具', icon: 'route', body: '<p>AIHubRouter 是跨平台开源工具，可按倍率和首 Token 速度调整 Key 分组。它只调用 AIHub API，不代理模型请求，也不修改本地 CLI 配置。</p>', code: 'aihub-router route --once --dry-run --json\naihub-router watch --interval 60 --json', link: ['https://github.com/OnRightPath/AIHubRouter', '查看 AIHubRouter'] },
    { number: '08', title: '社区工具推荐', icon: 'users-round', body: '<p>站点社区还提供 Windows 状态客户端、AIHub Smart Group、LLM Retry Proxy、QQ 群机器人和 CC Switch 社区版。能力与版本以各项目仓库为准。</p>', link: ['https://aihub.top/tutorial#community-tools', '查看社区工具'] },
  ]
  const cards = sections.map((section) => {
    const code = section.code ? `<div class="guide-code"><pre><code>${escapeHTML(section.code)}</code></pre><button class="icon-button" data-action="copy-guide-code" title="复制命令" aria-label="复制命令"><i data-lucide="copy"></i></button></div>` : ''
    const action = section.action ? `<button class="secondary-button" data-route-jump="${section.action[0]}"><i data-lucide="arrow-up-right"></i>${section.action[1]}</button>` : section.link ? `<button class="secondary-button" data-action="open-guide-link" data-url="${escapeHTML(section.link[0])}"><i data-lucide="external-link"></i>${section.link[1]}</button>` : ''
    return `<article class="guide-section"><header><span class="guide-number">${section.number}</span><div><h2><i data-lucide="${section.icon}"></i>${section.title}</h2></div></header><div class="guide-section-body">${section.body}${code}${action}</div></article>`
  }).join('')
  $('#content').innerHTML = `<div class="page-stack guide-page"><section class="guide-hero"><div><p class="eyebrow">AIHUB DESKTOP · USER GUIDE</p><h2>从环境准备到自动路由</h2><p>这份教程对应当前 1.1.0 桌面端，并同步 AIHub 站点当前八章结构。示例模型与工具版本可能随站点更新。</p></div><span class="status-badge active">v${APP_VERSION}</span></section><div class="guide-grid">${cards}</div><section class="panel guide-note"><div class="panel-body"><i data-lucide="shield-check"></i><div><strong>接口边界</strong><p>桌面端只通过普通用户接口访问 AIHub，拒绝管理员路径。API Key 的故障转移策略由 AIHub 服务端执行切换；桌面端不保存号池，也不代理模型请求。</p></div></div></section></div>`
  icons($('#content'))
}

function renderChangelog() {
  const releases = [
    { version: '1.1.0', date: '当前版本', title: '充值优先的桌面工作台', items: ['移除套餐订阅入口，在线充值成为唯一购买流程。', '旧版套餐链接会自动转到充值页面，避免历史导航失效。'] },
    { version: '1.0.7', date: '上一版本', title: '密钥策略、故障转移与自助发票', items: ['增加最高倍率、倍率变更通知、三种故障转移策略和三种回切模式。', '调用日志新增故障转移审计，自助发票和八章使用教程同步上线。'] },
    { version: '1.0.6', date: '历史版本', title: '关于页布局优化', items: ['将关于本软件改为紧凑横向信息栏，避免品牌图占满首屏。', '软件信息、安全与隐私、帮助反馈在常用窗口尺寸下更易浏览。'] },
    { version: '1.0.5', date: '历史版本', title: '软件信息中心', items: ['在账户设置下新增“更新日志”和“关于本软件”两个独立页面。', '整理从 v1.0.1 至今的主要功能变化，便于快速了解每次更新。', '关于页面集中展示当前版本、运行平台、安全隐私和帮助信息。'] },
    { version: '1.0.4', date: '近期版本', title: '充值与版本管理', items: ['将“账单”统一更名为“充值”，充值流程和订单记录集中展示。', '正式打包自动清理旧版本产物，提供便携版、安装版和完整目录三种分发方式。', '完善安装版快捷方式与卸载入口，保留用户数据，升级更安心。'] },
    { version: '1.0.3', date: '近期版本', title: '支付、公告与用量体验', items: ['接入 AIHub 官方在线充值，支持二维码支付、官方收银台、订单查询、轮询和取消。', '公告支持 Markdown 渲染、代码块、表格、链接和已读状态。', '总览和用量增加缓存 Token 统计，明细区分缓存读取与写入。', '兑换码页面按账户余额、兑换输入、使用说明和最近活动重新整理。'] },
    { version: '1.0.2', date: '历史版本', title: '供应商大厅与客户端配置', items: ['供应商大厅内嵌后台并复用侧边栏，增加缓存命中率和样本不足提示。', '支持使用供应商分组新建密钥或切换已有密钥。', '增加最大倍率限制、自选分组故障转移和最低倍率故障转移。', '优化客户端配置加载和切换性能，启动时静默检测本地客户端安装状态。'] },
    { version: '1.0.1', date: '初始版本', title: 'AIHub Desktop 首次发布', items: ['提供普通用户登录、JWT 会话和记住账号功能。', '支持 API Key 管理、用量统计、调用日志、供应商大厅和客户端配置。', '支持 Codex 与 OpenCode 配置档生成、查看和本地客户端检测。', '提供深色主题、窗口拖动、系统代理兼容和启动诊断日志。'] },
  ]
  const cards = releases.map((release) => `<article class="release-item"><div class="release-marker"><span></span></div><div class="release-card"><header><div><span class="release-version">v${release.version}</span><span class="release-date">${release.date}</span></div><span class="status-badge ${release.version === APP_VERSION ? 'active' : ''}">${release.version === APP_VERSION ? '当前版本' : '已发布'}</span></header><h2>${release.title}</h2><ul>${release.items.map((item) => `<li>${item}</li>`).join('')}</ul></div></article>`).join('')
  $('#content').innerHTML = `<div class="page-stack changelog-page"><section class="page-intro"><div><p class="eyebrow">PRODUCT HISTORY</p><h2>每一次更新，都让工作台更顺手</h2><p>这里记录 AIHub Desktop 从 v1.0.1 到当前版本的主要变化。</p></div><span class="status-badge active">v${APP_VERSION}</span></section><section class="release-list">${cards}</section></div>`
  icons($('#content'))
}

function renderAbout() {
  $('#content').innerHTML = `<div class="page-stack about-page"><section class="about-hero"><img src="../../assets/icon.png" alt="AIHub Desktop" /><div><p class="eyebrow">AIHUB DESKTOP</p><h2>你的 API 工作台</h2><p>在 Windows 桌面上集中管理 AIHub 账户、API Key、用量、充值和客户端配置。</p></div><span class="status-badge active">v${APP_VERSION}</span></section><div class="two-column"><section class="panel"><div class="panel-header"><div><h2>软件信息</h2><p>当前运行版本与构建信息</p></div></div><div class="panel-body detail-list"><div class="detail-row"><span>软件名称</span><strong>AIHub Desktop</strong></div><div class="detail-row"><span>当前版本</span><strong>${APP_VERSION}</strong></div><div class="detail-row"><span>运行平台</span><strong>Windows x64</strong></div><div class="detail-row"><span>服务地址</span><strong>aihub.top</strong></div></div></section><section class="panel"><div class="panel-header"><div><h2>安全与隐私</h2><p>数据只用于完成你发起的操作</p></div></div><div class="panel-body about-copy"><p>本软件仅面向 AIHub 普通用户使用，不包含管理员功能。登录令牌保存在当前 Windows 用户的应用数据目录中，不会写入项目源码。</p><p>API Key 只会在你主动生成或保存客户端配置时使用。支付过程通过 AIHub 官方支付接口完成。</p></div></section></div><section class="panel"><div class="panel-header"><div><h2>帮助与反馈</h2><p>遇到问题时可先查看调用日志和启动诊断日志</p></div></div><div class="panel-body about-copy"><p>官方网站：<a href="https://aihub.top" target="_blank" rel="noreferrer">https://aihub.top</a></p><p>版本更新会继续同步到安装包、便携版和完整目录版本。</p></div></section><section class="panel"><div class="panel-header"><div><h2>致谢与开源许可</h2><p>当前 1.1.0 使用的开源项目和依赖</p></div></div><div class="panel-body about-copy attribution-list"><div><strong><a href="https://github.com/farion1231/cc-switch" target="_blank" rel="noreferrer">CC Switch</a></strong><span>MIT License · 客户端配置档、备份和切换工作流的实现参考</span></div><div><strong>Electron</strong><span>桌面窗口、系统托盘、网络请求和 Windows 安全存储</span></div><div><strong>Lucide · Chart.js · marked · DOMPurify · QRCode Generator</strong><span>图标、统计图表、公告 Markdown 安全渲染和支付二维码</span></div><div><strong>AIHub 官方接口</strong><span>账户、API Key、故障转移策略、供应商监测、用量和充值服务</span></div></div></section></div>`
  icons($('#content'))
}

function openModal(title, body, footer = '') {
  document.body.classList.add('modal-open')
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}"><header class="modal-header"><h2>${escapeHTML(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="关闭"><i data-lucide="x"></i></button></header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}</section></div>`
  icons($('#modal-root'))
}

async function openAnnouncementDetail(id) {
  const item = state.announcements.find((announcement) => String(announcement.id) === String(id))
  if (!item) throw new Error('公告不存在或已更新')
  openModal(item.title || '站点公告', `<article class="announcement-detail"><header><span>${escapeHTML(dateTime(item.created_at))}</span>${item.read_at ? '<span class="status-badge active">已读</span>' : '<span class="status-badge pending">未读</span>'}</header><div class="announcement-markdown">${renderMarkdown(item.content)}</div></article>`, '<button class="primary-button" data-action="close-modal">关闭</button>')
  if (!item.read_at) {
    try {
      await request(`/announcements/${item.id}/read`, { method: 'POST' })
      item.read_at = new Date().toISOString()
      const badge = $('.announcement-detail .status-badge')
      if (badge) {
        badge.className = 'status-badge active'
        badge.textContent = '已读'
      }
      $$('.announcement-row').find((row) => String(row.dataset.id) === String(item.id))?.querySelector('.announcement-unread')?.remove()
    } catch {
      // Reading the announcement must not fail because read tracking is unavailable.
    }
  }
}

function closeModal() {
  cleanupPaymentPolling()
  state.payment.activeOrder = null
  document.body.classList.remove('modal-open')
  $('#modal-root').innerHTML = ''
}

function keyGroupRate(group) {
  return Number(group?.user_rate ?? group?.rate_multiplier ?? group?.rate ?? 1)
}

function keyPolicyFields(key = {}) {
  const selectedFailover = (key.failover_group_ids || []).map(String)
  const selectedExcluded = new Set((key.failover_excluded_group_ids || []).map(String))
  const selectedGroups = new Set(selectedFailover)
  const orderedGroups = [
    ...selectedFailover.map((id) => state.groups.find((group) => String(group.id) === id)).filter(Boolean),
    ...state.groups.filter((group) => !selectedGroups.has(String(group.id))),
  ]
  const groupChecks = orderedGroups.map((group) => `<label class="failover-group-option"><input type="checkbox" name="failover_group_ids" value="${escapeHTML(group.id)}" ${selectedGroups.has(String(group.id)) ? 'checked' : ''} /><span><strong>${escapeHTML(group.name)}</strong><small>${number(keyGroupRate(group), 2)}x</small></span></label>`).join('')
  const excludedChecks = state.groups.map((group) => `<label class="failover-group-option"><input type="checkbox" name="failover_excluded_group_ids" value="${escapeHTML(group.id)}" ${selectedExcluded.has(String(group.id)) ? 'checked' : ''} /><span><strong>${escapeHTML(group.name)}</strong><small>${number(keyGroupRate(group), 2)}x</small></span></label>`).join('')
  return `<label><span>最大倍率（0 = 不限制）</span><input name="max_rate_multiplier" type="number" min="0" step="0.01" value="${escapeHTML(key.max_rate_multiplier ?? 0)}" placeholder="0 = 不限制" /><small>设置为 0 时不限制倍率；填写大于 0 的上限后，分组倍率超过该值时 Key 才会停止调用并返回错误。</small></label>
    <label class="key-policy-toggle"><input name="rate_change_notify_enabled" type="checkbox" ${key.rate_change_notify_enabled ? 'checked' : ''} /><span><strong>倍率变动通知</strong><small>分组倍率变化时，由 AIHub 官方接口发送通知</small></span></label>
    <label class="span-two key-policy-toggle"><input name="failover_enabled" type="checkbox" ${key.failover_enabled ? 'checked' : ''} /><span><strong>启用故障转移</strong><small>策略提交到 AIHub 官方接口，由网站服务端在当前分组不可用时执行</small></span></label>
    <div id="key-failover-options" class="span-two key-failover-options">
      <div class="failover-strategy-row"><span class="field-label">转移策略</span><div class="failover-strategy-segments"><label><input type="radio" name="failover_strategy" value="manual" ${!['lowest_rate', 'fastest'].includes(key.failover_strategy) ? 'checked' : ''} /><span><strong>自选分组</strong><small>仅在指定分组中转移</small></span></label><label><input type="radio" name="failover_strategy" value="lowest_rate" ${key.failover_strategy === 'lowest_rate' ? 'checked' : ''} /><span><strong>最低倍率</strong><small>自动选择倍率最低的可用组</small></span></label><label><input type="radio" name="failover_strategy" value="fastest" ${key.failover_strategy === 'fastest' ? 'checked' : ''} /><span><strong>最快响应</strong><small>自动选择最快的可用组</small></span></label></div></div>
      <div id="manual-failover-groups"><div class="failover-groups-heading"><span class="field-label">备用分组</span><small>主分组自动排除；按列表顺序尝试</small></div><div class="failover-group-grid">${groupChecks}</div></div>
      <div id="automatic-failover-exclusions"><div class="failover-groups-heading"><span class="field-label">排除分组</span><small>自动策略不会选择这些分组</small></div><div class="failover-group-grid">${excludedChecks}</div></div>
      <div class="failover-strategy-row"><span class="field-label">恢复主分组</span><div class="failover-recovery-segments"><label><input type="radio" name="failover_recovery_mode" value="sticky" ${key.failover_recovery_mode !== 'prefer_primary' && key.failover_recovery_mode !== 'manual_only' ? 'checked' : ''} /><span><strong>保持当前</strong><small>恢复后继续使用当前组</small></span></label><label><input type="radio" name="failover_recovery_mode" value="prefer_primary" ${key.failover_recovery_mode === 'prefer_primary' ? 'checked' : ''} /><span><strong>优先主组</strong><small>主组恢复后优先切回</small></span></label><label><input type="radio" name="failover_recovery_mode" value="manual_only" ${key.failover_recovery_mode === 'manual_only' ? 'checked' : ''} /><span><strong>仅手动</strong><small>仅在手动策略中切换</small></span></label></div></div>
    </div>`
}

function syncKeyPolicyForm() {
  const form = $('#create-key-form')
  if (!form) return
  const enabled = form.elements.failover_enabled.checked
  const strategy = form.elements.failover_strategy.value
  const primaryGroupId = String(form.elements.group_id.value || '')
  $$('[name="failover_group_ids"], [name="failover_excluded_group_ids"]', form).forEach((input) => {
    const isPrimary = Boolean(primaryGroupId) && input.value === primaryGroupId
    input.disabled = isPrimary
    if (isPrimary) input.checked = false
    input.closest('.failover-group-option')?.classList.toggle('disabled', isPrimary)
  })
  $('#key-failover-options')?.classList.toggle('hidden', !enabled)
  $('#manual-failover-groups')?.classList.toggle('hidden', !enabled || strategy !== 'manual')
  $('#automatic-failover-exclusions')?.classList.toggle('hidden', !enabled || strategy === 'manual')
}

function keyFailoverPayload(form, primaryGroupId) {
  const enabled = form.elements.failover_enabled.checked
  const strategy = form.elements.failover_strategy.value || 'manual'
  // The desktop app only persists the policy; AIHub executes failover server-side.
  return {
    rate_change_notify_enabled: Boolean(form.elements.rate_change_notify_enabled?.checked),
    failover_enabled: enabled,
    failover_strategy: strategy,
    failover_group_ids: enabled && strategy === 'manual'
      ? new FormData(form).getAll('failover_group_ids').map(Number).filter((id) => id > 0 && id !== primaryGroupId)
      : [],
    failover_excluded_group_ids: enabled && strategy !== 'manual'
      ? new FormData(form).getAll('failover_excluded_group_ids').map(Number).filter((id) => id > 0 && id !== primaryGroupId)
      : [],
    failover_recovery_mode: form.elements.failover_recovery_mode.value || 'sticky',
  }
}

function createKeyModal(key = null) {
  state.editingKeyId = key?.id || null
  const options = state.groups.map((group) => `<option value="${group.id}" ${String(state.preferredGroupId || '') === String(group.id) ? 'selected' : ''}>${escapeHTML(group.name)} · ${number(group.rate_multiplier ?? group.user_rate ?? 1, 2)}x</option>`).join('')
  const selectedGroup = key?.group_id ?? state.preferredGroupId
  const selectedOptions = state.groups.map((group) => `<option value="${group.id}" ${String(selectedGroup || '') === String(group.id) ? 'selected' : ''}>${escapeHTML(group.name)} · ${number(keyGroupRate(group), 2)}x</option>`).join('')
  openModal(key ? '编辑 API Key' : '新建 API Key', `<form id="create-key-form" class="form-grid key-editor-form">
    <label class="span-two"><span>名称</span><input name="name" value="${escapeHTML(key?.name || '')}" placeholder="例如：Codex" required /></label>
    <label class="span-two"><span>分组</span><select name="group_id"><option value="">自动选择</option>${selectedOptions || options}</select></label>
    <label><span>额度上限（USD）</span><input name="quota" type="number" min="0" step="0.01" value="${escapeHTML(key?.quota || '')}" placeholder="0 = 不限制" /></label>
    ${key ? '' : '<label><span>有效天数</span><input name="expires_in_days" type="number" min="1" placeholder="留空 = 永久" /></label>'}
    ${keyPolicyFields(key || {})}
  </form>`, `<button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="${key ? 'submit-update-key' : 'submit-create-key'}"><i data-lucide="${key ? 'save' : 'key-round'}"></i>${key ? '保存' : '创建'}</button>`)
  syncKeyPolicyForm()
  $('#create-key-form input').focus()
}

async function useProviderGroupModal(groupId, name, rateMultiplier) {
  state.providerTargetGroup = { id: Number(groupId), name, rateMultiplier: Number(rateMultiplier || 0) }
  const keysData = await request('/keys?page=1&page_size=100&status=active&sort_by=last_used_at&sort_order=desc')
  const keys = paginated(keysData).items
  const keyOptions = keys.map((key) => `<option value="${escapeHTML(key.id)}" ${Number(key.group_id) === Number(groupId) ? 'disabled' : ''}>${escapeHTML(key.name || `Key #${key.id}`)} · ${escapeHTML(key.group?.name || '未分组')}${Number(key.group_id) === Number(groupId) ? '（当前分组）' : ''}</option>`).join('')
  openModal(`使用分组：${name}`, `<div class="provider-group-target"><div><strong>${escapeHTML(name)}</strong><span>倍率 ${number(rateMultiplier, 2)}x</span></div><button class="secondary-button" data-action="create-provider-key"><i data-lucide="plus"></i>新建 API Key</button></div><form id="provider-key-switch-form"><label><span>切换已有密钥</span><select name="key_id"><option value="">${keyOptions ? '请选择 API Key' : '暂无可切换的 API Key'}</option>${keyOptions}</select></label><p class="muted">只修改所选密钥的主分组，密钥内容和其他策略保持不变。</p></form>`, `<button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="switch-provider-key" ${keyOptions ? '' : 'disabled'}><i data-lucide="shuffle"></i>切换到此分组</button>`)
}

function createClientProfileModal() {
  const client = state.clientDefinitions.find((item) => item.id === state.clientId)
  if (!client) return
  const targets = (client.targets || []).map((target) => typeof target === 'string' ? { id: target, label: target } : target)
  const editors = targets.map((target) => `<label class="span-two config-editor"><span>${escapeHTML(target.label || target.id)} <small>${escapeHTML(String(target.format || '').toUpperCase())}</small></span><textarea data-config-target="${escapeHTML(target.id)}" spellcheck="false" placeholder="${escapeHTML(target.placeholder || '粘贴或填写完整配置内容')}"></textarea></label>`).join('')
  const keyOptions = state.keys.filter((key) => key.status === 'active' && key.key).map((key) => `<option value="${escapeHTML(key.id)}">${escapeHTML(key.name || `Key #${key.id}`)} · ${escapeHTML(key.group?.name || '默认分组')}</option>`).join('')
  const isCodex = state.clientId.startsWith('codex')
  const providerField = isCodex ? '<label class="template-field"><span>模型供应商标识</span><input id="client-template-provider" value="OpenAI" placeholder="例如 OpenAI" /></label>' : ''
  const modelField = isCodex ? '<label class="template-field"><span>默认模型名称</span><input id="client-template-model" value="gpt-5.6-sol" placeholder="例如 gpt-5.6-sol" /></label>' : ''
  const keyField = `<label class="template-field"><span>AIHub API Key</span><select id="client-template-key" ${keyOptions ? '' : 'disabled'}><option value="">${keyOptions ? '请选择 Key' : '暂无可用 Key'}</option>${keyOptions}</select></label>`
  const clientName = client.name || client.label || client.id
  openModal(`新建 ${clientName} 配置档`, `<form id="client-profile-form" class="form-grid">
    <label class="span-two"><span>配置档名称</span><input name="name" placeholder="例如：AIHub 主线路" required /></label>
    <div class="span-two aihub-template-box">
      <div><strong>AIHub 快速配置</strong><p>使用模型 API Key 生成 ${escapeHTML(clientName)} 配置，不使用账户 JWT。</p></div>
      <div class="template-fields">${keyField}${providerField}${modelField}<button type="button" class="secondary-button" data-action="fill-aihub-template" ${keyOptions ? '' : 'disabled'}><i data-lucide="wand-sparkles"></i>生成配置</button></div>
    </div>
    ${editors}
    <p class="span-two config-safety-note"><i data-lucide="shield-check"></i>仅会写入 ${escapeHTML(clientName)} 的已知配置路径；应用前自动备份，写入失败自动回滚。</p>
  </form>`, '<button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="submit-client-profile"><i data-lucide="save"></i>保存配置档</button>')
  $('#client-profile-form input').focus()
}

function buildAIHubClientFiles(clientId, apiKey, model, profileName = 'AIHub', providerId = 'OpenAI') {
  const base = 'https://aihub.top'
  const openAIBase = `${base}/v1`
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`
  const safeProviderId = String(providerId || 'OpenAI').trim().replace(/[^A-Za-z0-9_-]+/g, '_') || 'OpenAI'
  const safeProfileName = String(profileName || 'AIHub').trim().replaceAll('"', '\\"') || 'AIHub'
  const codexConfig = (websocket = false) => ({
    config: `model = ${JSON.stringify(model)}\nmodel_provider = "${safeProviderId}"\nmodel_reasoning_effort = "enabled"\ndisable_response_storage = true\nnetwork_access = "enabled"\nwindows_wsl_setup_acknowledged = true\n\n[model_providers.${safeProviderId}]\nname = "${safeProfileName}"\nbase_url = "${openAIBase}"\nwire_api = "responses"\nrequires_openai_auth = false\n${websocket ? 'supports_websockets = true\n' : ''}http_headers = { "x-openai-actor-authorization" = "local-image-extension" }\n\n[features]\ngoals = true\n`,
    auth: json({ OPENAI_API_KEY: apiKey }),
  })
  const variants = (...names) => Object.fromEntries(names.map((name) => [name, {}]))
  const openCodeModel = (name, context, output, effortNames) => ({
    name, limit: { context, output }, options: { store: false }, variants: variants(...effortNames),
  })
  const files = {
    codex: codexConfig(false),
    'codex-websocket': codexConfig(true),
    opencode: {
      config: json({
        provider: {
          openai: {
            options: { baseURL: openAIBase, apiKey },
            models: {
              'gpt-5.2': openCodeModel('GPT-5.2', 400000, 128000, ['low', 'medium', 'high', 'xhigh']),
              'gpt-5.6': openCodeModel('GPT-5.6 (Sol)', 1050000, 128000, ['low', 'medium', 'high', 'xhigh', 'max']),
              'gpt-5.6-sol': openCodeModel('GPT-5.6 Sol', 1050000, 128000, ['low', 'medium', 'high', 'xhigh', 'max']),
              'gpt-5.6-terra': openCodeModel('GPT-5.6 Terra', 1050000, 128000, ['low', 'medium', 'high', 'xhigh', 'max']),
              'gpt-5.6-luna': openCodeModel('GPT-5.6 Luna', 1050000, 128000, ['low', 'medium', 'high', 'xhigh', 'max']),
              'gpt-5.5': openCodeModel('GPT-5.5', 1050000, 128000, ['low', 'medium', 'high', 'xhigh']),
              'gpt-5.4': openCodeModel('GPT-5.4', 1050000, 128000, ['low', 'medium', 'high', 'xhigh']),
              'gpt-5.4-mini': openCodeModel('GPT-5.4 Mini', 400000, 128000, ['low', 'medium', 'high', 'xhigh']),
              'gpt-5.3-codex-spark': openCodeModel('GPT-5.3 Codex Spark', 128000, 32000, ['low', 'medium', 'high', 'xhigh']),
              'codex-mini-latest': openCodeModel('Codex Mini', 200000, 100000, ['low', 'medium', 'high']),
            },
          },
        },
        agent: { build: { options: { store: false } }, plan: { options: { store: false } } },
        $schema: 'https://opencode.ai/config.json',
      }),
    },
  }
  return files[clientId] || {}
}

function confirmModal(title, message, confirmAction, danger = false) {
  openModal(title, `<p class="muted" style="margin:0;line-height:1.6">${escapeHTML(message)}</p>`, `<button class="secondary-button" data-action="close-modal">取消</button><button class="${danger ? 'danger-button' : 'primary-button'}" data-action="${confirmAction}">确认</button>`)
}

async function handleContentClick(event) {
  const target = event.target.closest('[data-action], [data-route-jump], [data-period-value], [data-provider-tab], [data-provider-window], [data-client-tab], [data-log-mode]')
  if (!target) return
  if (target.dataset.routeJump) return navigate(target.dataset.routeJump)
  if (target.dataset.periodValue) {
    state.usagePeriod = target.dataset.periodValue
    return navigate('usage')
  }
  if (target.dataset.providerWindow) {
    state.providerWindow = target.dataset.providerWindow
    return renderProviders()
  }
  if (target.dataset.clientTab) {
    state.clientId = target.dataset.clientTab
    $$('.client-tabs button').forEach((button) => button.classList.toggle('active', button === target))
    return renderClients()
  }
  if (target.dataset.logMode) {
    state.logs = { ...state.logs, mode: target.dataset.logMode, page: 1, filters: {} }
    return renderLogs()
  }
  const action = target.dataset.action
  if (action === 'retry') return navigate(state.route)
  if (action === 'open-guide-link') return window.aihub.openExternal(target.dataset.url)
  if (action === 'copy-guide-code') {
    const code = target.closest('.guide-code')?.querySelector('code')?.textContent
    if (code) { await window.aihub.copyText(code); toast('命令已复制') }
    return
  }
  if (action === 'announcement-detail') return openAnnouncementDetail(target.dataset.id)
  if (action === 'set-recharge-amount') {
    $('#recharge-amount').value = target.dataset.amount
    $$('.amount-presets button').forEach((button) => button.classList.toggle('active', button === target))
    return updateRechargePreview()
  }
  if (action === 'select-payment-method') {
    state.payment.selectedMethod = target.dataset.method
    $$('.payment-method').forEach((button) => button.classList.toggle('active', button === target))
    return updateRechargePreview()
  }
  if (action === 'verify-payment-order') {
    setBusy(target, true, '查询中')
    try {
      const order = await request('/payment/orders/verify', { method: 'POST', body: { out_trade_no: target.dataset.orderNo } })
      toast(`订单状态：${paymentStatusLabel(order.status)}`)
      return navigate('billing')
    } catch (error) {
      toast(error.message, 'error'); setBusy(target, false); return
    }
  }
  if (action === 'cancel-payment-order') {
    state.pendingPaymentOrderId = target.dataset.id
    return confirmModal('取消充值订单', '确定取消这笔尚未支付的订单？已经支付的订单不会被取消。', 'confirm-cancel-payment-order')
  }
  if (action === 'log-detail') return openLogDetail(target.dataset.id)
  if (action === 'use-provider-group') {
    return useProviderGroupModal(target.dataset.groupId, target.dataset.groupName, target.dataset.groupRate)
  }
  if (action === 'logs-prev') { state.logs.page = Math.max(1, state.logs.page - 1); return renderLogs() }
  if (action === 'logs-next') { state.logs.page += 1; return renderLogs() }
  if (action === 'reset-log-filters') { state.logs = { ...state.logs, page: 1, filters: {} }; return renderLogs() }
  if (action === 'refresh-providers') return renderProviders()
  if (action === 'new-client-profile') {
    await ensureClientKeys()
    return createClientProfileModal()
  }
  if (action === 'view-client-profile') {
    const profile = await ccRequest('getProfile', target.dataset.id)
    state.viewedClientProfile = profile
    const sections = Object.entries(profile.files || {}).map(([targetId, content]) => `<section class="profile-content-section"><div><strong>${escapeHTML(targetId)}</strong><button class="icon-button" data-action="copy-profile-target" data-target-id="${escapeHTML(targetId)}" title="复制配置" aria-label="复制配置"><i data-lucide="copy"></i></button></div><pre><code>${escapeHTML(content)}</code></pre></section>`).join('')
    openModal(profile.name, `<div class="profile-content-viewer">${sections || '<p class="muted">这个配置档没有文件内容。</p>'}</div>`, '<button class="primary-button" data-action="close-modal">完成</button>')
    return
  }
  if (action === 'activate-client-profile') {
    setBusy(target, true, '应用中')
    try {
      await ccRequest('switchProfile', { clientId: state.clientId, profileId: target.dataset.id })
      toast('配置已应用，原配置已备份')
      delete state.clientCache[state.clientId]
      await renderClients()
    } catch (error) {
      toast(error.message, 'error')
      setBusy(target, false)
    }
    return
  }
  if (action === 'delete-client-profile') {
    state.pendingClientProfileId = target.dataset.id
    return confirmModal('删除配置档', '只删除 AIHub Desktop 中保存的配置档，不会改动客户端当前配置。', 'confirm-delete-client-profile', true)
  }
  if (action === 'restore-client-backup') {
    setBusy(target, true, '恢复中')
    try {
      await ccRequest('restoreBackup', { clientId: state.clientId, backupId: target.dataset.id })
      toast('客户端配置已恢复')
      delete state.clientCache[state.clientId]
      await renderClients()
    } catch (error) {
      toast(error.message, 'error')
      setBusy(target, false)
    }
    return
  }
  if (action === 'export-logs') {
    setBusy(target, true, '导出中')
    try {
      const items = await loadLogsForExport(state.logs.filters)
      const result = await window.aihub.saveText({ filename: `aihub-usage-${new Date().toISOString().slice(0, 10)}.csv`, content: usageCSV(items) })
      if (result.ok) toast(`已导出 ${number(items.length)} 条记录`)
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(target, false)
    }
    return
  }
  if (action === 'open-aihub-ad') return window.aihub.openExternal('https://aihub.top')
  if (action === 'dismiss-aihub-ad') {
    target.closest('.official-ad')?.remove()
    return
  }
  if (action === 'create-key') return createKeyModal()
  if (action === 'edit-key') {
    const key = await request(`/keys/${target.dataset.id}`)
    return createKeyModal(key)
  }
  if (action === 'copy-key') {
    const key = state.keys.find((item) => String(item.id) === target.dataset.id)
    if (key?.key) { await window.aihub.copyText(key.key); toast('API Key 已复制') }
  }
  if (action === 'toggle-key') {
    const key = state.keys.find((item) => String(item.id) === target.dataset.id)
    if (!key) return
    await request(`/keys/${key.id}`, { method: 'PUT', body: { status: key.status === 'active' ? 'inactive' : 'active' } })
    toast(key.status === 'active' ? 'API Key 已停用' : 'API Key 已启用')
    navigate('keys')
  }
  if (action === 'delete-key') {
    target.dataset.pendingId = target.dataset.id
    state.pendingKeyId = target.dataset.id
    confirmModal('删除 API Key', '删除后使用该 Key 的客户端将立即无法调用，且操作不可恢复。', 'confirm-delete-key', true)
  }
  if (action === 'copy-affiliate') {
    await window.aihub.copyText($('#affiliate-link').value)
    toast('邀请链接已复制')
  }
  if (action === 'transfer-affiliate') {
    confirmModal('转入账户余额', '将当前可用返利全部转入账户余额？', 'confirm-transfer-affiliate')
  }
  if (action === 'revoke-sessions') {
    confirmModal('退出所有设备', '所有登录会话都会失效，你需要重新登录当前桌面端。', 'confirm-revoke-sessions', true)
  }
}

async function handleModalClick(event) {
  const markdownLink = event.target.closest('.announcement-markdown a')
  if (markdownLink) {
    event.preventDefault()
    const href = markdownLink.getAttribute('href') || ''
    try {
      const url = new URL(href, 'https://aihub.top')
      if (url.protocol === 'https:') await window.aihub.openExternal(url.href)
      else toast('仅允许打开 HTTPS 链接', 'error')
    } catch {
      toast('公告链接无效', 'error')
    }
    return
  }
  const target = event.target.closest('[data-action]')
  if (!target) return
  const action = target.dataset.action
  if (action === 'close-modal') {
    if (event.target.closest('.modal') && !event.target.closest('button[data-action="close-modal"]')) return
    return closeModal()
  }
  try {
    if (action === 'create-provider-key') {
      const groupId = state.providerTargetGroup?.id
      closeModal()
      state.preferredGroupId = groupId
      await navigate('keys')
      return createKeyModal()
    }
    if (action === 'switch-provider-key') {
      const form = $('#provider-key-switch-form')
      const keyId = Number(new FormData(form).get('key_id'))
      if (!keyId) throw new Error('请选择要切换的 API Key')
      setBusy(target, true, '切换中')
      await request(`/keys/${keyId}/group`, { method: 'PUT', body: { group_id: state.providerTargetGroup.id } })
      closeModal()
      toast(`API Key 已切换到“${state.providerTargetGroup.name}”`)
      return
    }
    if (action === 'fill-aihub-template') {
      const key = state.keys.find((item) => String(item.id) === $('#client-template-key')?.value)
      const isCodex = state.clientId.startsWith('codex')
      const model = $('#client-template-model')?.value.trim() || 'gpt-5.6-sol'
      if (!key?.key) throw new Error('请选择可用的 API Key')
      if (isCodex && !model) throw new Error('请输入模型名称')
      const nameInput = $('#client-profile-form [name="name"]')
      if (!nameInput.value.trim()) nameInput.value = `AIHub · ${isCodex ? model : 'OpenCode'}`
      const providerId = isCodex ? ($('#client-template-provider').value.trim() || 'OpenAI') : 'OpenAI'
      const files = buildAIHubClientFiles(state.clientId, key.key, model, nameInput.value, providerId)
      Object.entries(files).forEach(([targetId, content]) => {
        const editor = $(`[data-config-target="${targetId}"]`, $('#client-profile-form'))
        if (editor) editor.value = content
      })
      toast('AIHub 配置已生成，请检查后保存')
    }
    if (action === 'open-payment-page') {
      const url = state.payment.activeOrder?.launchUrl
      if (url) await window.aihub.openExternal(url)
    }
    if (action === 'verify-active-payment') {
      setBusy(target, true, '查询中')
      await pollActivePayment(true)
      setBusy(target, false)
    }
    if (action === 'cancel-active-payment') {
      setBusy(target, true, '取消中')
      await request(`/payment/orders/${state.payment.activeOrder.order_id}/cancel`, { method: 'POST' })
      await pollActivePayment(false)
    }
    if (action === 'finish-payment') { closeModal(); toast('余额与订单已更新'); await navigate('billing') }
    if (action === 'confirm-cancel-payment-order') {
      setBusy(target, true, '取消中')
      await request(`/payment/orders/${state.pendingPaymentOrderId}/cancel`, { method: 'POST' })
      closeModal(); toast('订单已取消'); await navigate('billing')
    }
    if (action === 'submit-create-key') {
      const form = $('#create-key-form')
      if (!form.reportValidity()) return
      const values = Object.fromEntries(new FormData(form))
      const groupId = Number(values.group_id) || null
      const body = {
        name: values.name.trim(),
        max_rate_multiplier: Math.max(0, Number(values.max_rate_multiplier || 0)),
        ...keyFailoverPayload(form, groupId),
      }
      if (groupId) body.group_id = groupId
      if (Number(values.quota) > 0) body.quota = Number(values.quota)
      if (Number(values.expires_in_days) > 0) body.expires_in_days = Number(values.expires_in_days)
      setBusy(target, true, '创建中')
      const key = await request('/keys', { method: 'POST', body })
      openModal('API Key 已创建', `<div class="secret-output"><span class="muted">请妥善保存</span><code id="created-key">${escapeHTML(key.key)}</code><button class="secondary-button" data-action="copy-created-key"><i data-lucide="copy"></i>复制 Key</button></div><p class="muted" style="font-size:12px;line-height:1.5">关闭后仍可在 Key 列表查看脱敏信息。</p>`, '<button class="primary-button" data-action="finish-create-key">完成</button>')
    }
    if (action === 'submit-update-key') {
      const form = $('#create-key-form')
      if (!form.reportValidity()) return
      const data = new FormData(form)
      const groupId = Number(data.get('group_id')) || null
      const body = {
        name: String(data.get('name')).trim(), group_id: groupId, quota: Math.max(0, Number(data.get('quota') || 0)),
        max_rate_multiplier: Math.max(0, Number(data.get('max_rate_multiplier') || 0)),
        ...keyFailoverPayload(form, groupId),
      }
      setBusy(target, true, '保存中')
      await request(`/keys/${state.editingKeyId}`, { method: 'PUT', body })
      closeModal(); toast('API Key 策略已更新'); await navigate('keys')
    }
    if (action === 'copy-created-key') {
      await window.aihub.copyText($('#created-key').textContent)
      toast('API Key 已复制')
    }
    if (action === 'copy-profile-target') {
      const content = state.viewedClientProfile?.files?.[target.dataset.targetId]
      if (typeof content === 'string') { await window.aihub.copyText(content); toast('配置内容已复制') }
    }
    if (action === 'finish-create-key') { closeModal(); navigate('keys') }
    if (action === 'confirm-delete-key') {
      setBusy(target, true, '删除中')
      await request(`/keys/${state.pendingKeyId}`, { method: 'DELETE' })
      closeModal(); toast('API Key 已删除'); navigate('keys')
    }
    if (action === 'submit-client-profile') {
      const form = $('#client-profile-form')
      if (!form.reportValidity()) return
      const files = {}
      form.querySelectorAll('[data-config-target]').forEach((editor) => {
        if (editor.value.trim()) files[editor.dataset.configTarget] = editor.value
      })
      if (!Object.keys(files).length) throw new Error('至少填写一个配置文件')
      setBusy(target, true, '保存中')
      await ccRequest('upsertProfile', {
        clientId: state.clientId,
        name: new FormData(form).get('name').trim(),
        files,
      })
      closeModal(); toast('配置档已保存'); delete state.clientCache[state.clientId]; await renderClients()
    }
    if (action === 'confirm-delete-client-profile') {
      setBusy(target, true, '删除中')
      await ccRequest('deleteProfile', state.pendingClientProfileId)
      closeModal(); toast('配置档已删除'); delete state.clientCache[state.clientId]; await renderClients()
    }
    if (action === 'confirm-transfer-affiliate') {
      setBusy(target, true, '转入中')
      await request('/user/aff/transfer', { method: 'POST', body: {} })
      closeModal(); toast('返利已转入余额'); navigate('affiliate')
    }
    if (action === 'confirm-revoke-sessions') {
      setBusy(target, true, '处理中')
      await request('/auth/revoke-all-sessions', { method: 'POST', body: {} })
      await window.aihub.logout()
      closeModal(); showLogin(); toast('所有会话已撤销')
    }
    if (action === 'submit-2fa') {
      const form = $('#two-factor-form')
      if (!form.reportValidity()) return
      setBusy(target, true, '验证中')
      const code = new FormData(form).get('totp_code')
      const result = await window.aihub.login2FA({ temp_token: state.tempToken, totp_code: code })
      if (!result.ok) throw new Error(result.error?.message || '验证码无效')
      closeModal(); showApp(result.user)
    }
  } catch (error) {
    toast(error.message, 'error')
    setBusy(target, false)
  }
}

async function handleContentSubmit(event) {
  event.preventDefault()
  const form = event.target
  const button = form.querySelector('button[type="submit"]')
  try {
    setBusy(button, true)
    if (form.id === 'log-filter-form') {
      const values = Object.fromEntries(new FormData(form))
      state.logs.page = 1
      state.logs.filters = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''))
      await renderLogs()
      return
    }
    if (form.id === 'redeem-form') {
      const code = new FormData(form).get('code').trim()
      await request('/redeem', { method: 'POST', body: { code } })
      toast('兑换成功'); navigate('redeem')
    }
    if (form.id === 'recharge-form') {
      updateRechargePreview()
      if ($('#recharge-error') && !$('#recharge-error').classList.contains('hidden')) return
      const amount = Number(new FormData(form).get('amount'))
      const method = state.payment.selectedMethod
      const order = await request('/payment/orders', {
        method: 'POST',
        body: { amount, payment_type: method, order_type: 'balance', return_url: 'https://aihub.top/payment/result', payment_source: 'hosted_redirect', is_mobile: false },
      })
      showPaymentOrder({ ...order, paymentType: method })
      return
    }
    if (form.id === 'invoice-application-form') {
      const data = new FormData(form)
      const email = normalizeInvoiceEmails(data.get('email'))
      if (!email) throw new Error('请输入有效的收票邮箱，多个邮箱可用逗号、分号或空格分隔')
      await request('/invoices', {
        method: 'POST',
        body: {
          payment_order_id: Number(data.get('payment_order_id')),
          company_title: String(data.get('company_title')).trim(),
          tax_number: String(data.get('tax_number')).trim(),
          email,
        },
      })
      toast('发票申请已提交')
      await navigate('invoices')
      return
    }
    if (form.id === 'profile-form') {
      const username = new FormData(form).get('username').trim()
      const profile = await request('/user', { method: 'PUT', body: { username } })
      state.user = profile; toast('资料已保存'); navigate('account')
    }
    if (form.id === 'password-form') {
      const values = Object.fromEntries(new FormData(form))
      await request('/user/password', { method: 'PUT', body: values })
      form.reset(); toast('密码已修改')
    }
  } catch (error) {
    toast(error.message, 'error')
  } finally {
    setBusy(button, false)
  }
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const form = event.currentTarget
  const button = form.querySelector('button[type="submit"]')
  const errorNode = $('#login-error')
  errorNode.classList.add('hidden')
  setBusy(button, true, '登录中')
  const result = await window.aihub.login({
    email: $('#login-email').value.trim(),
    password: $('#login-password').value,
    rememberAccount: $('#remember-account').checked,
  })
  $('#login-password').value = ''
  setBusy(button, false)
  if (!result.ok) {
    if (result.requires2FA) {
      openModal('两步验证', `<form id="two-factor-form"><label><span>6 位验证码</span><input name="totp_code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required /></label></form>`, '<button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="submit-2fa">验证</button>')
      state.tempToken = result.tempToken
      return
    }
    errorNode.textContent = result.error?.message || '登录失败'
    errorNode.classList.remove('hidden')
    return
  }
  showApp(result.user)
})

$('#toggle-password').addEventListener('click', () => {
  const input = $('#login-password')
  input.type = input.type === 'password' ? 'text' : 'password'
  $('#toggle-password').innerHTML = `<i data-lucide="${input.type === 'password' ? 'eye' : 'eye-off'}"></i>`
  icons($('#toggle-password'))
})

$('#sidebar-nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-route]')
  if (button) navigate(button.dataset.route)
})
$('#content').addEventListener('click', handleContentClick)
$('#content').addEventListener('submit', handleContentSubmit)
$('#content').addEventListener('input', (event) => {
  if (event.target.id === 'recharge-amount') updateRechargePreview()
})
$('#modal-root').addEventListener('click', handleModalClick)
$('#modal-root').addEventListener('change', (event) => {
  if (event.target.closest('#create-key-form')) syncKeyPolicyForm()
})
$('#refresh-page').addEventListener('click', () => navigate(state.route))
$('#theme-toggle').addEventListener('click', () => {
  const dark = document.documentElement.classList.toggle('dark')
  localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light')
  syncThemeControl()
  if (state.route === 'dashboard' || state.route === 'usage' || state.route === 'providers') navigate(state.route)
})
$('#account-menu').addEventListener('click', () => navigate('account'))
$('#open-site').addEventListener('click', () => window.aihub.openExternal('https://aihub.top'))
$('#logout-button').addEventListener('click', async () => {
  await window.aihub.logout()
  showLogin()
  toast('已退出当前设备')
})

const bubble = $('#info-bubble')
function showBubble(target) {
  const text = target.dataset.bubble
  if (!text) return
  bubble.textContent = text
  bubble.classList.add('visible')
  const rect = target.getBoundingClientRect()
  const bubbleRect = bubble.getBoundingClientRect()
  const left = Math.min(window.innerWidth - bubbleRect.width - 12, Math.max(12, rect.left + rect.width / 2 - bubbleRect.width / 2))
  const preferTop = rect.top > bubbleRect.height + 18
  const top = preferTop ? rect.top - bubbleRect.height - 9 : rect.bottom + 9
  bubble.style.left = `${left}px`
  bubble.style.top = `${top}px`
}
function hideBubble() { bubble.classList.remove('visible') }
$('#content').addEventListener('mouseover', (event) => {
  const target = event.target.closest('[data-bubble]')
  if (target) showBubble(target)
})
$('#content').addEventListener('mouseout', (event) => {
  if (event.target.closest('[data-bubble]')) hideBubble()
})
$('#content').addEventListener('focusin', (event) => {
  const target = event.target.closest('[data-bubble]')
  if (target) showBubble(target)
})
$('#content').addEventListener('focusout', hideBubble)
$('#content').addEventListener('scroll', hideBubble, { passive: true })

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal()
  if (event.ctrlKey && event.key.toLowerCase() === 'r') { event.preventDefault(); navigate(state.route) }
})

async function boot() {
  icons()
  syncThemeControl()
  await loadRememberedAccount()
  const restored = await window.aihub.restore()
  if (restored.ok) showApp(restored.user)
  else showLogin()
}

boot()
