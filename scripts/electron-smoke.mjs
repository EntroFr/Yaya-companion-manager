import { build } from 'vite'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildElectron } from './build-electron.mjs'
const require = createRequire(import.meta.url)
await buildElectron()
await build({ build: { outDir: '.electron-smoke', rollupOptions: { input: 'tests/electron/smoke.html' } } })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
async function run(extraEnv) {
  await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), ['tests/electron/runtime.cjs'], { stdio: 'inherit', env: { ...env, ...extraEnv } })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Electron 集成检查失败：${code}`)))
  })
}
const root = mkdtempSync(join(tmpdir(), 'yaya-electron-migration-'))
const shared = { YAYA_SMOKE_EXPORT_FILE: join(root,'migration-v1.json'), YAYA_SMOKE_FORMAL_FILE: join(root,'formal','yaya-companion.db') }
await run({ ...shared, YAYA_SMOKE_SQLITE: '0', YAYA_SMOKE_FORMAL: '0', YAYA_SMOKE_REOPEN: '0' })
const directory = join(root,'test')
await run({ ...shared, YAYA_SMOKE_SQLITE: '1', YAYA_SMOKE_FORMAL: '0', YAYA_SMOKE_DIRECTORY: directory, YAYA_SMOKE_REOPEN: '0' })
await run({ ...shared, YAYA_SMOKE_SQLITE: '1', YAYA_SMOKE_FORMAL: '0', YAYA_SMOKE_DIRECTORY: directory, YAYA_SMOKE_REOPEN: '1' })
await run({ ...shared, YAYA_SMOKE_SQLITE: '1', YAYA_SMOKE_FORMAL: '1', YAYA_SMOKE_DIRECTORY: join(root,'formal'), YAYA_SMOKE_REOPEN: '1' })
await run({ ...shared, YAYA_SMOKE_SQLITE: '1', YAYA_SMOKE_FORMAL: '1', YAYA_SMOKE_DIRECTORY: join(root,'formal'), YAYA_SMOKE_REOPEN: '1', YAYA_SMOKE_FORMAL_REOPEN: '1' })
await new Promise((resolve,reject)=>{
  const child=spawn(require('electron'),['tests/electron/billing-runtime.cjs'],{stdio:'inherit',env})
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Electron计费与提示音检查失败：${code}`)))
})
await new Promise((resolve,reject)=>{
  const child=spawn(require('electron'),['tests/electron/uninstall-runtime.cjs'],{stdio:'inherit',env})
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Electron 卸载隔离检查失败：${code}`)))
})

await new Promise((resolve,reject)=>{
  const child=spawn(require('electron'),['tests/electron/test-mode-runtime.cjs'],{stdio:'inherit',env})
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Electron 测试模式隔离检查失败：${code}`)))
})
