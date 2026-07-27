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
  keyList: { page: 1, pageSize: 20, search: '', groupId: '', status: '', columns: { concurrency: true, todayUsage: true, monthUsage: true, expiresAt: true } },
  clientSelectedKeyId: null,
  groups: [],
  guidePlatform: 'windows',
  usagePeriod: 'month',
  usageAnalytics: {
    page: 1,
    pageSize: 30,
    startDate: '',
    endDate: '',
    granularity: 'day',
    filters: { api_key_id: '', model: '', group_id: '', request_type: '', billing_type: '', billing_mode: '' },
  },
  usageItems: [],
  usageRegions: Object.create(null),
  dashboardChart: null,
  logs: { page: 1, pageSize: 20, mode: 'usage', filters: {} },
  invoices: { eligiblePage: 1, applicationsPage: 1, pageSize: 20, eligibleOrders: [] },
  providerWindow: '6h',
  providerSort: 'availability',
  providerMetric: 'first_token',
  providerSummary: null,
  providerSeries: Object.create(null),
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
  orders: { page: 1, pageSize: 20, status: '' },
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

function canApplyForInvoice(order) {
  return order?.eligible === true && order?.applied !== true
}

function invoiceOrderReason(order) {
  const rawReason = ['eligibility_reason', 'ineligible_reason', 'reason', 'message']
    .map((field) => order?.[field])
    .find((value) => value !== null && value !== undefined && String(value).trim() !== '')
  if (String(rawReason) === 'amount_below_300') return '金额不足 300'
  return rawReason === undefined ? '暂不符合申请条件' : String(rawReason).trim()
}

