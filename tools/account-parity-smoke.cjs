'use strict'

const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

async function run() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'aihub-account-parity-'))
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${path.join(sandbox, 'electron')}`], cwd: root })
  try {
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForSelector('#login-view:not(.hidden)')
    await page.evaluate(async () => {
      document.querySelector('#login-view').classList.add('hidden')
      document.querySelector('#app-view').classList.remove('hidden')
      window.__accountCalls = []
      window.__failRemoveAvatar = false
      const profile = { id: 601, username: 'fixture-user', email: 'primary.fixture@example.invalid', avatar_url: '', balance: 42.5, concurrency: 12, status: 'active', balance_notify_enabled: false, balance_notify_threshold: 0, balance_notify_extra_emails: [] }
      request = async (route, options = {}) => {
        window.__accountCalls.push({ route, method: options.method || 'GET', body: options.body })
        if (route === '/user/profile') return profile
        if (route === '/user' && options.method === 'PUT') {
          if (window.__failRemoveAvatar && options.body.avatar_url === '') throw new Error('avatar removal unavailable')
          return Object.assign(profile, options.body)
        }
        if (['/user/account-bindings/email/send-code', '/user/account-bindings/email', '/user/notify-email/send-code', '/user/notify-email/verify'].includes(route)) return { ok: true }
        if (route === '/user/aff') return { aff_code: 'fixture code/100%', aff_count: 2, aff_quota: 7.5, aff_history_quota: 11.25, aff_frozen_quota: 1.75, effective_rebate_rate_percent: 15, invitees: [{ user_id: 702, username: 'invited-fixture', email: 'invitee.fixture@example.invalid', total_rebate: 3.125, created_at: '2026-07-28T00:00:00Z', direct_rebate: 2.5, bonus_rebate: '0.625 USD' }] }
        throw new Error(`Unexpected route: ${route}`)
      }
      await navigate('account')
    })

    await page.waitForSelector('.account-page')
    const avatar = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 256
      const context = canvas.getContext('2d')
      const image = context.createImageData(256, 256)
      let seed = 123456789
      for (let index = 0; index < image.data.length; index += 4) {
        seed = (seed * 1664525 + 1013904223) >>> 0
        image.data[index] = seed & 255
        image.data[index + 1] = (seed >>> 8) & 255
        image.data[index + 2] = (seed >>> 16) & 255
        image.data[index + 3] = 255
      }
      context.putImageData(image, 0, 0)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      const result = await compressAvatar(new File([blob], 'fixture.png', { type: 'image/png' }))
      return { sourceBytes: blob.size, prefix: result.slice(0, 23), bytes: new TextEncoder().encode(result).length }
    })
    assert.ok(avatar.sourceBytes > 20480, JSON.stringify(avatar))
    assert.equal(avatar.prefix, 'data:image/webp;base64,')
    assert.ok(avatar.bytes <= 20480, JSON.stringify(avatar))

    const oversizedGif = await page.evaluate(async () => {
      try {
        const result = await compressAvatar(new File([new Uint8Array(15360)], 'oversized-data-url.gif', { type: 'image/gif' }))
        return { accepted: true, bytes: new TextEncoder().encode(result).length }
      } catch (error) {
        return { accepted: false, message: error.message }
      }
    })
    assert.equal(oversizedGif.accepted, false, JSON.stringify(oversizedGif))

    await page.evaluate(() => { window.__failRemoveAvatar = true })
    await page.locator('[data-action="remove-avatar"]').click()
    await page.waitForSelector('.toast.error')
    assert.equal(await page.locator('[data-action="remove-avatar"]').isEnabled(), true)
    await page.evaluate(() => { window.__failRemoveAvatar = false })
    await page.locator('[data-action="remove-avatar"]').click()
    const invalidPrimaryCalls = await page.evaluate(() => window.__accountCalls.filter((call) => call.route === '/user/account-bindings/email/send-code').length)
    await page.locator('#primary-email-form [name="email"]').fill('not-an-email')
    await page.locator('[data-action="send-primary-email-code"]').click()
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    assert.equal(await page.evaluate(() => window.__accountCalls.filter((call) => call.route === '/user/account-bindings/email/send-code').length), invalidPrimaryCalls)
    const emailForm = page.locator('#primary-email-form')
    await emailForm.locator('[name="email"]').fill('primary.fixture@example.invalid')
    await page.locator('[data-action="send-primary-email-code"]').click()
    await emailForm.locator('[name="verify_code"]').fill('123456')
    await emailForm.locator('[name="password"]').fill('fixture-password-123')
    await emailForm.locator('button[type="submit"]').click()

    await page.locator('[data-action="toggle-balance-notify"]').click()
    const balanceForm = page.locator('#balance-notify-form')
    await balanceForm.locator('[name="threshold"]').fill('12.5')
    await balanceForm.locator('button[type="submit"]').click()

    const extraForm = page.locator('#extra-email-form')
    const invalidExtraCalls = await page.evaluate(() => window.__accountCalls.filter((call) => call.route === '/user/notify-email/send-code').length)
    await extraForm.locator('[name="email"]').fill('also-not-an-email')
    await page.locator('[data-action="send-extra-email-code"]').click()
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    assert.equal(await page.evaluate(() => window.__accountCalls.filter((call) => call.route === '/user/notify-email/send-code').length), invalidExtraCalls)
    await extraForm.locator('[name="email"]').fill('notify.fixture@example.invalid')
    await page.locator('[data-action="send-extra-email-code"]').click()
    await extraForm.locator('[name="code"]').fill('654321')
    await extraForm.locator('button[type="submit"]').click()

    const calls = await page.evaluate(() => window.__accountCalls)
    const hasCall = (route, method, body) => calls.some((call) => call.route === route && call.method === method && JSON.stringify(call.body) === JSON.stringify(body))
    assert.ok(hasCall('/user', 'PUT', { avatar_url: '' }))
    assert.ok(hasCall('/user/account-bindings/email/send-code', 'POST', { email: 'primary.fixture@example.invalid' }))
    assert.ok(hasCall('/user/account-bindings/email', 'POST', { email: 'primary.fixture@example.invalid', verify_code: '123456', password: 'fixture-password-123' }))
    assert.ok(hasCall('/user', 'PUT', { balance_notify_enabled: true }))
    assert.ok(hasCall('/user', 'PUT', { balance_notify_threshold: 12.5 }))
    assert.ok(hasCall('/user/notify-email/send-code', 'POST', { email: 'notify.fixture@example.invalid' }))
    assert.ok(hasCall('/user/notify-email/verify', 'POST', { email: 'notify.fixture@example.invalid', code: '654321' }))
    const accountText = await page.locator('#content').textContent()
    assert.doesNotMatch(accountText, /LinuxDo|DingTalk|OIDC|WeChat|两步验证|2FA|TOTP/i)

    await page.evaluate(() => navigate('affiliate'))
    await page.waitForSelector('.affiliate-page')
    const affiliateText = await page.locator('#content').textContent()
    ;['冻结返利', '15%', 'direct_rebate', 'bonus_rebate', '0.625 USD'].forEach((value) => assert.ok(affiliateText.includes(value), `affiliate missing: ${value}`))
    assert.equal(await page.locator('[data-action="copy-affiliate-code"]').count(), 1)
    assert.equal(await page.locator('[data-action="copy-affiliate-link"]').count(), 1)
    assert.equal(await page.locator('#affiliate-code').inputValue(), 'fixture code/100%')
    assert.equal(await page.locator('#affiliate-link').inputValue(), 'https://aihub.top/register?aff=fixture%20code%2F100%25')

    await page.setViewportSize({ width: 980, height: 680 })
    const overflow = await page.evaluate(() => ({ body: document.documentElement.scrollWidth - document.documentElement.clientWidth, content: document.querySelector('#content').scrollWidth - document.querySelector('#content').clientWidth }))
    assert.ok(overflow.body <= 1 && overflow.content <= 1, JSON.stringify({ overflow }))
    assert.equal(errors.length, 0, JSON.stringify({ errors }))
    console.log(JSON.stringify({ ok: true, avatar: true, email: true, balanceNotify: true, extraEmail: true, affiliate: true, noThirdPartyOr2FA: true, overflow }))
  } finally {
    await app.close()
    await fs.rm(sandbox, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
