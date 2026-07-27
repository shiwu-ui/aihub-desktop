'use strict'

const { app, net, session } = require('electron')

app.whenReady().then(async () => {
  try {
    const target = 'https://aihub.top/api/v1/public/monitor/summary?timezone=Asia%2FShanghai'
    const proxy = await session.defaultSession.resolveProxy(target)
    const response = await net.fetch(target, {
      headers: { Accept: 'application/json', 'Accept-Language': 'zh-CN' },
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error(`AIHub returned HTTP ${response.status}`)
    const data = await response.json()
    if (!data || typeof data !== 'object') throw new Error('AIHub returned an invalid response')
    console.log(JSON.stringify({ ok: true, status: response.status, proxy: proxy || 'DIRECT' }))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
