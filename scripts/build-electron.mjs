import { build } from 'vite'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
export async function buildElectron() {
  const check = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.electron.json'], { stdio: 'inherit' })
  if (check.status !== 0) throw new Error('Electron 数据层 TypeScript 检查失败。')
  await build({ configFile: false, build: { ssr: 'electron/sqlite/index.ts', outDir: '.electron-main', rollupOptions: { output: { format: 'cjs', entryFileNames: 'sqlite-service.cjs' } } } })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildElectron()
