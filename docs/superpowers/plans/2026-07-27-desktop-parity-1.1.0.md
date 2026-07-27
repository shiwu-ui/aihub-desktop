# AIHub Desktop 1.1.0 User Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the approved ordinary-user feature parity work, remove subscriptions and the separate channel-status concept, and deliver verified 1.1.0 installer and portable artifacts.

**Architecture:** Keep the existing Electron main/preload/renderer architecture and ordinary-user request bridge. Extend the existing route functions with small pure helpers, retain server-side business decisions, and use focused Electron smoke tests for renderer contracts.

**Tech Stack:** Electron 36.9.5, Node.js, CommonJS, browser JavaScript, CSS, Playwright Core, Node assert, electron-builder.

## Global Constraints

- Use the existing Node/Electron implementation and dependency versions.
- Do not add a channel-status page.
- Remove subscriptions and plans; recharge remains the only purchase workflow.
- Do not add third-party account bindings or 2FA management.
- Do not call administrator APIs.
- Do not persist credentials, API keys, invoice data, cookies, or GitHub tokens.
- Use `D:\dev\nodejs\node.exe`, `D:\dev\nodejs\npm.cmd`, and `D:\dev\git\cmd\git.exe` by absolute path.
- Use test-first red-green-refactor for every behavior change.

---

### Task 1: Lock The 1.1.0 Scope And Remove Subscriptions

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app.js`
- Modify: `tools/installer-upgrade-contract-smoke.cjs`
- Modify: `tools/dashboard-redeem-smoke.cjs`

**Interfaces:**
- Consumes: existing renderer `navigate(route)` and `renderBilling()`.
- Produces: `APP_VERSION === '1.1.0'`, no `plans` navigation, and stale `plans` route normalization to `billing`.

- [ ] **Step 1: Write failing scope assertions**

Add assertions that package and renderer versions are 1.1.0, sidebar labels do not contain `套餐`, renderer source has no `renderPlans`, `/subscriptions`, or `open-purchase-page`, and `navigate('plans')` resolves to billing.

```js
assert.equal(pkg.version, '1.1.0')
assert.doesNotMatch(rendererSource, /renderPlans|\/subscriptions|open-purchase-page/)
assert.equal(navLabels.includes('套餐'), false)
assert.equal(await page.evaluate(() => normalizeRoute('plans')), 'billing')
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
& 'D:\dev\nodejs\node.exe' 'D:\bot\desktop-app\tools\installer-upgrade-contract-smoke.cjs'
& 'D:\dev\nodejs\node.exe' 'D:\bot\desktop-app\tools\dashboard-redeem-smoke.cjs'
```

Expected: failures on version 1.0.7 and the existing plans route/navigation.

- [ ] **Step 3: Implement scope and version changes**

Use an explicit route normalizer and remove the plans renderer:

```js
function normalizeRoute(route) {
  return route === 'plans' ? 'billing' : route
}
```

Update `package.json`, the root package entries in `package-lock.json`, `APP_VERSION`, sidebar markup, route labels, route map, changelog, and about copy to 1.1.0.

- [ ] **Step 4: Verify GREEN**

Run both focused tests and expect exit code 0 with version `1.1.0` and no subscription navigation.

- [ ] **Step 5: Commit**

```powershell
& 'D:\dev\git\cmd\git.exe' add package.json package-lock.json src/renderer/index.html src/renderer/app.js tools/installer-upgrade-contract-smoke.cjs tools/dashboard-redeem-smoke.cjs
& 'D:\dev\git\cmd\git.exe' commit -m 'chore: define desktop 1.1.0 scope'
```

### Task 2: Complete API Key Controls And Ordered Failover

**Files:**
- Modify: `tools/provider-key-features-smoke.cjs`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/fluent.css`

