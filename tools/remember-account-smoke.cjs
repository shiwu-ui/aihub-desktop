const { _electron: electron } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const profile = path.join(root, '.remember-account-test')

async function run() {
  fs.rmSync(profile, { recursive: true, force: true })
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ rememberedEmail: 'saved@example.com' }),
  )

  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', `--user-data-dir=${profile}`],
    cwd: root,
  })

  try {
    const page = await app.firstWindow()
    await page.waitForSelector('#login-view:not(.hidden)')
    const browserWindow = await app.browserWindow(page)
    const visible = await browserWindow.evaluate((window) => window.isVisible())
    const startupLog = fs.readFileSync(path.join(profile, 'startup.log'), 'utf8')
    const result = await page.locator('#login-form').evaluate((form) => ({
      email: form.querySelector('#login-email').value,
      checked: form.querySelector('#remember-account').checked,
      password: form.querySelector('#login-password').value,
    }))
    console.log(JSON.stringify({ ...result, visible, startupLogged: startupLog.includes('window.load.finished') }))
    if (result.email !== 'saved@example.com' || !result.checked || result.password !== '' || !visible || !startupLog.includes('window.load.finished')) {
      throw new Error('Remembered account was not restored correctly')
    }
  } finally {
    await app.close()
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
