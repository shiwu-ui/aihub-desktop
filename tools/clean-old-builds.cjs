const fs = require('node:fs')
const path = require('node:path')

const projectDir = path.resolve(__dirname, '..')
const distDir = path.join(projectDir, 'dist')
const { version } = require(path.join(projectDir, 'package.json'))

if (!fs.existsSync(distDir)) process.exit(0)

const artifactPattern = /^AIHub-Desktop-(\d+\.\d+\.\d+)(?:-|\.|$)/
const removed = []

for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
  const match = artifactPattern.exec(entry.name)
  if (!match || match[1] === version) continue

  try {
    fs.rmSync(path.join(distDir, entry.name), { recursive: true, force: true })
    removed.push(entry.name)
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES') {
      console.warn(`Skipped locked old build artifact: ${entry.name}`)
      continue
    }
    throw error
  }
}

if (removed.length) {
  console.log(`Removed ${removed.length} old build artifact(s):`)
  for (const name of removed) console.log(`- ${name}`)
} else {
  console.log(`No build artifacts older than ${version} were found.`)
}