**Interfaces:**
- Consumes: `state.groups`, `request('/keys...')`, and the existing client configuration route.
- Produces: `orderedFailoverGroupIds(form)`, `advancedKeyPayload(form, primaryGroupId)`, paginated key state, and selected-key client handoff.

- [ ] **Step 1: Extend the failing key contract**

Exercise create and update forms with the approved fields and assert exact payloads:

```js
assert.deepEqual(updateCall.body, {
  name: 'Codex Key',
  group_id: 1,
  quota: 50,
  use_custom_key: false,
  ip_whitelist: '203.0.113.10',
  ip_blacklist: '',
  max_rate_multiplier: 0.03,
  rate_change_notify_enabled: true,
  failover_enabled: true,
  failover_strategy: 'manual',
  failover_group_ids: [4, 2, 3],
  failover_excluded_group_ids: [],
  failover_recovery_mode: 'sticky',
  rate_limit_5h: 100,
  rate_limit_1d: 300,
  rate_limit_7d: 1000,
  expires_at: '2026-12-31T23:59:59+08:00',
})
```

Assert visible labels include `按最快首字优先`, `自然回切（推荐）`, `积极回主`, and `不自动回切`, and do not include the obsolete `最快响应` or `保持当前` labels.

- [ ] **Step 2: Verify RED**

```powershell
& 'D:\dev\nodejs\node.exe' 'D:\bot\desktop-app\tools\provider-key-features-smoke.cjs'
```

Expected: missing advanced fields, ordering controls, filters, and corrected labels.

- [ ] **Step 3: Implement pure payload and ordering helpers**

```js
function orderedFailoverGroupIds(form) {
  return Array.from(form.querySelectorAll('[data-failover-group-id]'))
    .filter((row) => row.querySelector('input').checked)
    .map((row) => Number(row.dataset.failoverGroupId))
}

function advancedKeyPayload(form, primaryGroupId) {
  const data = new FormData(form)
  const useCustomKey = data.get('use_custom_key') === 'on'
  const payload = {
    use_custom_key: useCustomKey,
    ip_whitelist: String(data.get('ip_whitelist') || '').trim(),
    ip_blacklist: String(data.get('ip_blacklist') || '').trim(),
    rate_limit_5h: Math.max(0, Number(data.get('rate_limit_5h') || 0)),
    rate_limit_1d: Math.max(0, Number(data.get('rate_limit_1d') || 0)),
    rate_limit_7d: Math.max(0, Number(data.get('rate_limit_7d') || 0)),
    expires_at: normalizeExpiration(data),
    ...keyFailoverPayload(form, primaryGroupId),
  }
  if (useCustomKey) payload.custom_key = String(data.get('custom_key') || '').trim()
  return payload
}
```

Move buttons update the DOM order and disabled state without recreating the modal.

- [ ] **Step 4: Implement key list parity**

Add `state.keyList = { page, pageSize, search, groupId, status, columns }`, server query serialization, pagination, search/filter controls, usage/concurrency/expiration columns, endpoint copy/test actions, and `configure-client-key` navigation.

- [ ] **Step 5: Verify GREEN**

Run the key smoke test and `tools/client-config-ui-smoke.cjs`; both must exit 0 with no page errors or horizontal overflow.

- [ ] **Step 6: Commit**

```powershell
& 'D:\dev\git\cmd\git.exe' add src/renderer/app.js src/renderer/fluent.css tools/provider-key-features-smoke.cjs
& 'D:\dev\git\cmd\git.exe' commit -m 'feat: complete API key management'
```

### Task 3: Correct Invoices And Redesign Failover Logs