function invoiceOrderState(order) {
  if (order?.applied === true) return ['applied', '已申请']
  if (order?.eligible === true) return ['eligible', '申请开票']
  return ['ineligible', invoiceOrderReason(order)]
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
  const range = { start_date: snapshot?.start_date || '', end_date: snapshot?.end_date || '' }
  const [modelsResult, recentResult] = await Promise.allSettled([
    request(`/usage/dashboard/models?${queryString(range)}`),
    request(`/usage?${queryString({ ...range, page: 1, page_size: 100, sort_by: 'created_at', sort_order: 'desc' })}`),
  ])
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
  const platformRows = (stats.by_platform || []).map((item) => `<div class="dashboard-breakdown-row"><strong>${escapeHTML(item.platform || '-')}</strong><span>${money(item.total_actual_cost)}</span><span>${number(item.total_requests)} 次</span><span>${compactNumber(item.total_tokens)} Token</span></div>`).join('')
  const modelRows = modelsResult.status === 'fulfilled' ? (modelsResult.value?.models || modelsResult.value?.items || []).slice(0, 8).map((item) => `<div class="dashboard-breakdown-row"><strong>${escapeHTML(item.model || '-')}</strong><span>${money(item.actual_cost ?? item.total_actual_cost)}</span><span>${number(item.requests ?? item.total_requests)} 次</span><span>${compactNumber(item.total_tokens)} Token</span></div>`).join('') : ''
  const recentRows = recentResult.status === 'fulfilled' ? paginated(recentResult.value).items.slice(0, 5).map((item) => `<div class="dashboard-recent-row"><strong>${escapeHTML(item.model || '-')}</strong><span>${number(Number(item.input_tokens || 0) + Number(item.output_tokens || 0))} Token</span><span>${money(item.actual_cost)}</span><time>${escapeHTML(dateTime(item.created_at))}</time></div>`).join('') : ''
  const localUnavailable = (message) => `<div class="usage-section-error"><i data-lucide="circle-alert"></i><span>${escapeHTML(message || '暂不可用')}</span></div>`

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
    <section class="dashboard-parity-grid">
      <section class="panel"><div class="panel-header"><h2>按平台拆分</h2></div><div class="panel-body dashboard-breakdown">${platformRows || '<span class="muted">暂无平台数据</span>'}</div></section>
      <section class="panel"><div class="panel-header"><h2>模型分布</h2></div><div class="panel-body dashboard-breakdown">${modelsResult.status === 'fulfilled' ? (modelRows || '<span class="muted">暂无模型数据</span>') : localUnavailable(modelsResult.reason?.message)}</div></section>
      <section class="panel"><div class="panel-header"><h2>最近使用</h2></div><div class="panel-body dashboard-breakdown">${recentResult.status === 'fulfilled' ? (recentRows || '<span class="muted">暂无使用记录</span>') : localUnavailable(recentResult.reason?.message)}</div></section>
    </section>
    <section class="panel dashboard-quick-actions"><div class="panel-header"><h2>快捷操作</h2></div><div class="panel-body"><button class="secondary-button" data-dashboard-route="keys"><i data-lucide="key-round"></i>创建 API Key</button><button class="secondary-button" data-dashboard-route="usage"><i data-lucide="chart-no-axes-combined"></i>查看用量</button><button class="secondary-button" data-dashboard-route="failover"><i data-lucide="git-branch"></i>故障转移日志</button><button class="secondary-button" data-dashboard-route="redeem"><i data-lucide="ticket-check"></i>兑换码</button></div></section>
    <section class="panel"><div class="panel-header"><div><h2>站点公告</h2><p>来自 AIHub 的最新消息</p></div></div><div class="panel-body announcement-list">${notices}</div></section>
  </div>`
  icons($('#content'))
  renderDashboardChart(chartPoints)
}

function keyListQuery() {
  const list = state.keyList
  const query = new URLSearchParams({ page: String(list.page), page_size: String(list.pageSize), sort_by: 'created_at', sort_order: 'desc' })
  if (list.search) query.set('search', list.search)
  if (list.groupId) query.set('group_id', list.groupId)
  if (list.status) query.set('status', list.status)
  return query.toString()
}

function keyListPagination(total, pages) {
  const page = state.keyList.page
  return `<div class="pagination-bar"><span>共 ${number(total)} 条 · 每页 ${number(state.keyList.pageSize)} 条</span><div class="pagination-controls"><button class="icon-button" data-action="keys-prev" title="上一页" aria-label="上一页" ${page <= 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i></button><strong>${page} / ${Math.max(1, pages)}</strong><button class="icon-button" data-action="keys-next" title="下一页" aria-label="下一页" ${page >= Math.max(1, pages) ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button></div></div>`
}

async function renderKeys() {
  const [keysData, groupsData] = await Promise.all([
    request(`/keys?${keyListQuery()}`),
    request('/groups/available'),
  ])
  const keys = paginated(keysData)
  state.keys = keys.items
  state.groups = Array.isArray(groupsData) ? groupsData : groupsData?.groups || groupsData?.items || []
  const visible = state.keyList.columns
  const optionalHeaders = [
    ['concurrency', '并发'], ['todayUsage', '今日用量'], ['monthUsage', '30 天用量'], ['expiresAt', '到期时间'],
  ].filter(([name]) => visible[name]).map(([, label]) => `<th>${label}</th>`).join('')
  const rows = keys.items.map((key) => {
    const optionalCells = [
      visible.concurrency ? `<td>${number(key.current_concurrency ?? key.concurrency)}</td>` : '',
      visible.todayUsage ? `<td>${money(key.today_usage ?? key.today_actual_cost)}</td>` : '',
      visible.monthUsage ? `<td>${money(key.usage_30d ?? key.month_usage ?? key.actual_cost_30d)}</td>` : '',
      visible.expiresAt ? `<td>${escapeHTML(dateTime(key.expires_at))}</td>` : '',
    ].join('')
    return `<tr><td><div class="cell-title"><strong>${escapeHTML(key.name || '未命名 Key')}</strong><span>${escapeHTML(key.key ? `${key.key.slice(0, 8)}...${key.key.slice(-4)}` : `ID ${key.id}`)}</span></div></td><td><span class="status-badge ${escapeHTML(key.status)}">${escapeHTML(key.status)}</span></td><td>${escapeHTML(key.group?.name || '默认分组')}</td><td>${key.quota > 0 ? `${money(key.quota_used)} / ${money(key.quota)}` : '不限额'}</td>${optionalCells}<td>${escapeHTML(dateTime(key.last_used_at))}</td><td><div class="row-actions">${key.key ? `<button class="icon-button" data-action="copy-key" data-id="${key.id}" title="复制 Key" aria-label="复制 Key"><i data-lucide="copy"></i></button>` : ''}<button class="icon-button" data-action="configure-client-key" data-id="${key.id}" title="配置客户端" aria-label="配置客户端"><i data-lucide="monitor-cog"></i></button><button class="icon-button" data-action="edit-key" data-id="${key.id}" title="编辑策略" aria-label="编辑策略"><i data-lucide="settings-2"></i></button><button class="icon-button" data-action="toggle-key" data-id="${key.id}" title="${key.status === 'active' ? '停用' : '启用'}" aria-label="切换状态"><i data-lucide="${key.status === 'active' ? 'pause' : 'play'}"></i></button><button class="icon-button" data-action="delete-key" data-id="${key.id}" title="删除 Key" aria-label="删除 Key"><i data-lucide="trash-2"></i></button></div></td></tr>`
  }).join('')
  const groupOptions = state.groups.map((group) => `<option value="${escapeHTML(group.id)}" ${String(state.keyList.groupId) === String(group.id) ? 'selected' : ''}>${escapeHTML(group.name)}</option>`).join('')
  const columnToggles = [['concurrency', '并发'], ['todayUsage', '今日用量'], ['monthUsage', '30 天用量'], ['expiresAt', '到期时间']].map(([name, label]) => `<label class="key-column-toggle"><input type="checkbox" data-key-column="${name}" ${visible[name] ? 'checked' : ''} />${label}</label>`).join('')
  $('#content').innerHTML = `<div class="page-stack"><div class="page-toolbar"><div class="toolbar-copy"><h2>你的访问凭据</h2><p>管理调用权限、限额与故障转移策略。</p></div><button class="primary-button" data-action="create-key"><i data-lucide="plus"></i>新建 Key</button></div><section class="panel key-list-panel"><form id="key-list-filters" class="key-list-filters"><input name="key-search" value="${escapeHTML(state.keyList.search)}" placeholder="搜索 Key 名称" /><select name="key-group-filter"><option value="">全部分组</option>${groupOptions}</select><select name="key-status-filter"><option value="">全部状态</option><option value="active" ${state.keyList.status === 'active' ? 'selected' : ''}>active</option><option value="inactive" ${state.keyList.status === 'inactive' ? 'selected' : ''}>inactive</option></select><select name="key-page-size"><option value="20" ${state.keyList.pageSize === 20 ? 'selected' : ''}>20 / 页</option><option value="50" ${state.keyList.pageSize === 50 ? 'selected' : ''}>50 / 页</option><option value="100" ${state.keyList.pageSize === 100 ? 'selected' : ''}>100 / 页</option></select><button type="button" class="secondary-button" data-action="key-apply-filters"><i data-lucide="search"></i>筛选</button></form><div class="key-list-tools"><div class="key-column-toggles">${columnToggles}</div><div class="key-endpoints"><a data-key-endpoint href="https://aihub.top/v1" target="_blank" rel="noreferrer">默认 API</a><button class="icon-button" data-action="copy-key-endpoint" data-endpoint="https://aihub.top/v1" title="复制默认 API" aria-label="复制默认 API"><i data-lucide="copy"></i></button><a data-key-endpoint href="https://aihub.top/v1/images/generations" target="_blank" rel="noreferrer">图片 API</a><button class="icon-button" data-action="copy-key-endpoint" data-endpoint="https://aihub.top/v1/images/generations" title="复制图片 API" aria-label="复制图片 API"><i data-lucide="copy"></i></button><button class="icon-button" data-action="test-key-endpoint" data-endpoint="https://aihub.top/v1" title="测速" aria-label="测速"><i data-lucide="gauge"></i></button></div></div>${rows ? `<div class="data-table-wrap"><table class="data-table key-list-table"><thead><tr><th>名称</th><th>状态</th><th>分组</th><th>额度</th>${optionalHeaders}<th>最后使用</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('key-round', '还没有 API Key', '创建一个 Key 后即可连接客户端。', '<button class="primary-button" data-action="create-key"><i data-lucide="plus"></i>新建 Key</button>')}${keyListPagination(keys.total, keys.pages)}</section></div>`
  $$('[data-action="configure-client-key"]', $('#content')).forEach((button) => {
    const key = state.keys.find((item) => String(item.id) === button.dataset.id)
    if (key?.status !== 'active') button.remove()
  })
  icons($('#content'))
}

function usageFilterParams(usageState = state.usageAnalytics) {
  return {
    start_date: usageState.startDate,
    end_date: usageState.endDate,
    ...usageState.filters,
  }
}

function usageOverviewQuery(usageState = state.usageAnalytics) {
  return queryString({ ...usageFilterParams(usageState), granularity: usageState.granularity })
}

function usageDetailQuery(usageState = state.usageAnalytics, page = usageState.page, pageSize = usageState.pageSize) {
  return queryString({ page, page_size: pageSize, ...usageFilterParams(usageState), sort_by: 'created_at', sort_order: 'desc' })
}

function usageDistribution(title, items, labelField) {
  if (!items?.length) return `<section class="panel usage-distribution"><div class="panel-header"><h2>${escapeHTML(title)}</h2></div>${empty('chart-no-axes-column', '暂无数据', '所选范围内没有可展示的数据。')}</section>`
  const rows = items.slice(0, 8).map((item) => `<div class="usage-distribution-row"><strong>${escapeHTML(item[labelField] || item.name || '-')}</strong><span>${number(item.total_tokens ?? item.tokens)} Token</span><span>${number(item.total_requests ?? item.requests)} 次</span><span>${money(item.total_actual_cost ?? item.actual_cost)}</span></div>`).join('')
  return `<section class="panel usage-distribution"><div class="panel-header"><h2>${escapeHTML(title)}</h2></div><div class="panel-body">${rows}</div></section>`
}

function usageSectionError(title, message) {
  return `<section class="panel usage-distribution"><div class="panel-header"><h2>${escapeHTML(title)}</h2></div><div class="panel-body usage-section-error"><i data-lucide="circle-alert"></i><span>${escapeHTML(message || '暂不可用')}</span></div></section>`
}

function usageRegionText(ip) {
  const region = state.usageRegions[String(ip || '')]
  if (!ip) return '-'
  if (region?.status === 'private') return '内网地址'
  if (region?.status === 'error') return '查询失败'
  if (region?.status === 'success') return [region.country_code, region.region, region.city].filter(Boolean).join(' · ')
  return '未查询'
}

async function renderUsage() {
  const analytics = state.usageAnalytics
  const overviewQuery = usageOverviewQuery(analytics)
  const referenceLoads = []
  if (!state.keys.length) referenceLoads.push(request('/keys?page=1&page_size=100').then((data) => { state.keys = paginated(data).items }))
  if (!state.groups.length) referenceLoads.push(request('/groups/available').then((data) => { state.groups = Array.isArray(data) ? data : data?.items || data?.groups || [] }))
  if (referenceLoads.length) await Promise.allSettled(referenceLoads)
  const [stats, logs] = await Promise.all([
    request(`/usage/stats?${overviewQuery}`),
    request(`/usage?${usageDetailQuery(analytics)}`),
  ])
  const [snapshotResult, modelsResult] = await Promise.allSettled([
    request(`/usage/dashboard/snapshot-v2?${queryString({ ...usageFilterParams(analytics), granularity: analytics.granularity, include_trend: true, include_model_stats: false, include_group_stats: true })}`),
    request(`/usage/dashboard/models?${queryString({ ...usageFilterParams(analytics), model_source: 'requested' })}`),
  ])
  const page = paginated(logs)
  const items = page.items
  state.usageItems = items
  const cacheReadTokens = Number(stats.cache_read_tokens ?? stats.total_cache_read_tokens ?? 0)
  const cacheCreationTokens = Number(stats.cache_creation_tokens ?? stats.total_cache_creation_tokens ?? 0)
  const rows = items.map((item) => `<tr data-action="usage-detail" data-id="${escapeHTML(item.id)}" class="usage-detail-row">
    <td style="width:18%"><div class="cell-title"><strong>${escapeHTML(item.model || '未知模型')}</strong><span>${escapeHTML(item.request_id || '')}</span></div></td>
    <td style="width:13%">${escapeHTML(item.api_key?.name || `Key #${item.api_key_id}`)}</td>
    <td style="width:12%"><div class="cell-title"><strong>${number(Number(item.input_tokens || 0) + Number(item.output_tokens || 0))}</strong><span>入 ${number(item.input_tokens)} · 出 ${number(item.output_tokens)}</span></div></td>
    <td style="width:14%"><div class="cell-title"><strong>${number(Number(item.cache_read_tokens || 0) + Number(item.cache_creation_tokens || 0))}</strong><span>读 ${number(item.cache_read_tokens)} · 写 ${number(item.cache_creation_tokens)}</span></div></td>
    <td style="width:11%">${money(item.actual_cost)}</td>
    <td style="width:11%">${item.duration_ms == null ? '-' : `${number(item.duration_ms)} ms`}</td>
    <td style="width:9%">${escapeHTML(item.inbound_endpoint || item.request_type || (item.stream ? '流式' : '非流式'))}</td>
    <td><div class="cell-title"><strong>${escapeHTML(item.client_ip || '-')}</strong><span class="usage-region-value" data-ip="${escapeHTML(item.client_ip || '')}">${escapeHTML(usageRegionText(item.client_ip))}</span></div></td>
    <td style="width:12%">${escapeHTML(dateTime(item.created_at))}</td>
  </tr>`).join('')
  const modelSection = modelsResult.status === 'fulfilled'
    ? usageDistribution('模型分布', modelsResult.value?.models || modelsResult.value?.items || [], 'model')
    : usageSectionError('模型分布', modelsResult.reason?.message)
  const snapshot = snapshotResult.status === 'fulfilled' ? snapshotResult.value : null
  const groupSection = snapshot ? usageDistribution('分组使用分布', snapshot.groups || [], 'name') : usageSectionError('分组使用分布', snapshotResult.reason?.message)
  const endpointSection = usageDistribution('端点分布', stats.endpoints || [], 'inbound_endpoint')
  const trendRows = (snapshot?.trend || []).map((item) => `<div class="usage-trend-row"><strong>${escapeHTML(item.date || item.time || '-')}</strong><span>输入 ${number(item.input_tokens)}</span><span>输出 ${number(item.output_tokens)}</span><span>${money(item.actual_cost)}</span></div>`).join('')
  const trendSection = snapshot ? `<section class="panel usage-trend"><div class="panel-header"><div><h2>Token 使用趋势</h2><p>按${analytics.granularity === 'hour' ? '小时' : '天'}聚合</p></div></div><div class="panel-body">${trendRows || '<span class="muted">暂无趋势数据</span>'}</div></section>` : usageSectionError('Token 使用趋势', snapshotResult.reason?.message)
  const usagePagination = `<div class="pagination-bar"><span>共 ${number(page.total)} 条 · 每页 ${number(analytics.pageSize)} 条</span><div class="pagination-controls"><button class="icon-button" data-action="usage-prev" aria-label="上一页" ${analytics.page <= 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i></button><strong>${number(analytics.page)} / ${number(page.pages || 1)}</strong><button class="icon-button" data-action="usage-next" aria-label="下一页" ${analytics.page >= (page.pages || 1) ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button></div></div>`
  const keyOptions = state.keys.map((key) => `<option value="${escapeHTML(key.id)}" ${String(analytics.filters.api_key_id) === String(key.id) ? 'selected' : ''}>${escapeHTML(key.name)}</option>`).join('')
  const groupOptions = state.groups.map((group) => `<option value="${escapeHTML(group.id)}" ${String(analytics.filters.group_id) === String(group.id) ? 'selected' : ''}>${escapeHTML(group.name)}</option>`).join('')
  $('#content').innerHTML = `<div class="page-stack">
    <div class="page-toolbar"><div class="toolbar-copy"><h2>调用与消费</h2><p>仅显示你自己的调用记录。</p></div><div class="button-row"><button class="secondary-button" data-action="usage-region-refresh-all"><i data-lucide="map-pin"></i>刷新地区</button><button class="secondary-button" data-action="export-usage"><i data-lucide="download"></i>导出 CSV</button></div></div>
    <section class="panel"><form id="usage-analytics-filter" class="filter-panel usage-analytics-filter">
      <label><span>开始日期</span><input name="start_date" type="date" value="${escapeHTML(analytics.startDate)}" /></label><label><span>结束日期</span><input name="end_date" type="date" value="${escapeHTML(analytics.endDate)}" /></label>
      <label><span>粒度</span><select name="granularity"><option value="day" ${analytics.granularity === 'day' ? 'selected' : ''}>天</option><option value="hour" ${analytics.granularity === 'hour' ? 'selected' : ''}>小时</option></select></label>
      <label><span>API Key</span><select name="api_key_id"><option value="">全部</option>${keyOptions}</select></label><label><span>模型</span><input name="model" value="${escapeHTML(analytics.filters.model)}" /></label>
      <label><span>分组</span><select name="group_id"><option value="">全部</option>${groupOptions}</select></label><label><span>请求类型</span><select name="request_type"><option value="">全部</option><option value="responses" ${analytics.filters.request_type === 'responses' ? 'selected' : ''}>responses</option><option value="chat" ${analytics.filters.request_type === 'chat' ? 'selected' : ''}>chat</option></select></label>
      <label><span>计费类型</span><select name="billing_type"><option value="">全部</option><option value="payg" ${analytics.filters.billing_type === 'payg' ? 'selected' : ''}>payg</option></select></label><label><span>计费模式</span><select name="billing_mode"><option value="">全部</option><option value="actual" ${analytics.filters.billing_mode === 'actual' ? 'selected' : ''}>actual</option></select></label>
      <div class="button-row usage-filter-actions"><button type="submit" class="primary-button"><i data-lucide="list-filter"></i>应用筛选</button></div>
    </form></section>
    <div class="metrics-grid usage-metrics">
      ${metric('实际消费', money(stats.actual_cost ?? stats.total_actual_cost), '所选周期', 'circle-dollar-sign')}
      ${metric('请求数', number(stats.requests ?? stats.total_requests), '全部模型', 'send', 'green')}
      ${metric('输入 Token', number(stats.input_tokens ?? stats.total_input_tokens), '提示与上下文', 'arrow-down-to-line', 'amber')}
      ${metric('输出 Token', number(stats.output_tokens ?? stats.total_output_tokens), '模型生成', 'arrow-up-from-line', 'dark')}
      ${metric('缓存 Token', number(cacheReadTokens + cacheCreationTokens), `读取 ${number(cacheReadTokens)} · 写入 ${number(cacheCreationTokens)}`, 'database-zap', 'green')}
    </div>
    <section class="usage-distribution-grid">${modelSection}${groupSection}${endpointSection}</section>
    ${trendSection}
    <section class="panel"><div class="panel-header"><div><h2>最近调用</h2><p>${number(page.total)} 条记录 · 标准成本 ${money(stats.standard_cost ?? stats.original_cost)}</p></div></div>${rows ? `<div class="data-table-wrap"><table class="data-table usage-detail-table"><thead><tr><th>模型</th><th>API Key</th><th>输入 / 输出</th><th>缓存读 / 写</th><th>消费</th><th>耗时</th><th>端点</th><th>IP / 地区</th><th>时间</th></tr></thead><tbody>${rows}</tbody></table></div>${usagePagination}` : empty('activity', '暂无调用记录', '使用 API Key 发起请求后会显示在这里。')}</section>
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
  if (value === null || value === undefined || value === '') return '-'
  const raw = String(value)
  return Object.hasOwn(labels, raw) ? labels[raw] : raw
}

function failoverProbeLabel(value) {
  if (value === true) return '主动探测'
  if (value === false) return '常规转移'
  return String(value || '-')
}

function failoverSummary(item) {
  const strategyLabels = { manual: '按我选择的分组顺序', lowest_rate: '按最低倍率优先', fastest: '按最快首字优先' }
  const recoveryLabels = { sticky: '自然回切（推荐）', prefer_primary: '积极回主', manual_only: '不自动回切' }
  const reasonLabels = { upstream_503: '上游返回 503', timeout: '请求超时', unavailable: '分组不可用' }
  const healthLabels = { unavailable: '健康异常' }
  const sourceGroup = item.source_group_name || item.source_group?.name || item.source_group_id || '-'
  const targetGroup = item.target_group_name || item.target_group?.name || item.target_group_id || '-'
  return {
    apiKey: item.api_key_name || item.api_key?.name || `Key #${item.api_key_id}`,
    model: item.model || '-',
    groupSwitch: `${sourceGroup} → ${targetGroup}`,
    multiplierChange: `${number(item.source_multiplier, 2)} → ${number(item.target_multiplier, 2)}`,
    reason: failoverLabel(item.reason, reasonLabels),
    strategy: failoverLabel(item.strategy, strategyLabels),
    recoveryMode: failoverLabel(item.recovery_mode, recoveryLabels),
    health: failoverLabel(item.health_class, healthLabels),
    probe: failoverProbeLabel(item.health_probe),
    status: item.upstream_status_code ?? '-',
    time: dateTime(item.created_at),
  }
}

function failoverRows(items) {
  return items.map((item) => {
    const summary = failoverSummary(item)
    return `<tr class="failover-log-row" data-action="log-detail" data-id="${escapeHTML(item.id)}" tabindex="0">
      <td data-label="API 密钥"><div class="cell-title"><strong>${escapeHTML(summary.apiKey)}</strong><span>${escapeHTML(`Key #${item.api_key_id || '-'}`)}</span></div></td>
      <td data-label="模型">${escapeHTML(summary.model)}</td>
      <td data-label="分组切换">${escapeHTML(summary.groupSwitch)}</td>
      <td data-label="倍率变化">${escapeHTML(summary.multiplierChange)}</td>
      <td data-label="切换原因"><div class="failover-reason"><strong>${escapeHTML(summary.reason)}</strong><span>${escapeHTML(`策略：${summary.strategy} · 恢复：${summary.recoveryMode}`)}</span><span>${escapeHTML(`健康：${summary.health} · 探测：${summary.probe} · 上游：${summary.status}`)}</span></div></td>
      <td data-label="时间">${escapeHTML(summary.time)}</td>
    </tr>`
  }).join('')
}

function safeCsvCell(value) {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

function usageCSV(items) {
  const columns = [
    ['时间', (item) => item.created_at],
    ['请求 ID', (item) => item.request_id],
    ['模型', (item) => item.model],
    ['上游模型', (item) => item.upstream_model],
    ['推理强度', (item) => item.reasoning_effort],
    ['API Key', (item) => item.api_key?.name || item.api_key_id],
    ['分组', (item) => item.group?.name || item.group_id],
    ['入站端点', (item) => item.inbound_endpoint],
    ['上游端点', (item) => item.upstream_endpoint],
    ['请求类型', (item) => item.request_type],
    ['计费类型', (item) => item.billing_type],
    ['计费模式', (item) => item.billing_mode],
    ['输入 Token', (item) => item.input_tokens],
    ['输出 Token', (item) => item.output_tokens],
    ['缓存读取 Token', (item) => item.cache_read_tokens],
    ['缓存写入 Token', (item) => item.cache_creation_tokens],
    ['倍率', (item) => item.rate_multiplier],
    ['原始成本', (item) => item.original_cost],
    ['实际消费', (item) => item.actual_cost],
    ['首 Token ms', (item) => item.first_token_ms],
    ['耗时 ms', (item) => item.duration_ms],
    ['流式', (item) => item.stream ? '是' : '否'],
    ['客户端 IP', (item) => item.client_ip],
    ['地区', (item) => usageRegionText(item.client_ip)],
    ['User Agent', (item) => item.user_agent],
  ]
  return [columns.map(([label]) => safeCsvCell(label)).join(','), ...items.map((item) => columns.map(([, get]) => safeCsvCell(get(item))).join(','))].join('\r\n')
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

async function loadUsageForExport() {
  const items = []
  let page = 1
  let pages = 1
  do {
    const result = paginated(await request(`/usage?${usageDetailQuery(state.usageAnalytics, page, 100)}`))
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
    ? (logs.items.length ? `<div class="data-table-wrap failover-log-table"><table class="data-table"><thead><tr><th>API 密钥</th><th>模型</th><th>分组切换</th><th>倍率变化</th><th>切换原因</th><th>时间</th></tr></thead><tbody>${failoverRows(logs.items)}</tbody></table></div>` : empty('git-branch', '暂无故障转移记录', '发生分组故障转移后，会在这里保留审计记录。'))
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

function finiteProviderValue(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return null
  return Number(value)
}

function sortedProviders(items, sort = state.providerSort) {
  const indexed = items.map((item, index) => ({ item, index }))
  const valueFor = ({ item }) => {
    if (sort === 'rate') return finiteProviderValue(item.priceMultiplier)
    if (sort === 'first_token') return finiteProviderValue(item.firstTokenLatencyMs)
    return finiteProviderValue(item.successRates?.[state.providerWindow])
  }
  return indexed.sort((left, right) => {
    const a = valueFor(left)
    const b = valueFor(right)
    if (a === null && b === null) return left.index - right.index
    if (a === null) return 1
    if (b === null) return -1
    const compared = sort === 'availability' ? b - a : a - b
    return compared || left.index - right.index
  }).map(({ item }) => item)
}

function providerMetricPoints(series, metric = state.providerMetric) {
  const index = metric === 'tps' ? 3 : metric === 'input_tokens' ? 4 : 2
  return (Array.isArray(series) ? series : []).map((point) => finiteProviderValue(point?.[index])).filter((value) => value !== null)
}

function providerSparkline(item, series) {
  const points = providerMetricPoints(series)
  if (!points.length) return '<span class="provider-series-unavailable">暂无趋势</span>'
  return `<div class="provider-sparkline" data-rates="${escapeHTML(JSON.stringify(points))}"><canvas width="150" height="34" aria-label="${escapeHTML(item.planType)} 指标趋势"></canvas></div>`
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
      options: { responsive: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, elements: { line: { capBezierPoints: true } } },
    }))
  })
}

async function renderProviders() {
  const period = state.providerWindow
  if (!state.providerSummary) state.providerSummary = await request(`/public/monitor/summary?timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai')}`)
  const summary = state.providerSummary
  if (!state.providerSeries[period]) {
    try { state.providerSeries[period] = await request(`/public/monitor/series/${period}`) }
    catch { state.providerSeries[period] = { seriesByApiId: {}, unavailable: true } }
  }
  const seriesByApiId = state.providerSeries[period]?.seriesByApiId || {}
  const items = sortedProviders(summary?.apis || [])
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
      ${providerSparkline(item, seriesByApiId[item.id])}
      <span class="last-checked">${escapeHTML(dateTime(item.checkedAt))}</span>
      <button class="secondary-button use-group-button" data-action="use-provider-group" data-group-id="${escapeHTML(item.group_id)}" data-group-name="${escapeHTML(item.planType || `分组 ${item.group_id}`)}" data-group-rate="${escapeHTML(item.priceMultiplier)}" ${Number.isFinite(Number(item.group_id)) && Number(item.group_id) > 0 ? '' : 'disabled'}>使用此分组</button>
    </div>`
  }).join('')
  const overall = summary?.monitoringActive === false ? ['pending', '监控暂停'] : items.some((item) => item.available === false) ? ['failed', '有服务不可用'] : items.some((item) => item.warningReasons?.length) ? ['pending', '存在告警'] : ['operational', '监测中']
  const sortControls = [['rate', '倍率'], ['first_token', '最快首字'], ['availability', '可用率']].map(([value, label]) => `<button data-provider-sort="${value}" class="${state.providerSort === value ? 'active' : ''}">${label}</button>`).join('')
  const metricControls = [['first_token', '首字'], ['tps', 'TPS'], ['input_tokens', '输入 Token']].map(([value, label]) => `<button data-provider-metric="${value}" class="${state.providerMetric === value ? 'active' : ''}">${label}</button>`).join('')
  $('#content').innerHTML = `<div class="page-stack"><section class="panel provider-hall-panel"><div class="provider-hall-toolbar"><div><div class="provider-title-line"><h2>供应商大厅</h2><span class="status-badge ${overall[0]}">${overall[1]}</span></div><p>首 Token 可能因技术限制与中转站后台不一致；缓存样本不足 1000 条时不展示命中率。</p></div><div class="provider-toolbar-actions"><div class="segmented">${sortControls}</div><div class="segmented">${metricControls}</div><div class="segmented">${[['6h', '6h'], ['24h', '24h'], ['7d', '7d'], ['30d', '30d']].map(([value, label]) => `<button data-provider-window="${value}" class="${period === value ? 'active' : ''}">${label}</button>`).join('')}</div><span class="last-generated">${escapeHTML(dateTime(summary?.generatedAt))}</span><button class="secondary-button" data-action="refresh-providers"><i data-lucide="refresh-cw"></i>刷新</button></div></div><div class="provider-table-head"><span>分组</span><span>倍率</span><span>最新状态</span><span>最新首 Token</span><span>缓存命中率</span><span>可用率 ↓</span><span>${state.providerMetric === 'tps' ? 'TPS 趋势' : state.providerMetric === 'input_tokens' ? '输入趋势' : '首字趋势'}</span><span>最近监测</span><span>使用此分组</span></div>${columns ? `<div class="provider-list">${columns}</div>` : empty('store', '暂无供应商数据', '站点暂时没有发布可用的供应商分组。')}</section></div>`
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
  const detailRows = [
    ['请求 ID', item.request_id || `#${item.id}`],
    ['请求模型', item.model], ['上游模型', item.upstream_model], ['推理强度', item.reasoning_effort],
    ['API Key', item.api_key?.name || item.api_key_id], ['分组', item.group?.name || item.group_id],
    ['入站端点', item.inbound_endpoint], ['上游端点', item.upstream_endpoint],
    ['请求类型', item.request_type], ['计费类型', item.billing_type], ['计费模式', item.billing_mode],
    ['输入 Token', number(item.input_tokens)], ['输出 Token', number(item.output_tokens)],
    ['缓存读取 Token', number(item.cache_read_tokens)], ['缓存写入 Token', number(item.cache_creation_tokens)],
    ['倍率', item.rate_multiplier == null ? '-' : `${number(item.rate_multiplier, 4)}x`],
    ['账户倍率', item.account_rate_multiplier == null ? '-' : `${number(item.account_rate_multiplier, 4)}x`],
    ['原始成本', money(item.original_cost)], ['实际消费', money(item.actual_cost)], ['账户成本', money(item.account_cost)],
    ['首 Token', item.first_token_ms == null ? '-' : `${number(item.first_token_ms)} ms`],
    ['请求耗时', item.duration_ms == null ? '-' : `${number(item.duration_ms)} ms`],
    ['User Agent', item.user_agent], ['创建时间', dateTime(item.created_at)],
  ].map(([label, value]) => `<div class="detail-row"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value ?? '-')}</strong></div>`).join('')
  const ip = String(item.client_ip || '')
  const regionRow = `<div class="detail-row usage-region-row"><span>IP / 地区</span><strong><span>${escapeHTML(ip || '-')}</span><span class="usage-region-value" data-ip="${escapeHTML(ip)}">${escapeHTML(usageRegionText(ip))}</span>${ip ? `<button class="icon-button" data-action="usage-region-refresh" data-ip="${escapeHTML(ip)}" title="刷新地区" aria-label="刷新地区"><i data-lucide="refresh-cw"></i></button>` : ''}</strong></div>`
  openModal('调用详情', `<div class="detail-list usage-detail-list">${detailRows}${regionRow}</div>`, '<button class="primary-button" data-action="close-modal">完成</button>')
}

function isPrivateIPAddress(value) {
  const ip = String(value || '').trim().toLowerCase()
  if (!ip) return true
  if (ip === '::1' || ip === 'localhost' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
}

function updateUsageRegionNodes(ip) {
  $$('.usage-region-value').filter((node) => node.dataset.ip === String(ip)).forEach((node) => {
    node.textContent = usageRegionText(ip)
    const region = state.usageRegions[String(ip)]
    node.title = region?.status === 'success' ? [region.organization, region.timezone].filter(Boolean).join(' · ') : ''
  })
}

function normalizedUsageRegion(data) {
  if (!data?.country_code) return null
  return { status: 'success', country_code: data.country_code, region: data.region, city: data.city, organization: data.organization, timezone: data.timezone, accuracy: data.accuracy, latitude: data.latitude, longitude: data.longitude }
}

async function refreshUsageRegion(ip) {
  const value = String(ip || '').trim()
  if (!value) return
  if (isPrivateIPAddress(value)) {
    state.usageRegions[value] = { status: 'private' }
    updateUsageRegionNodes(value)
    return
  }
  try {
    const response = await fetch(`https://get.geojs.io/v1/ip/geo/${encodeURIComponent(value)}.json`)
    if (!response.ok) throw new Error(`GeoJS ${response.status}`)
    const region = normalizedUsageRegion(await response.json())
    if (!region) throw new Error('GeoJS response missing country')
    state.usageRegions[value] = region
  } catch {
    state.usageRegions[value] = { status: 'error' }
  }
  updateUsageRegionNodes(value)
}

async function refreshUsageRegions(items = state.usageItems) {
  const ips = [...new Set(items.map((item) => String(item.client_ip || '').trim()).filter(Boolean))]
  const publicIps = []
  ips.forEach((ip) => {
    if (isPrivateIPAddress(ip)) {
      state.usageRegions[ip] = { status: 'private' }
      updateUsageRegionNodes(ip)
    } else if (state.usageRegions[ip]?.status !== 'success') publicIps.push(ip)
  })
  for (let index = 0; index < publicIps.length; index += 50) {
    const batch = publicIps.slice(index, index + 50)
    try {
      const response = await fetch(`https://get.geojs.io/v1/ip/geo.json?ip=${batch.map(encodeURIComponent).join(',')}`)
      if (!response.ok) throw new Error(`GeoJS ${response.status}`)
      const payload = await response.json()
      const entries = Array.isArray(payload) ? payload : Object.values(payload || {})
      batch.forEach((ip) => {
        const match = entries.find((entry) => String(entry?.ip) === ip)
        state.usageRegions[ip] = normalizedUsageRegion(match) || { status: 'error' }
        updateUsageRegionNodes(ip)
      })
    } catch {
      batch.forEach((ip) => {
        state.usageRegions[ip] = { status: 'error' }
        updateUsageRegionNodes(ip)
      })
    }
  }
}

function failoverDetailValue(value) {
  if (value == null || value === '') return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function openFailoverDetail(id) {
  const item = state.currentLogs.find((log) => String(log.id) === String(id))
  if (!item) throw new Error('故障转移记录已更新，请刷新后重试')
  const rows = Object.entries(item).map(([field, value]) => `<div class="detail-row"><span>${escapeHTML(field)}</span><strong>${escapeHTML(failoverDetailValue(value))}</strong></div>`).join('')
  openModal('故障转移详情', `<div class="detail-list failover-detail-list">${rows}</div>`, '<button class="primary-button" data-action="close-modal">关闭</button>')
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
  const orderState = state.orders
  const orderQuery = queryString({ page: orderState.page, page_size: orderState.pageSize, status: orderState.status })
  const [ordersData, paymentConfig, checkout, user] = await Promise.all([
    request(`/payment/orders/my?${orderQuery}`).catch(() => ({ items: [], total: 0, pages: 1 })),
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
  const orderPage = paginated(ordersData)
  const orders = orderPage.items
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
    <section class="panel"><div class="panel-header payment-orders-header"><div><h2>订单记录</h2><p>支付与退款状态</p></div><div class="order-filter-controls"><select name="order-status" aria-label="订单状态"><option value="">全部状态</option>${['PENDING','COMPLETED','FAILED','REFUNDED'].map((status) => `<option value="${status}" ${orderState.status === status ? 'selected' : ''}>${paymentStatusLabel(status)}</option>`).join('')}</select><select name="order-page-size" aria-label="每页数量">${[20,50,100].map((size) => `<option value="${size}" ${orderState.pageSize === size ? 'selected' : ''}>${size} / 页</option>`).join('')}</select></div></div>${orderRows ? `<div class="data-table-wrap"><table class="data-table payment-orders"><thead><tr><th>订单号</th><th>金额</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${orderRows}</tbody></table></div>` : empty('receipt', '暂无订单', '创建充值订单后会显示在这里。')}<div class="pagination-bar"><span>共 ${number(orderPage.total)} 条</span><div class="pagination-controls"><button class="icon-button" data-action="orders-prev" aria-label="上一页" ${orderState.page <= 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i></button><strong>${number(orderState.page)} / ${number(orderPage.pages || 1)}</strong><button class="icon-button" data-action="orders-next" aria-label="下一页" ${orderState.page >= (orderPage.pages || 1) ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button></div></div></section>
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

function invoicePagination(page, pages, previousAction, nextAction) {
  return `<div class="pagination-bar"><span>第 ${number(page)} / ${number(pages || 1)} 页</span><div class="pagination-controls"><button class="icon-button toolbar-button" data-action="${previousAction}" ${page <= 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i></button><button class="icon-button toolbar-button" data-action="${nextAction}" ${page >= (pages || 1) ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button></div></div>`
}

function openInvoiceApplication(orderId) {
  const order = state.invoices.eligibleOrders.find((item) => String(item.id) === String(orderId))
  if (!canApplyForInvoice(order)) throw new Error('该订单暂不可申请发票')
  const orderOptions = state.invoices.eligibleOrders.filter(canApplyForInvoice).map((item) => `<option value="${escapeHTML(item.id)}" ${String(item.id) === String(order.id) ? 'selected' : ''}>#${escapeHTML(item.out_trade_no || item.id)} · ${escapeHTML(gatewayMoney(item.amount, item.currency || 'CNY'))}</option>`).join('')
  openModal('申请发票', `<form id="invoice-application-form" class="form-grid"><label class="span-two"><span>充值订单</span><select name="payment_order_id" required><option value="">请选择符合条件的订单</option>${orderOptions}</select></label><label class="span-two"><span>公司 / 个人抬头</span><input name="company_title" maxlength="200" required /></label><label class="span-two"><span>税号</span><input name="tax_number" maxlength="64" required /></label><label class="span-two"><span>收票邮箱</span><input name="email" inputmode="email" maxlength="255" placeholder="多个邮箱可用逗号、分号或空格分隔" required /><small>提交前会统一为英文逗号分隔，最长 255 字节。</small></label><div class="span-two button-row"><button type="submit" class="primary-button"><i data-lucide="send"></i>提交发票申请</button></div></form>`, '<button class="secondary-button" data-action="close-modal">取消</button>')
}

async function renderInvoices() {
  const invoiceState = state.invoices
  const [eligibleData, applicationsData] = await Promise.all([
    request(`/invoices/eligible-orders?${queryString({ page: invoiceState.eligiblePage, page_size: invoiceState.pageSize })}`),
    request(`/invoices/my?${queryString({ page: invoiceState.applicationsPage, page_size: invoiceState.pageSize })}`),
  ])
  const eligible = paginated(eligibleData)
  const applicationsDataPage = paginated(applicationsData)
  const eligibleOrders = eligible.items
  const applications = applicationsDataPage.items
  state.invoices.eligibleOrders = eligibleOrders
  const orderRows = eligibleOrders.map((order) => {
    const [statusClass, statusLabel] = invoiceOrderState(order)
    return `<tr><td><div class="cell-title"><strong>#${escapeHTML(order.out_trade_no || order.id)}</strong><span>${escapeHTML(order.status || '-')}</span></div></td><td>${escapeHTML(gatewayMoney(order.amount, order.currency || 'CNY'))}</td><td>${escapeHTML(dateTime(order.completed_at || order.created_at))}</td><td><span class="status-badge ${statusClass}">${escapeHTML(statusLabel)}</span></td><td>${canApplyForInvoice(order) ? `<button class="secondary-button" data-action="invoice-apply-order" data-id="${escapeHTML(order.id)}">申请开票</button>` : '-'}</td></tr>`
  }).join('')
  const applicationRows = applications.map((item) => {
    const processed = String(item.status || '').toLowerCase() === 'processed'
    return `<tr><td>#${escapeHTML(item.payment_order_id)}</td><td><div class="cell-title"><strong>${escapeHTML(item.company_title || '-')}</strong><span>${escapeHTML(item.tax_number || '-')}</span></div></td><td>${escapeHTML(item.email || '-')}</td><td><span class="status-badge ${processed ? 'active' : 'pending'}">${processed ? '已处理' : '待审核'}</span></td><td>${escapeHTML(dateTime(item.created_at))}</td></tr>`
  }).join('')
  $('#content').innerHTML = `<div class="page-stack invoice-page"><section id="invoice-rules" class="invoice-rules"><div class="invoice-rules-icon"><i data-lucide="file-check-2"></i></div><div><p class="eyebrow">申请规则</p><h2>充值满 300，可申请研发服务发票</h2><p>单笔已完成充值达到 300 方可申请，同一订单不能重复提交。发票内容为“研发服务”，预计 1 - 3 个工作日发送到收票邮箱。</p></div></section><section id="invoice-orders" class="panel"><div class="panel-header"><div><h2>可开票订单</h2><p>${number(eligible.total)} 条订单</p></div></div>${orderRows ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>订单</th><th>金额</th><th>完成时间</th><th>状态</th><th></th></tr></thead><tbody>${orderRows}</tbody></table></div>${invoicePagination(invoiceState.eligiblePage, eligible.pages, 'invoice-orders-prev', 'invoice-orders-next')}` : empty('receipt-text', '暂无订单记录', '完成充值后，订单会显示在这里。')}</section><section class="panel invoice-delivery"><div class="panel-header"><div><h2>邮件交付</h2><p>站内不保存发票文件</p></div></div><div class="panel-body detail-list"><div class="detail-row"><span>开票内容</span><strong>研发服务</strong></div><div class="detail-row"><span>预计时效</span><strong>1 - 3 个工作日</strong></div><div class="detail-row"><span>交付方式</span><strong>发送到收票邮箱</strong></div></div></section><section id="invoice-applications" class="panel"><div class="panel-header"><div><h2>申请记录</h2><p>${number(applicationsDataPage.total)} 条记录</p></div></div>${applicationRows ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>订单</th><th>抬头 / 税号</th><th>邮箱</th><th>状态</th><th>申请时间</th></tr></thead><tbody>${applicationRows}</tbody></table></div>${invoicePagination(invoiceState.applicationsPage, applicationsDataPage.pages, 'invoice-applications-prev', 'invoice-applications-next')}` : empty('clock-3', '暂无申请记录', '提交发票申请后，处理状态会显示在这里。')}</section></div>`
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
  const knownInviteeFields = new Set(['user_id', 'username', 'email', 'total_rebate', 'created_at'])
  const rows = invitees.map((item) => {
    const breakdown = Object.entries(item).filter(([field]) => !knownInviteeFields.has(field)).map(([field, value]) => `<span><code>${escapeHTML(field)}</code>: ${escapeHTML(value)}</span>`).join('')
    return `<tr><td><div class="cell-title"><strong>${escapeHTML(item.username || '用户')}</strong><span>${escapeHTML(item.email || '')}</span></div></td><td><div class="cell-title"><strong>${money(item.total_rebate)}</strong>${breakdown}</div></td><td>${escapeHTML(dateTime(item.created_at))}</td></tr>`
  }).join('')
  const inviteCode = String(aff.aff_code || '')
  const inviteLink = `https://aihub.top/register?aff=${encodeURIComponent(inviteCode)}`
  $('#content').innerHTML = `<div class="page-stack affiliate-page">
    <div class="metrics-grid">
      ${metric('已邀请', number(aff.aff_count), '成功注册用户', 'users-round', 'green')}
      ${metric('可转余额', money(aff.aff_quota), '可转入账户余额', 'coins')}
      ${metric('累计返利', money(aff.aff_history_quota), '历史总额', 'chart-spline', 'amber')}
      ${metric('冻结返利', money(aff.aff_frozen_quota), '等待结算', 'snowflake', 'blue')}
      ${metric('返利比例', `${number(aff.effective_rebate_rate_percent, 2)}%`, '当前有效比例', 'percent', 'dark')}
    </div>
    <section class="panel"><div class="panel-header"><div><h2>邀请信息</h2><p>分享给需要 AI API 的朋友</p></div></div><div class="panel-body affiliate-copy-grid"><label><span>邀请码</span><div class="inline-form"><input id="affiliate-code" readonly value="${escapeHTML(inviteCode)}" /><button class="secondary-button" data-action="copy-affiliate-code"><i data-lucide="copy"></i>复制邀请码</button></div></label><label><span>邀请链接</span><div class="inline-form"><input id="affiliate-link" readonly value="${escapeHTML(inviteLink)}" /><button class="secondary-button" data-action="copy-affiliate-link"><i data-lucide="copy"></i>复制链接</button></div></label>${Number(aff.aff_quota || 0) > 0 ? '<button class="primary-button" data-action="transfer-affiliate"><i data-lucide="arrow-right-left"></i>转入余额</button>' : ''}</div></section>
    <section class="panel"><div class="panel-header"><div><h2>邀请记录</h2><p>${number(invitees.length)} 位用户</p></div></div>${rows ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>用户</th><th>贡献返利</th><th>注册时间</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('user-plus', '还没有邀请记录', '复制邀请链接分享后，成功注册的用户会显示在这里。')}</section>
  </div>`
  icons($('#content'))
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('无法读取头像文件'))
    reader.readAsDataURL(file)
  })
}

function imageFromURL(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('头像图片无效'))
    image.src = url
  })
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
}

async function compressAvatar(file, maxBytes = 20480) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('请选择图片文件')
  if (file.type === 'image/gif') {
    if (file.size > maxBytes) throw new Error('GIF 头像不能超过 20KB')
    return readFileAsDataURL(file)
  }
  if (file.size <= maxBytes) return readFileAsDataURL(file)
  const source = await readFileAsDataURL(file)
  const image = await imageFromURL(source)
  const scales = [1, .92, .84, .76, .68, .6, .52, .44, .36]
  const qualities = [.92, .84, .76, .68, .6, .52, .44, .36]
  for (const scale of scales) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of qualities) {
      const blob = await canvasBlob(canvas, quality)
      if (blob && blob.size <= maxBytes) return readFileAsDataURL(new File([blob], 'avatar.webp', { type: 'image/webp' }))
    }
  }
  throw new Error('头像压缩后仍超过 20KB')
}

function applyProfile(profile) {
  state.user = profile
  const name = profile?.username || profile?.email || '账户'
  $('#account-name').textContent = name
  const avatar = $('#account-avatar')
  avatar.textContent = name.slice(0, 1).toUpperCase()
  avatar.style.backgroundImage = profile?.avatar_url ? `url("${String(profile.avatar_url).replaceAll('"', '%22')}")` : ''
  avatar.classList.toggle('has-image', Boolean(profile?.avatar_url))
}

async function renderAccount() {
  const profile = await request('/user/profile')
  applyProfile(profile)
  const extraEmails = (profile.balance_notify_extra_emails || []).map((item) => typeof item === 'string' ? { email: item, disabled: false } : item)
  const extraRows = extraEmails.map((item) => `<div class="notification-email-row"><strong>${escapeHTML(item.email)}</strong><span class="status-badge ${item.disabled ? 'inactive' : 'active'}">${item.disabled ? '已停用' : '启用中'}</span><button class="icon-button" data-action="toggle-extra-email" data-email="${escapeHTML(item.email)}" data-disabled="${item.disabled ? 'false' : 'true'}" title="切换状态"><i data-lucide="power"></i></button><button class="icon-button" data-action="delete-extra-email" data-email="${escapeHTML(item.email)}" title="删除"><i data-lucide="trash-2"></i></button></div>`).join('')
  $('#content').innerHTML = `<div class="page-stack account-page">
    <div class="two-column">
      <section class="panel"><div class="panel-header"><div><h2>个人资料</h2><p>账户公开信息</p></div></div><div class="panel-body"><form id="profile-form" class="form-grid">
        <div class="span-two account-avatar-editor"><div class="account-avatar-preview">${profile.avatar_url ? `<img src="${escapeHTML(profile.avatar_url)}" alt="头像" />` : escapeHTML((profile.username || profile.email || 'A').slice(0, 1).toUpperCase())}</div><div class="button-row"><label class="secondary-button" for="account-avatar-input"><i data-lucide="upload"></i>上传头像</label><input id="account-avatar-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden /><button type="button" class="secondary-button" data-action="remove-avatar"><i data-lucide="trash-2"></i>移除</button></div></div>
        <label class="span-two"><span>用户名</span><input name="username" value="${escapeHTML(profile.username || '')}" required /></label>
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
    <section class="two-column account-tools-grid">
      <section class="panel"><div class="panel-header"><div><h2>主邮箱</h2><p>验证码与密码确认</p></div></div><div class="panel-body"><form id="primary-email-form" class="form-grid"><label class="span-two"><span>邮箱</span><input name="email" type="email" value="${escapeHTML(profile.email || '')}" required /></label><label><span>验证码</span><input name="verify_code" minlength="6" maxlength="6" required /></label><label><span>当前密码</span><input name="password" type="password" required /></label><div class="span-two button-row"><button type="button" class="secondary-button" data-action="send-primary-email-code">发送验证码</button><button type="submit" class="primary-button">更新邮箱</button></div></form></div></section>
      <section class="panel"><div class="panel-header"><div><h2>余额提醒</h2><p>低余额邮件通知</p></div></div><div class="panel-body"><form id="balance-notify-form" class="form-grid"><div class="span-two key-policy-toggle"><span><strong>低余额通知</strong><small>${profile.balance_notify_enabled ? '已启用' : '已停用'}</small></span><button type="button" class="secondary-button" data-action="toggle-balance-notify">${profile.balance_notify_enabled ? '停用' : '启用'}</button></div><label class="span-two"><span>提醒阈值</span><input name="threshold" type="number" min="0" step="0.01" value="${escapeHTML(profile.balance_notify_threshold ?? 0)}" /></label><div class="span-two button-row"><button type="submit" class="primary-button">保存阈值</button></div></form></div></section>
    </section>
    <section class="panel"><div class="panel-header"><div><h2>额外通知邮箱</h2><p>最多三个地址</p></div></div><div class="panel-body"><form id="extra-email-form" class="inline-form"><input name="email" type="email" placeholder="通知邮箱" required /><input name="code" minlength="6" maxlength="6" placeholder="验证码" required /><button type="button" class="secondary-button" data-action="send-extra-email-code">发送验证码</button><button type="submit" class="primary-button">验证并添加</button></form><div class="notification-email-list">${extraRows || '<span class="muted">暂无额外通知邮箱</span>'}</div></div></section>
    <section class="panel"><div class="panel-header"><div><h2>安全设置</h2><p>修改密码或撤销其他设备会话</p></div></div><div class="panel-body"><form id="password-form" class="form-grid">
      <label><span>当前密码</span><input name="old_password" type="password" autocomplete="current-password" required /></label>
      <label><span>新密码</span><input name="new_password" type="password" minlength="8" autocomplete="new-password" required /></label>
      <div class="span-two button-row"><button type="submit" class="secondary-button"><i data-lucide="lock-keyhole"></i>修改密码</button><button type="button" class="danger-button" data-action="revoke-sessions"><i data-lucide="log-out"></i>退出所有设备</button></div>
    </form></div></section>
  </div>`
  icons($('#content'))
}

function renderGuide() {
  const platform = state.guidePlatform
  const platformName = { windows: 'Windows', macos: 'macOS', linux: 'Linux / WSL' }[platform]
  const home = platform === 'windows' ? '%USERPROFILE%' : '~'
  const nodeInstall = platform === 'windows' ? 'winget install OpenJS.NodeJS.LTS' : platform === 'macos' ? 'brew install node@20' : 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash\nnvm install --lts'
  const chapters = [
    { number: '01', title: 'Node.js 环境安装', icon: 'square-terminal', steps: [{ title: `${platformName} 安装 Node.js 20 LTS`, code: nodeInstall }, { title: '重新打开终端', body: '安装完成后关闭并重新打开终端。' }, { title: '验证环境', code: 'node -v\nnpm -v' }], links: [['https://nodejs.org/en/download', 'Node.js 下载']] },
    { number: '02', title: 'API 密钥高级功能', icon: 'key-round', images: [['https://aihub.top/assets/aihub-key-advanced-options-B3zINWYy.png', 'AIHub API Key 高级选项']], steps: [{ title: '创建或编辑密钥', body: '在 API Key 页面打开高级设置。' }, { title: '设置倍率与故障转移', body: '配置最高倍率、候选或排除分组，以及自然回切、积极回主或不自动回切。' }, { title: '保存服务端策略', body: '转移依据真实使用样本、供应商大厅探测和主动探测，由 AIHub 服务端执行切换。' }], route: ['keys', '管理 API Key'] },
    { number: '03', title: 'CCS 一键导入', icon: 'import', images: [['https://aihub.top/assets/aihub-key-import-ccs-C1yNkU71.png', 'AIHub 导入 CC Switch'], ['https://aihub.top/assets/cc-switch-import-confirmation-95IsQJIy.png', 'CC Switch 导入确认']], steps: [{ title: '安装 CC Switch', body: '下载并安装当前平台版本。' }, { title: '从 AIHub 发起导入', body: '在密钥操作中选择客户端配置。' }, { title: '核对配置', body: '确认密钥掩码、端点、模型和应用类型，不要分享包含 Key 的深链接。' }, { title: '启用供应商', body: '确认后在 CC Switch 中启用导入项。' }], links: [['https://github.com/farion1231/cc-switch/releases/latest', '下载 CC Switch']] },
    { number: '04', title: 'Claude Code 配置教程', icon: 'bot', steps: [{ title: '安装 Claude Code', code: 'npm install -g @anthropic-ai/claude-code' }, { title: `写入 ${home}\\.claude\\settings.json`, code: '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://api.aihub.top",\n    "ANTHROPIC_AUTH_TOKEN": "<AIHUB_API_KEY>"\n  }\n}' }, { title: '启动', code: 'claude' }], links: [['https://docs.anthropic.com/en/docs/claude-code/getting-started', 'Claude Code 文档']] },
    { number: '05', title: 'Codex 配置教程', icon: 'code-2', steps: [{ title: '安装 Codex CLI', code: 'npm install -g @openai/codex@latest' }, { title: `写入 ${home}\\.codex\\config.toml`, code: 'model_provider = "aihub"\n[model_providers.aihub]\nbase_url = "https://aihub.top/v1"\nwire_api = "responses"\nrequires_openai_auth = true' }, { title: `写入 ${home}\\.codex\\auth.json`, code: '{\n  "OPENAI_API_KEY": "<AIHUB_API_KEY>"\n}' }], links: [['https://learn.chatgpt.com/docs/config-file/config-basic', 'Codex 配置文档']] },
    { number: '06', title: 'Gemini CLI 配置教程', icon: 'sparkles', steps: [{ title: '安装 Gemini CLI', code: 'npm install -g @google/gemini-cli' }, { title: `写入 ${home}\\.gemini\\.env`, code: 'GEMINI_API_KEY=<AIHUB_API_KEY>\nGOOGLE_GEMINI_BASE_URL=https://api.aihub.top\nGEMINI_MODEL=gpt-5.6-sol' }, { title: '启动并选择 API Key', code: 'gemini' }], links: [['https://github.com/google-gemini/gemini-cli', 'Gemini CLI']] },
    { number: '07', title: 'AIHubRouter 自动路由工具', icon: 'route', steps: [{ title: `下载 ${platformName} 版本`, body: 'Windows、Linux、macOS x64 与 ARM64 均有对应版本。' }, { title: '预览并执行一次', code: 'aihub-router route --once --dry-run --json\naihub-router route --once --json' }, { title: '每 60 秒监测', code: 'aihub-router watch --interval 60 --json' }], body: 'Economy、Balanced、Speed 三种权重只调整 Key 分组，不代理模型请求，也不修改本地 CLI 配置。', links: [['https://github.com/OnRightPath/AIHubRouter/releases/latest', '下载 AIHubRouter']] },
  ]
  const codeBlock = (value) => `<div class="guide-code"><pre><code>${escapeHTML(value)}</code></pre><button class="icon-button" data-action="copy-guide-code" title="复制" aria-label="复制"><i data-lucide="copy"></i></button></div>`
  const linkButton = ([url, label]) => `<button class="secondary-button" data-action="open-guide-link" data-url="${escapeHTML(url)}"><i data-lucide="external-link"></i>${escapeHTML(label)}</button>`
  const cards = chapters.map((chapter) => `<article class="guide-section"><header><span class="guide-number">${chapter.number}</span><h2><i data-lucide="${chapter.icon}"></i>${chapter.title}</h2></header><div class="guide-section-body">${(chapter.images || []).map(([url, alt]) => `<img class="guide-image" src="${escapeHTML(url)}" alt="${escapeHTML(alt)}" />`).join('')}${chapter.steps.map((item, index) => `<div class="guide-step"><span>${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHTML(item.title)}</strong>${item.body ? `<p>${escapeHTML(item.body)}</p>` : ''}${item.code ? codeBlock(item.code) : ''}</div></div>`).join('')}${chapter.body ? `<p>${escapeHTML(chapter.body)}</p>` : ''}<div class="button-row">${(chapter.links || []).map(linkButton).join('')}${chapter.route ? `<button class="secondary-button" data-route-jump="${chapter.route[0]}"><i data-lucide="arrow-up-right"></i>${chapter.route[1]}</button>` : ''}</div></div></article>`).join('')
  const community = [['AIHUB_check_api','https://github.com/issunmihaichi/AIHUB_check_api'],['AIHub Smart Group','https://github.com/jwwsjlm/AIHub-Smart-Group'],['LLM Retry Proxy','https://github.com/momijineko/llm-retry-proxy'],['AIHUB QQ 群机器人',''],['CC Switch 社区版','https://github.com/jiaxuan1101/cc-switch/releases']].map(([name, url]) => `<div class="guide-community"><strong>${escapeHTML(name)}</strong>${url ? linkButton([url, '查看项目']) : '<span class="muted">社区群内提供</span>'}</div>`).join('')
  const platformControls = [['windows','Windows'],['macos','macOS'],['linux','Linux / WSL']].map(([value, label]) => `<button data-guide-platform="${value}" class="${platform === value ? 'active' : ''}">${label}</button>`).join('')
  $('#content').innerHTML = `<div class="page-stack guide-page"><section class="guide-hero"><div><p class="eyebrow">AIHUB DESKTOP · USER GUIDE</p><h2>从环境准备到自动路由</h2><p>这份教程对应当前 1.1.0 桌面端，并同步 AIHub 站点当前八章结构。</p></div><div class="segmented guide-platforms">${platformControls}</div></section><div class="guide-grid full-guide">${cards}<article class="guide-section"><header><span class="guide-number">08</span><h2><i data-lucide="users-round"></i>社区工具推荐</h2></header><div class="guide-section-body guide-community-grid">${community}</div></article></div><section class="panel guide-note"><div class="panel-body"><i data-lucide="shield-check"></i><div><strong>接口边界</strong><p>桌面端只通过普通用户接口访问 AIHub，拒绝管理员路径。API Key 的故障转移策略由 AIHub 服务端执行切换；桌面端不保存号池，也不代理模型请求。</p></div></div></section></div>`
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

function keyNumber(value) {
  return Math.max(0, Number(value || 0))
}

function keyIPAddressList(value) {
  return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
}

function localDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function orderedFailoverGroupIds(form) {
  return $$('[data-failover-group-id]', form)
    .filter((row) => row.querySelector('input')?.checked && !row.querySelector('input').disabled)
    .map((row) => Number(row.dataset.failoverGroupId))
    .filter((id) => id > 0)
}

function moveFailoverGroup(form, groupId, direction) {
  const row = form.querySelector(`[data-failover-group-id="${groupId}"]`)
  if (!row) return
  const selected = $$('[data-failover-group-id]', form).filter((item) => item.querySelector('input')?.checked && !item.querySelector('input').disabled)
  const index = selected.indexOf(row)
  const swapWith = selected[index + direction]
  if (!swapWith) return
  if (direction < 0) swapWith.before(row)
  else swapWith.after(row)
  syncKeyPolicyForm()
}

function keyFailoverControls(key = {}) {
  const selectedFailover = (key.failover_group_ids || []).map(String)
  const selectedExcluded = new Set((key.failover_excluded_group_ids || []).map(String))
  const selectedGroups = new Set(selectedFailover)
  const orderedGroups = [
    ...selectedFailover.map((id) => state.groups.find((group) => String(group.id) === id)).filter(Boolean),
    ...state.groups.filter((group) => !selectedGroups.has(String(group.id))),
  ]
  const groupChecks = orderedGroups.map((group) => `<div class="failover-group-option" data-failover-group-id="${escapeHTML(group.id)}"><input type="checkbox" name="failover_group_ids" value="${escapeHTML(group.id)}" ${selectedGroups.has(String(group.id)) ? 'checked' : ''} /><span><strong>${escapeHTML(group.name)}</strong><small>${number(keyGroupRate(group), 2)}x</small></span><span class="failover-order-actions"><button type="button" class="icon-button" data-action="move-failover-group-up" data-group-id="${escapeHTML(group.id)}" title="上移" aria-label="上移"><i data-lucide="arrow-up"></i></button><button type="button" class="icon-button" data-action="move-failover-group-down" data-group-id="${escapeHTML(group.id)}" title="下移" aria-label="下移"><i data-lucide="arrow-down"></i></button></span></div>`).join('')
  const excludedChecks = state.groups.map((group) => `<label class="failover-group-option"><input type="checkbox" name="failover_excluded_group_ids" value="${escapeHTML(group.id)}" ${selectedExcluded.has(String(group.id)) ? 'checked' : ''} /><span><strong>${escapeHTML(group.name)}</strong><small>${number(keyGroupRate(group), 2)}x</small></span></label>`).join('')
  return `<label class="key-policy-toggle"><input name="rate_change_notify_enabled" type="checkbox" ${key.rate_change_notify_enabled ? 'checked' : ''} /><span><strong>倍率变动通知</strong><small>分组倍率变化时发送通知</small></span></label>
    <label class="span-two key-policy-toggle"><input name="failover_enabled" type="checkbox" ${key.failover_enabled ? 'checked' : ''} /><span><strong>启用故障转移</strong><small>当前分组不可用时由 AIHub 服务端切换</small></span></label>
    <div id="key-failover-options" class="span-two key-failover-options">
      <div class="failover-strategy-row"><span class="field-label">转移策略</span><div class="failover-strategy-segments"><label><input type="radio" name="failover_strategy" value="manual" ${!['lowest_rate', 'fastest'].includes(key.failover_strategy) ? 'checked' : ''} /><span><strong>按我选择的分组顺序</strong><small>按列表顺序尝试候选分组</small></span></label><label><input type="radio" name="failover_strategy" value="lowest_rate" ${key.failover_strategy === 'lowest_rate' ? 'checked' : ''} /><span><strong>按最低倍率优先</strong><small>自动选择倍率最低的可用分组</small></span></label><label><input type="radio" name="failover_strategy" value="fastest" ${key.failover_strategy === 'fastest' ? 'checked' : ''} /><span><strong>按最快首字优先</strong><small>自动选择首字最快的可用分组</small></span></label></div></div>
      <div id="manual-failover-groups"><div class="failover-groups-heading"><span class="field-label">备用分组</span><small>主分组自动排除；列表顺序即提交顺序</small></div><div class="failover-group-grid">${groupChecks}</div></div>
      <div id="automatic-failover-exclusions"><div class="failover-groups-heading"><span class="field-label">排除分组</span><small>自动策略不会选择这些分组</small></div><div class="failover-group-grid">${excludedChecks}</div></div>
      <div class="failover-strategy-row"><span class="field-label">恢复主分组</span><div class="failover-recovery-segments"><label><input type="radio" name="failover_recovery_mode" value="sticky" ${key.failover_recovery_mode !== 'prefer_primary' && key.failover_recovery_mode !== 'manual_only' ? 'checked' : ''} /><span><strong>自然回切（推荐）</strong><small>稳定恢复后自然回切</small></span></label><label><input type="radio" name="failover_recovery_mode" value="prefer_primary" ${key.failover_recovery_mode === 'prefer_primary' ? 'checked' : ''} /><span><strong>积极回主</strong><small>主组离开冷却后立即回切</small></span></label><label><input type="radio" name="failover_recovery_mode" value="manual_only" ${key.failover_recovery_mode === 'manual_only' ? 'checked' : ''} /><span><strong>不自动回切</strong><small>仅在用户修改策略后返回主组</small></span></label></div></div>
    </div>`
}

function keyPolicyFields(key = {}) {
  const isCreate = !key.id
  const ipEnabled = (key.ip_whitelist || []).length || (key.ip_blacklist || []).length
  const rateEnabled = ['rate_limit_5h', 'rate_limit_1d', 'rate_limit_7d'].some((name) => keyNumber(key[name]) > 0)
  const expirationEnabled = Boolean(key.expires_at)
  return `<label><span>最大倍率（0 = 不限制）</span><input name="max_rate_multiplier" type="number" min="0" step="0.01" value="${escapeHTML(key.max_rate_multiplier ?? 0)}" /></label>
    ${isCreate ? `<label class="key-policy-toggle"><input name="use_custom_key" type="checkbox" /><span><strong>使用自定义 Key</strong><small>仅创建时可设置，密钥不会回显或保存到桌面端状态</small></span></label><label id="custom-key-field" class="span-two hidden"><span>自定义 Key</span><input name="custom_key" type="password" minlength="16" pattern="[A-Za-z0-9_-]+" autocomplete="off" /></label>` : ''}
    <label class="span-two key-policy-toggle"><input name="enable_ip_restriction" type="checkbox" ${ipEnabled ? 'checked' : ''} /><span><strong>限制来源 IP</strong><small>每行一个地址；关闭时会清空服务端白名单和黑名单</small></span></label>
    <div id="key-ip-lists" class="span-two key-advanced-grid"><label><span>IP 白名单</span><textarea name="ip_whitelist" rows="3">${escapeHTML((key.ip_whitelist || []).join('\n'))}</textarea></label><label><span>IP 黑名单</span><textarea name="ip_blacklist" rows="3">${escapeHTML((key.ip_blacklist || []).join('\n'))}</textarea></label></div>
    <label class="span-two key-policy-toggle"><input name="enable_rate_limit" type="checkbox" ${rateEnabled ? 'checked' : ''} /><span><strong>滚动限额</strong><small>关闭或填写非正数时会提交 0</small></span></label>
    <div id="key-rate-limits" class="span-two key-advanced-grid three"><label><span>5 小时</span><input name="rate_limit_5h" type="number" min="0" value="${escapeHTML(key.rate_limit_5h ?? 0)}" /></label><label><span>1 天</span><input name="rate_limit_1d" type="number" min="0" value="${escapeHTML(key.rate_limit_1d ?? 0)}" /></label><label><span>7 天</span><input name="rate_limit_7d" type="number" min="0" value="${escapeHTML(key.rate_limit_7d ?? 0)}" /></label></div>
    ${isCreate ? '' : `<label class="span-two key-policy-toggle"><input name="enable_expiration" type="checkbox" ${expirationEnabled ? 'checked' : ''} /><span><strong>设置到期时间</strong><small>关闭后会清空到期时间</small></span></label><label id="key-expiration-field" class="span-two"><span>到期时间</span><input name="expires_at" type="datetime-local" value="${escapeHTML(localDateTime(key.expires_at))}" /></label>`}
    ${keyFailoverControls(key)}`
}

function syncKeyPolicyForm() {
  const form = $('#create-key-form')
  if (!form) return
  const primaryGroupId = String(form.elements.group_id.value || '')
  $$('[name="failover_group_ids"], [name="failover_excluded_group_ids"]', form).forEach((input) => {
    const isPrimary = Boolean(primaryGroupId) && input.value === primaryGroupId
    input.disabled = isPrimary
    if (isPrimary) input.checked = false
    input.closest('.failover-group-option')?.classList.toggle('hidden', isPrimary)
  })
  const enabled = form.elements.failover_enabled.checked
  const strategy = form.elements.failover_strategy.value
  $('#key-failover-options')?.classList.toggle('hidden', !enabled)
  $('#manual-failover-groups')?.classList.toggle('hidden', !enabled || strategy !== 'manual')
  $('#automatic-failover-exclusions')?.classList.toggle('hidden', !enabled || strategy === 'manual')
  const orderedCandidates = $$('[data-failover-group-id]', form).filter((row) => row.querySelector('input')?.checked && !row.querySelector('input').disabled)
  orderedCandidates.forEach((row, index) => {
    const up = row.querySelector('[data-action="move-failover-group-up"]')
    const down = row.querySelector('[data-action="move-failover-group-down"]')
    if (up) up.disabled = index === 0
    if (down) down.disabled = index === orderedCandidates.length - 1
  })
  const custom = form.elements.use_custom_key
  $('#custom-key-field')?.classList.toggle('hidden', !custom?.checked)
  if (form.elements.custom_key) form.elements.custom_key.required = Boolean(custom?.checked)
  const ipEnabled = Boolean(form.elements.enable_ip_restriction?.checked)
  $('#key-ip-lists')?.classList.toggle('hidden', !ipEnabled)
  const rateEnabled = Boolean(form.elements.enable_rate_limit?.checked)
  $('#key-rate-limits')?.classList.toggle('hidden', !rateEnabled)
  const expirationEnabled = Boolean(form.elements.enable_expiration?.checked)
  $('#key-expiration-field')?.classList.toggle('hidden', !expirationEnabled)
}

function keyFailoverPayload(form, primaryGroupId) {
  const enabled = Boolean(form.elements.failover_enabled?.checked)
  const strategy = form.elements.failover_strategy?.value || 'manual'
  const primary = Number(primaryGroupId) || 0
  return {
    rate_change_notify_enabled: Boolean(form.elements.rate_change_notify_enabled?.checked),
    failover_enabled: enabled,
    failover_strategy: strategy,
    failover_group_ids: enabled && strategy === 'manual' ? orderedFailoverGroupIds(form).filter((id) => id !== primary) : [],
    failover_excluded_group_ids: enabled && strategy !== 'manual' ? new FormData(form).getAll('failover_excluded_group_ids').map(Number).filter((id) => id > 0 && id !== primary) : [],
    failover_recovery_mode: form.elements.failover_recovery_mode?.value || 'sticky',
  }
}

function advancedKeyPayload(form, primaryGroupId) {
  const data = new FormData(form)
  const ipsEnabled = data.get('enable_ip_restriction') === 'on'
  const ratesEnabled = data.get('enable_rate_limit') === 'on'
  const expirationEnabled = data.get('enable_expiration') === 'on'
  const rawExpiration = String(data.get('expires_at') || '')
  const expiration = new Date(rawExpiration)
  return {
    ip_whitelist: ipsEnabled ? keyIPAddressList(data.get('ip_whitelist')) : [],
    ip_blacklist: ipsEnabled ? keyIPAddressList(data.get('ip_blacklist')) : [],
    rate_limit_5h: ratesEnabled ? keyNumber(data.get('rate_limit_5h')) : 0,
    rate_limit_1d: ratesEnabled ? keyNumber(data.get('rate_limit_1d')) : 0,
    rate_limit_7d: ratesEnabled ? keyNumber(data.get('rate_limit_7d')) : 0,
    expires_at: expirationEnabled && rawExpiration && !Number.isNaN(expiration.getTime()) ? expiration.toISOString() : '',
    ...keyFailoverPayload(form, primaryGroupId),
  }
}

function createKeyModal(key = null) {
  state.editingKeyId = key?.id || null
  const selectedGroup = key?.group_id ?? state.preferredGroupId
  const groupOptions = state.groups.map((group) => `<option value="${group.id}" ${String(selectedGroup || '') === String(group.id) ? 'selected' : ''}>${escapeHTML(group.name)} · ${number(keyGroupRate(group), 2)}x</option>`).join('')
  openModal(key ? '编辑 API Key' : '新建 API Key', `<form id="create-key-form" class="form-grid key-editor-form"><label class="span-two"><span>名称</span><input name="name" value="${escapeHTML(key?.name || '')}" required /></label><label class="span-two"><span>分组</span><select name="group_id"><option value="">自动选择</option>${groupOptions}</select></label><label><span>额度上限（USD）</span><input name="quota" type="number" min="0" step="0.01" value="${escapeHTML(key?.quota || '')}" /></label>${key ? '' : '<label><span>有效天数</span><input name="expires_in_days" type="number" min="1" placeholder="留空 = 永久" /></label>'}${keyPolicyFields(key || {})}</form>`, `<button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="${key ? 'submit-update-key' : 'submit-create-key'}"><i data-lucide="${key ? 'save' : 'key-round'}"></i>${key ? '保存' : '创建'}</button>`)
  syncKeyPolicyForm()
  $('#create-key-form input').focus()
}

async function submitCreateKey(target) {
  const form = $('#create-key-form')
  if (!form.reportValidity()) return
  const data = new FormData(form)
  const groupId = Number(data.get('group_id')) || null
  const { expires_at, ...advanced } = advancedKeyPayload(form, groupId)
  const body = { name: String(data.get('name') || '').trim(), max_rate_multiplier: keyNumber(data.get('max_rate_multiplier')), ...advanced }
  if (groupId) body.group_id = groupId
  if (keyNumber(data.get('quota')) > 0) body.quota = keyNumber(data.get('quota'))
  if (keyNumber(data.get('expires_in_days')) > 0) body.expires_in_days = keyNumber(data.get('expires_in_days'))
  if (data.get('use_custom_key') === 'on') body.custom_key = String(data.get('custom_key') || '').trim()
  setBusy(target, true, '创建中')
  const key = await request('/keys', { method: 'POST', body })
  openModal('API Key 已创建', `<div class="secret-output"><span class="muted">请妥善保存</span><code id="created-key">${escapeHTML(key.key)}</code><button class="secondary-button" data-action="copy-created-key"><i data-lucide="copy"></i>复制 Key</button></div>`, '<button class="primary-button" data-action="finish-create-key">完成</button>')
}

async function submitUpdateKey(target) {
  const form = $('#create-key-form')
  if (!form.reportValidity()) return
  const data = new FormData(form)
  const groupId = Number(data.get('group_id')) || null
  const body = { name: String(data.get('name') || '').trim(), group_id: groupId, quota: keyNumber(data.get('quota')), max_rate_multiplier: keyNumber(data.get('max_rate_multiplier')), ...advancedKeyPayload(form, groupId) }
  setBusy(target, true, '保存中')
  await request(`/keys/${state.editingKeyId}`, { method: 'PUT', body })
  closeModal()
  toast('API Key 策略已更新')
  await navigate('keys')
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
  const selectedKey = $('#client-template-key')
  if (selectedKey && state.clientSelectedKeyId) selectedKey.value = String(state.clientSelectedKeyId)
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
  const target = event.target.closest('[data-action], [data-route-jump], [data-dashboard-route], [data-guide-platform], [data-period-value], [data-provider-tab], [data-provider-window], [data-provider-sort], [data-provider-metric], [data-client-tab], [data-log-mode]')
  if (!target) return
  if (target.dataset.routeJump) return navigate(target.dataset.routeJump)
  if (target.dataset.dashboardRoute) {
    const route = target.dataset.dashboardRoute
    if (route === 'failover') {
      state.logs = { ...state.logs, mode: 'failover', page: 1, filters: {} }
      return navigate('logs')
    }
    return navigate(route)
  }
  if (target.dataset.guidePlatform) {
    state.guidePlatform = target.dataset.guidePlatform
    return renderGuide()
  }
  if (target.dataset.periodValue) {
    state.usagePeriod = target.dataset.periodValue
    return navigate('usage')
  }
  if (target.dataset.providerWindow) {
    state.providerWindow = target.dataset.providerWindow
    return renderProviders()
  }
  if (target.dataset.providerSort) {
    state.providerSort = target.dataset.providerSort
    return renderProviders()
  }
  if (target.dataset.providerMetric) {
    state.providerMetric = target.dataset.providerMetric
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
  if (action === 'keys-prev') { state.keyList.page = Math.max(1, state.keyList.page - 1); return renderKeys() }
  if (action === 'keys-next') { state.keyList.page += 1; return renderKeys() }
  if (action === 'key-apply-filters') {
    const form = $('#key-list-filters')
    state.keyList = { ...state.keyList, page: 1, search: String(form.elements['key-search'].value || '').trim(), groupId: form.elements['key-group-filter'].value, status: form.elements['key-status-filter'].value, pageSize: Number(form.elements['key-page-size'].value) || 20 }
    return renderKeys()
  }
  if (target.matches('[data-key-column]')) {
    state.keyList.columns[target.dataset.keyColumn] = target.checked
    return renderKeys()
  }
  if (action === 'copy-key-endpoint') {
    await window.aihub.copyText(target.dataset.endpoint)
    toast('API 地址已复制')
    return
  }
  if (action === 'test-key-endpoint') {
    const url = new URL(target.dataset.endpoint)
    if (url.protocol === 'https:') await window.aihub.openExternal(url.href)
    return
  }
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
  if (action === 'usage-detail') return openLogDetail(target.dataset.id)
  if (action === 'orders-prev') { state.orders.page = Math.max(1, state.orders.page - 1); return renderBilling() }
  if (action === 'orders-next') { state.orders.page += 1; return renderBilling() }
  if (action === 'usage-prev') { state.usageAnalytics.page = Math.max(1, state.usageAnalytics.page - 1); return renderUsage() }
  if (action === 'usage-next') { state.usageAnalytics.page += 1; return renderUsage() }
  if (action === 'usage-region-refresh-all') {
    setBusy(target, true, '查询中')
    await refreshUsageRegions()
    setBusy(target, false)
    return
  }
  if (action === 'export-usage') {
    setBusy(target, true, '导出中')
    try {
      const items = await loadUsageForExport()
      const result = await window.aihub.saveText({ filename: `aihub-usage-${new Date().toISOString().slice(0, 10)}.csv`, content: usageCSV(items) })
      if (result.ok) toast(`已导出 ${number(items.length)} 条记录`)
    } finally {
      setBusy(target, false)
    }
    return
  }
  if (action === 'log-detail') return state.logs.mode === 'failover' ? openFailoverDetail(target.dataset.id) : openLogDetail(target.dataset.id)
  if (action === 'invoice-apply-order') return openInvoiceApplication(target.dataset.id)
  if (action === 'invoice-orders-prev') { state.invoices.eligiblePage = Math.max(1, state.invoices.eligiblePage - 1); return renderInvoices() }
  if (action === 'invoice-orders-next') { state.invoices.eligiblePage += 1; return renderInvoices() }
  if (action === 'invoice-applications-prev') { state.invoices.applicationsPage = Math.max(1, state.invoices.applicationsPage - 1); return renderInvoices() }
  if (action === 'invoice-applications-next') { state.invoices.applicationsPage += 1; return renderInvoices() }
  if (action === 'use-provider-group') {
    return useProviderGroupModal(target.dataset.groupId, target.dataset.groupName, target.dataset.groupRate)
  }
  if (action === 'logs-prev') { state.logs.page = Math.max(1, state.logs.page - 1); return renderLogs() }
  if (action === 'logs-next') { state.logs.page += 1; return renderLogs() }
  if (action === 'reset-log-filters') { state.logs = { ...state.logs, page: 1, filters: {} }; return renderLogs() }
  if (action === 'refresh-providers') {
    state.providerSummary = null
    delete state.providerSeries[state.providerWindow]
    return renderProviders()
  }
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
  if (action === 'configure-client-key') {
    state.clientSelectedKeyId = Number(target.dataset.id) || null
    return navigate('clients')
  }
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
  if (action === 'copy-affiliate-code') { await window.aihub.copyText($('#affiliate-code').value); toast('邀请码已复制') }
  if (action === 'copy-affiliate-link') { await window.aihub.copyText($('#affiliate-link').value); toast('邀请链接已复制') }
  if (action === 'remove-avatar') {
    const profile = await request('/user', { method: 'PUT', body: { avatar_url: '' } })
    applyProfile(profile)
    return renderAccount()
  }
  if (action === 'send-primary-email-code') {
    const email = String(new FormData($('#primary-email-form')).get('email') || '').trim()
    if (!email) throw new Error('请输入邮箱')
    await request('/user/account-bindings/email/send-code', { method: 'POST', body: { email } })
    toast('验证码已发送')
    return
  }
  if (action === 'toggle-balance-notify') {
    const profile = await request('/user', { method: 'PUT', body: { balance_notify_enabled: !Boolean(state.user?.balance_notify_enabled) } })
    applyProfile(profile)
    return renderAccount()
  }
  if (action === 'send-extra-email-code') {
    const email = String(new FormData($('#extra-email-form')).get('email') || '').trim()
    if (!email) throw new Error('请输入通知邮箱')
    await request('/user/notify-email/send-code', { method: 'POST', body: { email } })
    toast('验证码已发送')
    return
  }
  if (action === 'toggle-extra-email') {
    await request('/user/notify-email/toggle', { method: 'PUT', body: { email: target.dataset.email, disabled: target.dataset.disabled === 'true' } })
    return renderAccount()
  }
  if (action === 'delete-extra-email') {
    await request('/user/notify-email', { method: 'DELETE', body: { email: target.dataset.email } })
    return renderAccount()
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
  if (action === 'usage-region-refresh') {
    setBusy(target, true, '查询中')
    await refreshUsageRegion(target.dataset.ip)
    setBusy(target, false)
    return
  }
  if (action === 'move-failover-group-up' || action === 'move-failover-group-down') {
    moveFailoverGroup($('#create-key-form'), Number(target.dataset.groupId), action.endsWith('up') ? -1 : 1)
    return
  }
  if (action === 'submit-create-key') return submitCreateKey(target)
  if (action === 'submit-update-key') return submitUpdateKey(target)
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
    if (form.id === 'usage-analytics-filter') {
      const data = new FormData(form)
      state.usageAnalytics = {
        ...state.usageAnalytics,
        page: 1,
        startDate: String(data.get('start_date') || ''),
        endDate: String(data.get('end_date') || ''),
        granularity: String(data.get('granularity') || 'day'),
        filters: {
          api_key_id: String(data.get('api_key_id') || ''),
          model: String(data.get('model') || '').trim(),
          group_id: String(data.get('group_id') || ''),
          request_type: String(data.get('request_type') || ''),
          billing_type: String(data.get('billing_type') || ''),
          billing_mode: String(data.get('billing_mode') || ''),
        },
      }
      await renderUsage()
      return
    }
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
      const paymentOrderId = Number(data.get('payment_order_id'))
      const order = state.invoices.eligibleOrders.find((item) => Number(item.id) === paymentOrderId)
      if (!canApplyForInvoice(order)) throw new Error('请选择可申请发票的订单')
      const email = normalizeInvoiceEmails(data.get('email'))
      if (!email) throw new Error('请输入有效的收票邮箱，多个邮箱可用逗号、分号或空格分隔')
      await request('/invoices', {
        method: 'POST',
        body: {
          payment_order_id: paymentOrderId,
          company_title: String(data.get('company_title')).trim(),
          tax_number: String(data.get('tax_number')).trim(),
          email,
        },
      })
      toast('发票申请已提交')
      closeModal()
      await renderInvoices()
      return
    }
    if (form.id === 'profile-form') {
      const username = new FormData(form).get('username').trim()
      const profile = await request('/user', { method: 'PUT', body: { username } })
      state.user = profile; toast('资料已保存'); navigate('account')
    }
    if (form.id === 'primary-email-form') {
      const data = new FormData(form)
      await request('/user/account-bindings/email', { method: 'POST', body: { email: String(data.get('email') || '').trim(), verify_code: String(data.get('verify_code') || '').trim(), password: String(data.get('password') || '') } })
      form.reset()
      toast('主邮箱已更新')
      await renderAccount()
      return
    }
    if (form.id === 'balance-notify-form') {
      const threshold = Number(new FormData(form).get('threshold') || 0)
      if (!Number.isFinite(threshold) || threshold < 0) throw new Error('请输入有效的提醒阈值')
      const profile = await request('/user', { method: 'PUT', body: { balance_notify_threshold: threshold } })
      applyProfile(profile)
      toast('提醒阈值已保存')
      await renderAccount()
      return
    }
    if (form.id === 'extra-email-form') {
      const data = new FormData(form)
      await request('/user/notify-email/verify', { method: 'POST', body: { email: String(data.get('email') || '').trim(), code: String(data.get('code') || '').trim() } })
      form.reset()
      toast('通知邮箱已添加')
      await renderAccount()
      return
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

async function handleContentChange(event) {
  if (event.target.name === 'order-status') {
    state.orders.status = event.target.value
    state.orders.page = 1
    await renderBilling()
    return
  }
  if (event.target.name === 'order-page-size') {
    state.orders.pageSize = Number(event.target.value) || 20
    state.orders.page = 1
    await renderBilling()
    return
  }
  if (event.target.id !== 'account-avatar-input') return
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const avatarUrl = await compressAvatar(file)
    const profile = await request('/user', { method: 'PUT', body: { avatar_url: avatarUrl } })
    applyProfile(profile)
    toast('头像已更新')
    await renderAccount()
  } catch (error) {
    toast(error.message, 'error')
    event.target.value = ''
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
$('#content').addEventListener('change', handleContentChange)
$('#content').addEventListener('input', (event) => {
  if (event.target.id === 'recharge-amount') updateRechargePreview()
})
$('#modal-root').addEventListener('click', handleModalClick)
$('#modal-root').addEventListener('submit', handleContentSubmit)
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
