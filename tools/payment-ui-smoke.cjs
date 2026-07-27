const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8')
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8')
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(main.includes("'/payment'"), 'main-process payment allowlist is missing')
assert(!/request\(['"`]\/admin\//.test(app), 'renderer must not call admin routes')
assert(app.includes("request('/payment/checkout-info')"), 'checkout info is not loaded')
assert(app.includes("request('/payment/orders',"), 'order creation is not wired')
assert(app.includes("request('/payment/orders/verify'"), 'manual verification is not wired')
assert(app.includes("/payment/orders/${state.payment.activeOrder.order_id}/cancel"), 'order cancellation is not wired')
assert(app.includes("return_url: 'https://aihub.top/payment/result'"), 'official AIHub return URL is not used')
assert(app.includes("const base = 'https://aihub.top'"), 'official AIHub hosted payment routes are not used')
assert(html.includes('qrcode-generator/qrcode.js'), 'QR generator is not loaded')
assert(!app.includes('authorization: Bearer'), 'renderer must not embed a bearer token')
assert(!app.includes('sk-'), 'renderer must not embed API keys')

console.log('payment UI smoke checks passed')