**Files:**
- Modify: `tools/invoice-flow-smoke.cjs`
- Modify: `tools/failover-log-smoke.cjs`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/fluent.css`

**Interfaces:**
- Produces: `invoiceOrderState(order)`, `canApplyForInvoice(order)`, `failoverSummary(item)`, and a failover detail modal.

- [ ] **Step 1: Add failing invoice eligibility cases**

Mock three orders and assert only one has an apply command:

```js
const orders = [
  { id: 301, eligible: true, applied: false, amount: 300 },
  { id: 302, eligible: false, applied: false, amount: 20 },
  { id: 303, eligible: true, applied: true, amount: 500 },
]
assert.equal(await page.getByRole('button', { name: '申请开票' }).count(), 1)
assert.match(await page.locator('#invoice-orders').innerText(), /金额不足 300/)
assert.match(await page.locator('#invoice-orders').innerText(), /已申请/)
```

- [ ] **Step 2: Add failing six-column failover assertions**

```js
assert.deepEqual(headers, ['API 密钥', '模型', '分组切换', '倍率变化', '切换原因', '时间'])
assert.match(rowText, /主分组\s*→\s*备用组/)
assert.match(rowText, /0\.02\s*→\s*0\.03/)
assert.match(rowText, /健康异常.*主动探测.*503/)
```

Click the row and assert the detail modal includes raw source/target IDs, strategy, recovery mode, reason, `health_class`, probe, and upstream status.

- [ ] **Step 3: Verify RED**

Run both focused tests. Expected: invoice exposes all orders as options and failover still has 11 columns.

- [ ] **Step 4: Implement invoice and failover helpers**

```js
function canApplyForInvoice(order) {
  return order?.eligible === true && order?.applied !== true
}

function invoiceOrderState(order) {
  if (order?.applied) return ['applied', '已申请']
  if (order?.eligible) return ['eligible', '申请开票']
  return ['ineligible', order?.eligibility_reason || '金额不足 300']
}
```

Render all orders, but only open the form from `canApplyForInvoice(order)`. Build compact failover summary cells and a complete detail modal.

- [ ] **Step 5: Verify GREEN**

Run both focused tests at 1280x820 and 980x680; expect no page-level overflow and no errors.

- [ ] **Step 6: Commit**

```powershell
& 'D:\dev\git\cmd\git.exe' add src/renderer/app.js src/renderer/fluent.css tools/invoice-flow-smoke.cjs tools/failover-log-smoke.cjs
& 'D:\dev\git\cmd\git.exe' commit -m 'fix: align invoices and failover audit'
```

### Task 4: Add Usage Analytics And Detailed Request Fields

**Files:**
- Create: `tools/usage-parity-smoke.cjs`
- Modify: `package.json`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/fluent.css`

**Interfaces:**
- Produces: `usageOverviewQuery(state)`, `usageDetailQuery(state)`, `safeCsvCell(value)`, distribution tables, region refresh actions, and resilient optional-section states.

- [ ] **Step 1: Write the failing usage parity smoke test**

Mock `/usage/dashboard/snapshot-v2`, `/usage/dashboard/models`, `/usage/dashboard/api-keys-usage`, `/usage/stats`, `/usage`, and the site's region lookup request. Assert model/group/endpoint distributions, Token trend, actual/standard costs, all approved filters, detailed fields, CSV formula escaping, and isolated region lookup errors.

```js
assert.match(pageText, /模型分布.*分组使用分布.*端点分布.*Token 使用趋势/s)
assert.match(detailText, /XHigh.*\/v1\/responses.*按量.*0\.06x.*首 Token/s)
assert.equal(safeCsvCell('=1+1'), '"\'=1+1"')
```

- [ ] **Step 2: Verify RED**

```powershell
& 'D:\dev\nodejs\node.exe' 'D:\bot\desktop-app\tools\usage-parity-smoke.cjs'
```

Expected: missing route sections and helpers.

- [ ] **Step 3: Implement analytics and filter state**

```js
const usageAnalyticsState = {
  startDate: '', endDate: '', granularity: 'day',
  filters: { api_key_id: '', model: '', group_id: '', request_type: '', billing_type: '', billing_mode: '' },
}
```

Fetch independent sections with settled results so one optional failure does not blank the page. Add detailed columns, modal rows, and matching CSV columns.

