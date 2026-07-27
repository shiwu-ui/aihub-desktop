'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const policyPath = path.join(root, 'src', 'security-policy.cjs')

assert.equal(
  fs.existsSync(policyPath),
  true,
  'main-process security policy helper should exist',
)

const { classifyExternalUrl, normalizeAllowedApiRoute } = require(policyPath)
const ALLOWED_PREFIXES = [
  '/auth/me',
  '/auth/revoke-all-sessions',
  '/user',
  '/keys',
  '/usage',
  '/announcements',
  '/redeem',
  '/payment',
  '/invoices',
  '/groups',
  '/public/monitor/summary',
  '/public/monitor/series',
]

const allowedRoutes = [
  ['/user', '/user'],
  ['/user/profile', '/user/profile'],
  ['/usage?from=2026-07-01&timezone=Asia%2FShanghai', '/usage?from=2026-07-01&timezone=Asia%2FShanghai'],
  ['/usage?next=https://payments.example/return', '/usage?next=https://payments.example/return'],
  ['/public/monitor/series/24h?provider=1', '/public/monitor/series/24h?provider=1'],
]

for (const [route, expected] of allowedRoutes) {
  assert.equal(normalizeAllowedApiRoute(route, ALLOWED_PREFIXES), expected, `expected route to be allowed: ${route}`)
}

const rejectedRoutes = [
  '/user/%2e%2e/internal',
  '/user/%252e%252e/internal',
  '/user/%61dmin',
  '/user/%2561dmin',
  '/user/account%2fadmin',
  '/user/account%252fadmin',
  '/user/account%5cadmin',
  '/user\\admin',
  '/usage#private',
  '//evil.example/user',
  'https://evil.example/user',
  '/users',
  '/usage-extra',
  '/subscriptions',
  '/subscriptions/current',
  '/user/%00profile',
  '/user/%zz',
]

for (const route of rejectedRoutes) {
  assert.equal(normalizeAllowedApiRoute(route, ALLOWED_PREFIXES), null, `expected route to be rejected: ${route}`)
}

assert.deepEqual(classifyExternalUrl('https://aihub.top/account'), {
  action: 'open',
  url: 'https://aihub.top/account',
})
assert.deepEqual(classifyExternalUrl('https://aihub.top:443/account'), {
  action: 'open',
  url: 'https://aihub.top/account',
})
assert.deepEqual(classifyExternalUrl('https://payments.example/checkout?id=1'), {
  action: 'confirm',
  url: 'https://payments.example/checkout?id=1',
})
assert.deepEqual(classifyExternalUrl('https://docs.aihub.top/guide'), {
  action: 'confirm',
  url: 'https://docs.aihub.top/guide',
})

for (const url of ['http://aihub.top', 'javascript:alert(1)', 'not a url', '', null]) {
  assert.deepEqual(classifyExternalUrl(url), { action: 'reject' }, `expected URL to be rejected: ${url}`)
}

const mainSource = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8')
assert.match(mainSource, /require\('\.\/security-policy\.cjs'\)/)
assert.match(mainSource, /const normalizedRoute = normalizeAllowedApiRoute\(route, ALLOWED_PREFIXES\)/)
assert.match(mainSource, /'\/public\/monitor\/series'/)
assert.doesNotMatch(mainSource, /'\/subscriptions'/)
assert.match(mainSource, /rawRequest\(normalizedRoute,/)
assert.match(mainSource, /async function openExternalUrl\(url\)/)
assert.match(mainSource, /await dialog\.showMessageBox\(mainWindow,/)
assert.match(mainSource, /setWindowOpenHandler\(\(\{ url \}\) => \{\s+void openExternalUrl\(url\)/)
assert.match(mainSource, /ipcMain\.handle\('app:open-external', async \(_event, url\) => openExternalUrl\(url\)\)/)

console.log(JSON.stringify({
  ok: true,
  allowedRoutes: allowedRoutes.length,
  rejectedRoutes: rejectedRoutes.length,
  externalUrlClasses: 9,
  mainIntegration: true,
}))
