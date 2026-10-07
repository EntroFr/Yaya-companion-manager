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
    const {BackupManager, MANAGEMENT_METHODS,backupName,AutoBackupManager,DailyExportManager}=require('../../.electron-main/sqlite-service.cjs')
    backupManager=new BackupManager(desktop,process.env.YAYA_SMOKE_FORMAL_FILE,directory,'1.1.2')
    const pickers={showSaveDialog:async()=>({canceled:false,filePath:path.join(directory,'electron-backup.db')}),showOpenDialog:async()=>({canceled:false,filePaths:[path.join(directory,'electron-backup.db')]})}
    const autoRoot=path.join(directory,'auto-check'),mode=formal?'sqlite':'sqlite-test'
    const automatic=new AutoBackupManager(backupManager,autoRoot,mode)
    const autoInfo=await automatic.run()
    if(formal) {
      const assert=require('node:assert/strict'),autoDirectory=path.join(autoRoot,'backups','auto')
      assert.equal(autoInfo.error,null)
      const before=fs.readdirSync(autoDirectory).filter(n=>n.endsWith('.db'))
      await new AutoBackupManager(backupManager,autoRoot,mode).run()
      assert.deepEqual(fs.readdirSync(autoDirectory).filter(n=>n.endsWith('.db')),before)
      if(before.length!==1)throw Error('正式模式每日自动备份数量异常')
      console.log('Electron正式模式：在线自动备份与同日重启防重复通过')
    } else if(fs.existsSync(autoRoot))throw Error('测试模式不应创建正式自动备份')
    const daily=new DailyExportManager(path.join(directory,'export-check'),mode)
    await daily.load()
    if(formal){daily.request(desktop.service.snapshot());await daily.whenIdle();if(daily.info().error)throw Error(daily.info().error)}
    const managed=daily.wrap(require('../../electron/management.cjs').managementService(desktop,backupManager,()=>undefined,directory,mode,backupName,pickers,automatic,daily),()=>desktop.service.snapshot())
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
    await waitFor(win,"document.body.textContent.includes('每日 Excel：已开启') && document.body.textContent.includes('自动备份：已开启')")
    const call=async(group,method,...args)=>{const r=await win.webContents.executeJavaScript(`window.yayaDesktop.repositories.${group}.${method}(...${JSON.stringify(args)})`);if(!r.ok)throw Error(r.message);return r.value}
    await win.loadFile(path.resolve('dist/index.html'),{hash:'bosses'})
    await waitFor(win,"[...document.querySelectorAll('h3')].some(h=>h.textContent==='订单历史')")
    await win.webContents.executeJavaScript(`(()=>{for(const s of [...document.querySelectorAll('.balance-section')].filter(s=>['订单历史','全部余额流水'].includes(s.querySelector('h3')?.textContent))){if(s.querySelectorAll('tbody tr').length>3||s.querySelector('.history-toggle'))throw Error('3条以内不应显示展开按钮')}return true})()`)
    await call('balances','changeBalance','ELECTRON-SMOKE',{type:'recharge',amountCents:10000,notes:'历史界面检查'})
    for(let i=0;i<4;i++){const o=await call('orders','start','ELECTRON-SMOKE');await call('orders','complete',o.id)}
    await win.loadFile(path.resolve('dist/index.html'),{hash:'bosses'})
    await waitFor(win,"[...document.querySelectorAll('h3')].some(h=>h.textContent==='订单历史')")
    const result=await win.webContents.executeJavaScript(`(()=>{
      const sections=[...document.querySelectorAll('.balance-section')].filter(s=>s.querySelector('h3')?.textContent==='订单历史'||s.querySelector('h3')?.textContent==='全部余额流水');
      if(sections.length!==2)throw Error('历史区域缺失');
      for(const s of sections){const headers=s.querySelector('thead').textContent;if(headers.includes('订单 ID')||headers.includes('当时单价')||headers.includes('流水 ID'))throw Error('内部字段仍可见');if(s.querySelectorAll('tbody tr').length!==3)throw Error('默认未限制3条');const button=s.querySelector('.history-toggle');button.click()}
      return true
    })()`)
    if(!result)throw Error('历史界面检查失败')
    await waitFor(win,"[...document.querySelectorAll('.history-toggle')].filter(b=>b.textContent==='收起 ↑'&&b.closest('section').querySelectorAll('tbody tr').length>3).length===2")
    await win.webContents.executeJavaScript("[...document.querySelectorAll('.history-toggle')].forEach(b=>b.click());true")
    await waitFor(win,"[...document.querySelectorAll('.history-toggle')].every(b=>b.textContent==='展开全部 ↓'&&b.closest('section').querySelectorAll('tbody tr').length===3)")
    await win.webContents.executeJavaScript(`(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const input of document.querySelectorAll('.history-date input')){set.call(input,'2000-01-01');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))}return true})()`)
    await waitFor(win,"document.querySelectorAll('.history-toggle').length===0 && document.querySelectorAll('.history-table tbody tr').length===0")
    await ipc.whenIdle()
    const files=fs.readdirSync(path.join(directory,'export-check','exports','daily')).filter(n=>n.endsWith('.xlsx'))
    if(files.length!==1)throw Error('同日应只有一个 Excel 日报')
    const ExcelJS=require('exceljs'),report=new ExcelJS.Workbook();await report.xlsx.readFile(path.join(directory,'export-check','exports','daily',files[0]))
    if(report.getWorksheet('订单记录').rowCount<5)throw Error('业务保存后日报未更新')
    const reset=await call('management','inspectRestore');await call('management','restore',reset.token)
    console.log('正式模式：备份恢复、每日 Excel、历史最近3条及展开收起检查通过')
  }
  await ipc?.whenIdle();win.destroy(); ipc?.dispose(); backupManager?.dispose(); migration?.dispose(); (desktop?.service ?? service)?.close(); app.exit(0)
}).catch(error => { console.error(error); ipc?.dispose(); migration?.dispose(); service?.close(); app.exit(1) })