- [ ] **Step 4: Implement bounded IP region refresh**

Individual refresh updates only the selected record. Batch refresh deduplicates IPs, limits concurrent requests, skips known regions, and leaves the IP visible when lookup fails.

- [ ] **Step 5: Verify GREEN**

Run the new test plus `tools/usage-cache-smoke.cjs` and `tools/failover-log-smoke.cjs`.

- [ ] **Step 6: Commit**

```powershell
& 'D:\dev\git\cmd\git.exe' add package.json src/renderer/app.js src/renderer/fluent.css tools/usage-parity-smoke.cjs
& 'D:\dev\git\cmd\git.exe' commit -m 'feat: expand usage analytics'
```

### Task 5: Complete Dashboard And Provider Hall

**Files:**
- Modify: `tools/dashboard-redeem-smoke.cjs`
- Modify: `tools/provider-key-features-smoke.cjs`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/fluent.css`

**Interfaces:**
- Produces: dashboard platform/model/recent sections and `providerSort`/`providerMetric` state.

- [ ] **Step 1: Add failing dashboard/provider expectations**

```js
assert.match(dashboardText, /按平台拆分.*模型分布.*最近使用.*快捷操作/s)
assert.deepEqual(providerSortLabels, ['倍率', '最快首字', '可用率'])
assert.deepEqual(providerMetricLabels, ['首字', 'TPS', '输入 Token'])
```

- [ ] **Step 2: Verify RED**

Run dashboard and provider smoke tests and confirm the new assertions fail.

- [ ] **Step 3: Implement dashboard sections**

Use existing snapshot and dashboard API responses. Quick actions call existing route navigation and never duplicate form logic.

- [ ] **Step 4: Implement provider sorting and metric switching**

```js
function sortedProviders(items, sort) {
  const copy = [...items]
  if (sort === 'rate') return copy.sort((a, b) => Number(a.priceMultiplier) - Number(b.priceMultiplier))
  if (sort === 'first_token') return copy.sort((a, b) => Number(a.firstTokenLatencyMs ?? Infinity) - Number(b.firstTokenLatencyMs ?? Infinity))
  return copy.sort((a, b) => Number(b.successRates?.[state.providerWindow] || 0) - Number(a.successRates?.[state.providerWindow] || 0))
}
```

Render the selected first-token/TPS/input-token history when the API supplies it, with a clear unavailable state otherwise.

- [ ] **Step 5: Verify GREEN And Commit**

Run both tests, then commit the four files with `feat: expand dashboard and provider hall`.

### Task 6: Add Account And Affiliate Parity

**Files:**
- Create: `tools/account-parity-smoke.cjs`
- Modify: `package.json`
- Modify: `tools/dashboard-redeem-smoke.cjs`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/fluent.css`

**Interfaces:**
- Produces: `compressAvatar(file, maxBytes = 20480)`, email binding forms, balance notification controls, and separate affiliate copy actions.

- [ ] **Step 1: Write failing account and affiliate tests**

Assert avatar update/removal calls `PUT /user`, email sends `/user/account-bindings/email/send-code` then posts `/user/account-bindings/email`, balance settings call `PUT /user`, extra email controls use `/user/notify-email/*`, and no third-party or 2FA management controls render.

```js
assert.equal(hasThirdPartyControls, false)
assert.equal(hasTotpManagement, false)
assert.deepEqual(emailCalls.map((call) => call.route), [
  '/user/account-bindings/email/send-code',
  '/user/account-bindings/email',
])
```

- [ ] **Step 2: Verify RED**

Run the new account test and the dashboard/redeem test.

- [ ] **Step 3: Implement account controls**

Compress static images through canvas until the encoded payload is at most 20KB; reject oversized GIF input without mutation. Update `avatar_url`, `balance_notify_enabled`, and `balance_notify_threshold` through `PUT /user`. Add verified extra notification emails through `/user/notify-email/send-code` and `/verify`.

