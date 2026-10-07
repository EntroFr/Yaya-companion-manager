const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { createWindow } = require('../../electron/window.cjs')
const sqlite = process.env.YAYA_SMOKE_SQLITE === '1'
const formal = process.env.YAYA_SMOKE_FORMAL === '1'
const directory = process.env.YAYA_SMOKE_DIRECTORY ?? fs.mkdtempSync(path.join(app.getPath('temp'), 'yaya-electron-smoke-'))
app.setPath('userData', directory)
let service, ipc, migration, desktop, backupManager
async function waitFor(win, expression) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const result = await win.webContents.executeJavaScript(expression)
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('桌面页面检查超时')
}
async function reload(win) {
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload() })
}
app.whenReady().then(async () => {
  const indexFile = path.resolve('.electron-smoke/tests/electron/smoke.html')
  if (sqlite) {
    const { SQLiteService, BUSINESS_METHODS, MigrationManager, DesktopDataService, MIGRATION_METHODS, openFormalDatabase } = require('../../.electron-main/sqlite-service.cjs')
    service = formal ? openFormalDatabase(process.env.YAYA_SMOKE_FORMAL_FILE) : new SQLiteService(path.join(directory, 'yaya-companion-test.db'))
    migration = new MigrationManager(directory, process.env.YAYA_SMOKE_FORMAL_FILE, formal ? 'sqlite' : 'sqlite-test')
    desktop = new DesktopDataService(service,migration)
    const {BackupManager, MANAGEMENT_METHODS,backupName}=require('../../.electron-main/sqlite-service.cjs')
    backupManager=new BackupManager(desktop,process.env.YAYA_SMOKE_FORMAL_FILE,directory,'1.1.2')
    const pickers={showSaveDialog:async()=>({canceled:false,filePath:path.join(directory,'electron-backup.db')}),showOpenDialog:async()=>({canceled:false,filePaths:[path.join(directory,'electron-backup.db')]})}
    const managed=require('../../electron/management.cjs').managementService(desktop,backupManager,()=>undefined,directory,formal?'sqlite':'sqlite-test',backupName,pickers)
    ipc = require('../../electron/ipc.cjs').registerDataIPC(managed, [...BUSINESS_METHODS, ...MIGRATION_METHODS,...MANAGEMENT_METHODS])
    console.log('Electron SQLite 驱动：', process.versions.node, service.database.prepare('SELECT sqlite_version() AS v').get().v)
  }
  const { win, ready } = createWindow({ show: false, indexFile, initialHash: process.env.YAYA_SMOKE_REOPEN === '1' ? 'restored' : undefined, storageMode: formal ? 'sqlite' : sqlite ? 'sqlite-test' : 'local-storage', beforeLoad: (window, target) => ipc?.attach(window, target) })
  await ready
  const result = JSON.parse(await waitFor(win, "document.getElementById('electron-smoke-result')?.textContent"))
  if (!result.ok) throw new Error(result.error)
  const preferences = win.webContents.getLastWebPreferences()
  if (!preferences.contextIsolation || preferences.nodeIntegration || !preferences.sandbox) throw new Error('安全配置异常')
  console.log(JSON.stringify(result))
  if (!sqlite) fs.writeFileSync(process.env.YAYA_SMOKE_EXPORT_FILE, await waitFor(win, "document.getElementById('migration-export')?.textContent"), 'utf8')
  if (sqlite && !formal && process.env.YAYA_SMOKE_REOPEN !== '1') {
    const text = fs.readFileSync(process.env.YAYA_SMOKE_EXPORT_FILE,'utf8'), before = JSON.stringify(service.snapshot())
    const reply = await win.webContents.executeJavaScript(`window.yayaDesktop.repositories.migration.prepare(${JSON.stringify(text)})`)
    if (!reply.ok || !reply.value.passed) throw new Error(reply.message || 'IPC迁移对账失败')
    const duplicate = await win.webContents.executeJavaScript(`window.yayaDesktop.repositories.migration.prepare(${JSON.stringify(text)})`)
    if (duplicate.ok || !duplicate.message.includes('重复导入')) throw new Error('IPC重复导入未被阻止')
    ipc.attach(win, require('node:url').pathToFileURL(path.resolve('dist/index.html')).href)
    await win.loadFile(path.resolve('dist/index.html'), { hash: 'migration' })
    await waitFor(win, "document.querySelectorAll('.migration-report tbody tr').length >= 31")
    fs.writeFileSync(path.resolve('.electron-smoke/migration-report.png'), (await win.webContents.capturePage()).toPNG())
    const activate = await win.webContents.executeJavaScript(`window.yayaDesktop.repositories.migration.activate(${JSON.stringify(reply.value.token)})`)
    if (!activate.ok || JSON.stringify(service.snapshot()) !== before) throw new Error(activate.message || '迁移修改了测试库')
    console.log('Renderer IPC：迁移导入、完整对账、重复保护、正式库启用通过；测试库不变')
  }
  if (sqlite) ipc.attach(win, require('node:url').pathToFileURL(indexFile).href)
  await win.loadFile(indexFile, { hash: 'restored' })
  await reload(win)
  const restored = JSON.parse(await waitFor(win, "document.getElementById('electron-smoke-result')?.textContent"))
  if (!restored.ok) throw new Error(restored.error)
  console.log(JSON.stringify(restored))
  // 检查真正的生产 dist，不需要 localhost 或测试入口。
  for (const hash of ['dashboard', 'bosses', 'bosses/ELECTRON-SMOKE', 'statistics', 'migration']) {
    if (sqlite) ipc.attach(win, require('node:url').pathToFileURL(path.resolve('dist/index.html')).href)
    await win.loadFile(path.resolve('dist/index.html'), { hash })
    console.log('本地页面：', await waitFor(win, "document.querySelector('main h1')?.textContent"))
    await reload(win)
    await waitFor(win, "document.querySelector('main h1')?.textContent")
    if (hash.includes('/')) await waitFor(win, "document.getElementById('boss-detail-title')?.textContent")
    if (hash === 'statistics') await waitFor(win, "document.querySelectorAll('.statistics-card').length === 6")
  }
  await win.loadFile(path.resolve('dist/index.html'), { hash: 'statistics' })
  await waitFor(win, "document.querySelectorAll('.statistics-card').length === 6")
  if (formal && await win.webContents.executeJavaScript("window.yayaDesktop.mode") !== 'sqlite') throw new Error('正式模式数据源不正确')
  if (formal) {
    const clear = await win.webContents.executeJavaScript('window.yayaDesktop.repositories.development.clear()')
    if (clear.ok || !clear.message.includes('不提供')) throw new Error('正式模式仍允许清理测试数据')
    const notes = '正式模式重启检查'
    if (process.env.YAYA_SMOKE_FORMAL_REOPEN === '1' && service.snapshot().bosses[0].notes !== notes) throw new Error('正式模式写入在重启后丢失')
    const updated = await win.webContents.executeJavaScript(`window.yayaDesktop.repositories.bosses.update('ELECTRON-SMOKE', {nickname:'修改昵称',hourlyRateCents:3500,notes:${JSON.stringify(notes)}})`)
    if (!updated.ok) throw new Error(updated.message)
    console.log('正式模式：IPC写入与测试清理保护通过')
  }
  fs.writeFileSync(path.resolve(`.electron-smoke/statistics${formal ? '-formal' : sqlite ? '-sqlite' : ''}.png`), (await win.webContents.capturePage()).toPNG())
  console.log('Electron 本地加载、hash 路由与刷新检查通过；测试目录：', directory)
  if(formal && process.env.YAYA_SMOKE_FORMAL_REOPEN !== '1'){
    const backup=await win.webContents.executeJavaScript('window.yayaDesktop.repositories.management.backup()')
    if(!backup.ok || backup.value.entries<1)throw new Error(backup.message||'Electron备份失败')
    const preview=await win.webContents.executeJavaScript('window.yayaDesktop.repositories.management.inspectRestore()')
    if(!preview.ok)throw new Error(preview.message)
    const restored=await win.webContents.executeJavaScript(`window.yayaDesktop.repositories.management.restore(${JSON.stringify(preview.value.token)})`)
    if(!restored.ok || !fs.existsSync(restored.value.protectedBackup.path))throw new Error(restored.message||'Electron恢复保护失败')
    service=desktop.service
    await win.loadFile(path.resolve('dist/index.html'),{hash:'data'})
    await waitFor(win,"document.body.textContent.includes('数据库版本 4')")
    fs.writeFileSync(path.resolve('.electron-smoke/data-management.png'),(await win.webContents.capturePage()).toPNG())
    console.log('正式模式：Renderer IPC备份、恢复、自动保护及数据管理页面通过')
  }
  win.destroy(); ipc?.dispose(); backupManager?.dispose(); migration?.dispose(); (desktop?.service ?? service)?.close(); app.exit(0)
}).catch(error => { console.error(error); ipc?.dispose(); migration?.dispose(); service?.close(); app.exit(1) })
