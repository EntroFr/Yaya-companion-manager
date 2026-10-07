import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { build } from 'vite'
import { buildElectron } from './build-electron.mjs'
const require = createRequire(import.meta.url)
const check = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-b'], { stdio: 'inherit' })
if (check.status !== 0) process.exit(check.status ?? 1)
await build()
await buildElectron()
const env = { ...process.env }
delete env.YAYA_DEV_URL
env.YAYA_STORAGE_MODE = process.argv.includes('--sqlite') ? 'sqlite' : process.argv.includes('--sqlite-test') ? 'sqlite-test' : 'local-storage'
const child = spawn(process.execPath, [require.resolve('@electron-forge/cli/dist/electron-forge.js'), 'start'], { stdio: 'inherit', env })
child.once('error', error => { console.error(error); process.exitCode = 1 })
child.once('exit', code => { process.exitCode = code ?? 0 })
function stop() {
  if (child.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else child.kill()
  }
}
process.once('SIGINT', stop); process.once('SIGTERM', stop)