- [ ] **Step 4: Implement affiliate details**

Add independent copy buttons for `aff_code` and the invitation URL. Render available rebate breakdown fields with raw-value fallback.

- [ ] **Step 5: Verify GREEN And Commit**

Run focused tests and commit with `feat: complete account and affiliate tools`.

### Task 7: Complete Recharge Orders And Tutorial

**Files:**
- Modify: `tools/payment-flow-smoke.cjs`
- Modify: `tools/guide-tray-contract-smoke.cjs`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/fluent.css`

**Interfaces:**
- Produces: paginated order state and a full eight-chapter tutorial with platform variants.

- [ ] **Step 1: Add failing order pagination assertions**

Assert `/payment/orders/my` receives `page`, `page_size`, and optional `status`; verify changing status resets page to 1 and pending verify/cancel behavior remains.

- [ ] **Step 2: Add failing tutorial completeness assertions**

Assert eight chapters, Windows/macOS/Linux or WSL controls, ordered steps, copy buttons, current official links, no subscription text, and no live-key patterns.

- [ ] **Step 3: Verify RED**

Run payment and guide tests.

- [ ] **Step 4: Implement order state and tutorial content**

```js
state.orders = { page: 1, pageSize: 20, status: '' }
```

Serialize it into `/payment/orders/my`, render controls, and preserve payment polling. Replace abbreviated tutorial bodies with the approved current-site content and responsive platform sections.

- [ ] **Step 5: Verify GREEN And Commit**

Run both tests at desktop and compact viewports, then commit with `feat: complete recharge orders and tutorial`.

### Task 8: Regression, Visual QA, Packaging, And Delivery

**Files:**
- Modify: `README.md`
- Modify: `docs/release-notes/pending.md`
- Modify: `work/HISTORY.md`
- Modify: any smoke test whose version-only expectations remain at 1.0.7

**Interfaces:**
- Produces: reviewed source commits, 1.1.0 portable/installer artifacts, and a verified pushed `origin/main`.

- [ ] **Step 1: Run every registered test**

Enumerate `test:*` scripts from `package.json` and execute each `.cjs` file with `D:\dev\nodejs\node.exe`. Expected: every test exits 0.

- [ ] **Step 2: Run visual QA**

Capture dashboard, keys/list/editor, usage, failover, providers, invoices, recharge/orders, account, affiliate, and tutorial at 1280x820 and 980x680. Check page errors, overlap, clipped controls, text overflow, and horizontal overflow.

- [ ] **Step 3: Update documentation and history**

Document version 1.1.0, recharge-only scope, new user features, exact artifact names, test results, and build activity. Do not include secrets or account data.

- [ ] **Step 4: Build with domestic mirrors**

```powershell
$env:Path = 'D:\dev\nodejs;' + $env:Path
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
& 'D:\dev\nodejs\node.exe' 'D:\bot\desktop-app\tools\clean-old-builds.cjs'
& 'D:\dev\nodejs\node.exe' 'D:\bot\desktop-app\node_modules\electron-builder\cli.js' --win --publish never
```

Expected artifacts:

```text
dist/AIHub-Desktop-1.1.0.exe
dist/AIHub-Desktop-1.1.0-Setup.exe
```

- [ ] **Step 5: Verify artifacts**

Check file existence, PE `FileVersion`/`ProductVersion`, embedded ASAR `package.json` version, SHA-256, and zero surviving builder processes.

- [ ] **Step 6: Review and commit remaining work**

Run `git diff --check`, inspect the complete source diff and secret scan, then commit intended source, tests, docs, and history. Never stage `dist`, `artifacts`, credentials, or caches.

- [ ] **Step 7: Push and verify**

Push `main` with transient authentication that is not persisted in Git configuration or the remote URL. Compare local `HEAD` with `git ls-remote origin refs/heads/main`; hashes must match.
