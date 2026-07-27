# AIHub Site Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete AIHub key policy controls, failover logs, self-service invoices, and the current tutorial to the existing Electron desktop app.

**Architecture:** Continue using the renderer's native route functions and the main process's authenticated JSON bridge. Add only the `/invoices` allowlist entry, keep all business decisions on the AIHub service, and test renderer behavior with synthetic request functions in isolated Electron user-data directories.

**Tech Stack:** Electron 36.9.5, CommonJS, browser JavaScript, CSS, Playwright Core 1.61.1, Node assert.

## Global Constraints

- Keep the original Node/Electron implementation; no Go/Wails rewrite.
- Use only ordinary-user AIHub endpoints and reject administrator paths.
- Do not add dependencies or change installed dependency versions.
- Never persist supplied passwords, GitHub tokens, or live API keys.
- Use `D:\dev\nodejs\node.exe`, `D:\dev\nodejs\npm.cmd`, and `D:\dev\git\cmd\git.exe` by absolute path.

---

### Task 1: Lock The Key Policy Contract

**Files:**
- Modify: `tools/provider-key-features-smoke.cjs`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/fluent.css`

**Interfaces:**
- Consumes: `state.groups`, `createKeyModal(key)`, and the existing `request(route, options)` bridge.
- Produces: `keyFailoverPayload(form, primaryGroupId)` returning all five failover fields plus the independent rate notification field in create/update bodies.

- [ ] **Step 1: Extend the failing UI test**

Add a synthetic key containing `fastest`, ordered candidates, excluded groups, `prefer_primary`, and rate notifications. Exercise all three strategies and all three recovery values, then assert the update body is exactly:

```js
assert.deepEqual(updateCall.body, {
  name: 'Codex Key',
  group_id: 1,
  quota: 0,
  max_rate_multiplier: 0.03,
  rate_change_notify_enabled: true,
  failover_enabled: true,
  failover_strategy: 'fastest',
  failover_group_ids: [],
  failover_excluded_group_ids: [3],
  failover_recovery_mode: 'prefer_primary',
})
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
& 'D:\dev\nodejs\node.exe' 'D:\bot\desktop-app\tools\provider-key-features-smoke.cjs'
```

Expected: FAIL because the notification, `fastest`, exclusions, and recovery controls do not exist.

- [ ] **Step 3: Implement the minimal policy UI and payload**

Render `manual`, `lowest_rate`, and `fastest` segmented choices; ordered candidate groups for manual mode; exclusions for automatic modes; and `sticky`, `prefer_primary`, and `manual_only` recovery choices. Add `rate_change_notify_enabled` to both create and update bodies.

- [ ] **Step 4: Verify GREEN**

Run the same command and expect JSON with `"ok":true`, followed by the existing guide/tray contract test.

### Task 2: Add Failover Audit Logs

**Files:**
- Create: `tools/failover-log-smoke.cjs`
- Modify: `package.json`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/fluent.css`

**Interfaces:**
- Consumes: `GET /usage/failovers` and the existing key list used for filters.
- Produces: a failover tab in the log page, filter query builder, paginated table, and enum fallback labels.

- [ ] **Step 1: Write the failing smoke test**

Mock `/keys?...` and `/usage/failovers?...`, navigate to `logs`, switch to the failover tab, and assert the request includes `page`, `page_size`, `start_date`, `end_date`, `model`, and `api_key_id`. Assert rendered text contains `主分组`, `备用组`, `0.02`, `0.03`, `主动探测`, and `503`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
& 'D:\dev\nodejs\node.exe' 'D:\bot\desktop-app\tools\failover-log-smoke.cjs'
```

Expected: FAIL because the failover tab is absent.

- [ ] **Step 3: Implement logs**

Add `renderFailoverLogs()`, query serialization through `URLSearchParams`, table rows, mode switching, filtering, and pagination. Unknown strategy, reason, and recovery strings must display unchanged.

- [ ] **Step 4: Verify GREEN**

Run the focused test and `tools/usage-cache-smoke.cjs`; both must pass with no page errors.

### Task 3: Add Self-Service Invoices

**Files:**
- Create: `tools/invoice-flow-smoke.cjs`
- Modify: `package.json`
- Modify: `src/main.cjs`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/fluent.css`

