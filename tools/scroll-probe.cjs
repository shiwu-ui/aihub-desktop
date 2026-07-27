const { _electron: electron } = require('playwright-core')

async function run() {
  const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: process.cwd() })
  const page = await app.firstWindow()
  await page.waitForSelector('#content', { state: 'attached' })
  const before = await page.evaluate(() => {
    document.querySelector('#boot').classList.add('hidden')
    document.querySelector('#login-view').classList.add('hidden')
    document.querySelector('#app-view').classList.remove('hidden')
    const content = document.querySelector('#content')
    content.innerHTML = '<div style="height:2400px"><canvas id="probe-canvas" width="800" height="500"></canvas></div>'
    return {
      clientHeight: content.clientHeight,
      scrollHeight: content.scrollHeight,
      overflowY: getComputedStyle(content).overflowY,
    }
  })
  const canvas = await page.locator('#probe-canvas').boundingBox()
  await page.mouse.move(canvas.x + 100, canvas.y + 100)
  await page.mouse.wheel(0, 640)
  await page.waitForTimeout(150)
  const after = await page.$eval('#content', (element) => element.scrollTop)
  console.log(JSON.stringify({ ...before, scrollTopAfterWheel: after }))
  await app.close()
  if (before.scrollHeight <= before.clientHeight || after <= 0) process.exitCode = 1
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
