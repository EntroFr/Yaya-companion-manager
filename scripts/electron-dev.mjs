import { createServer } from 'vite'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { buildElectron } from './build-electron.mjs'
const require = createRequire(import.meta.url)
let server, child, stopping = false
async function stop(code = 0) {
  if (stopping) return
  stopping = true
  if (child && child.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else child.kill()
  }
  await server?.close()
  process.exitCode = code
}
try {
  await buildElectron()
  // 固定端口确保每次开发启动都使用同一 Electron localStorage 来源。
  server = await createServer({ server: { host: '127.0.0.1', port: 5177, strictPort: true } })
  await server.listen()
  server.printUrls()
  child = spawn(process.execPath, [require.resolve('@electron-forge/cli/dist/electron-forge.js'), 'start'], {
    stdio: 'inherit', env: { ...process.env, YAYA_DEV_URL: 'http://127.0.0.1:5177/', YAYA_STORAGE_MODE: process.argv.includes('--sqlite') ? 'sqlite' : process.argv.includes('--sqlite-test') ? 'sqlite-test' : 'local-storage' },
  })
  child.once('error', error => { console.error(error); void stop(1) })
  child.once('exit', code => { void stop(code ?? 0) })
  process.once('SIGINT', () => { void stop() }); process.once('SIGTERM', () => { void stop() })
} catch (error) { console.error('桌面开发启动失败：', error.message); await stop(1) }