**Interfaces:**
- Consumes: `GET /invoices/eligible-orders`, `GET /invoices/my`, and `POST /invoices`.
- Produces: `normalizeInvoiceEmails(value)` returning a comma-space-separated string or an empty string for invalid input; a new `invoices` renderer route.

- [ ] **Step 1: Write the failing invoice flow**

Mock one eligible order and one pending application. Apply for the order with `ops@example.com；finance@example.com`, then assert the POST body is:

```js
{
  payment_order_id: 301,
  company_title: '示例科技有限公司',
  tax_number: '91310000TEST000001',
  email: 'ops@example.com, finance@example.com',
}
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
& 'D:\dev\nodejs\node.exe' 'D:\bot\desktop-app\tools\invoice-flow-smoke.cjs'
```

Expected: FAIL because the invoice route and navigation item are absent.

- [ ] **Step 3: Implement the invoice route**

Allow `/invoices` in `src/main.cjs`, add the navigation item, render eligibility and application sections, validate fields, normalize email separators, submit, show success, and refresh both lists.

- [ ] **Step 4: Verify GREEN**

Run the focused test, `tools/payment-ui-smoke.cjs`, and `tools/payment-flow-smoke.cjs`.

### Task 4: Synchronize The Tutorial

**Files:**
- Modify: `tools/guide-tray-contract-smoke.cjs`
- Modify: `src/renderer/app.js`
- Modify: `src/renderer/fluent.css`

**Interfaces:**
- Consumes: existing `renderGuide()`, `data-route-jump`, and HTTPS external-link handling.
- Produces: eight desktop tutorial sections matching the current public site chapter structure.

- [ ] **Step 1: Update the guide expectations**

Assert section count is eight and content includes `Node.js 环境安装`, `API 密钥高级功能`, `CCS 一键导入`, `Claude Code`, `Codex`, `Gemini CLI`, `AIHubRouter`, and `社区工具推荐`.

- [ ] **Step 2: Verify RED**

Run the existing guide/tray test and expect failure on section count and missing chapter names.

- [ ] **Step 3: Replace the tutorial markup**

Build an unframed documentation layout with a compact chapter index, copyable code blocks, current command/config examples, and official HTTPS links. Keep all code examples free of real credentials by using `<AIHUB_API_KEY>`.

- [ ] **Step 4: Verify GREEN**

Run the guide/tray test at 1280x820 and an additional 980x680 overflow check; expect zero horizontal overflow and no page errors.

### Task 5: Regression, Release Notes, And Delivery

**Files:**
- Modify: `README.md`
- Modify: `docs/release-notes/pending.md`
- Modify: `work/HISTORY.md`

**Interfaces:**
- Consumes: all focused test scripts and the existing packaging configuration.
- Produces: verified source, accurate tool-path documentation, a secret-free commit, and a pushed `origin/main`.

- [ ] **Step 1: Run all tests**

Execute every `tools/*-smoke.cjs` registered in `package.json` with `D:\dev\nodejs\node.exe`. Expected: every process exits 0 and prints its success JSON.

- [ ] **Step 2: Perform desktop visual verification**

Capture the key policy, failover log, invoice, and tutorial views at 1280x820 and 980x680 in a temporary directory. Check page errors, horizontal overflow, clipped controls, and overlapping text.

- [ ] **Step 3: Build without dependency changes**

Run:

```powershell
& 'D:\dev\nodejs\node.exe' 'D:\bot\desktop-app\node_modules\electron-builder\cli.js' --dir --win
```

Expected: exit 0 and an updated `dist/win-unpacked` application. Do not run `npm install`.

- [ ] **Step 4: Record and commit**

Append secret-free history records, stage only intended files, inspect the staged diff, and commit with:

```powershell
& 'D:\dev\git\cmd\git.exe' commit -m 'feat: sync AIHub desktop user features'
```

- [ ] **Step 5: Push and verify**

Push `main` to `origin`, then compare local `HEAD` with `git ls-remote origin refs/heads/main`. Expected: identical hashes.
