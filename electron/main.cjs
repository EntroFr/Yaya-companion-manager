const { app, BrowserWindow, dialog } = require('electron')
const path = require('node:path')
const { createWindow } = require('./window.cjs')
const fs = require('node:fs')
if (require('./squirrel-lifecycle.cjs').handleSquirrelLifecycle({ app })) return
app.setAppUserModelId('com.squirrel.YayaDiary.YayaDiary')

app.setName('Yaya的陪玩日记')
const devUrl = !app.isPackaged ? process.env.YAYA_DEV_URL : undefined
if (devUrl && !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(devUrl)) throw new Error('开发地址必须为本机 Vite 地址。')
// 开发与本地构建模式独立保存，均不访问外部浏览器的用户资料目录。
const storageMode = app.isPackaged ? 'sqlite' : process.env.YAYA_STORAGE_MODE ?? 'local-storage'
if (!['local-storage', 'sqlite-test', 'sqlite'].includes(storageMode)) throw new Error('未知存储模式，已停止启动。')
const rootDirectory = path.join(app.getPath('appData'), 'Yaya-companion-manager')
const dataDirectory = path.join(rootDirectory, storageMode === 'sqlite' ? 'sqlite' : storageMode === 'sqlite-test' ? 'sqlite-test' : devUrl ? 'development' : 'local-build')
app.setPath('userData', dataDirectory)
let mainWindow
let sqliteService, dataIPC, migrationManager, desktop, backupManager
async function openWindow() {
  const { win, ready } = createWindow({ devUrl, storageMode, beforeLoad: (window, target) => dataIPC?.attach(window, target) })
  mainWindow = win
  win.on('closed', () => { mainWindow = null })
  await ready
  win.show()
  console.info('Electron 窗口已加载：', win.webContents.getURL())
  console.info('数据模式：', storageMode)
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { const win = BrowserWindow.getAllWindows()[0]; if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
  app.whenReady().then(async () => {
    if (storageMode !== 'local-storage') {
      fs.mkdirSync(dataDirectory, { recursive: true })
      const { SQLiteService, BUSINESS_METHODS, MigrationManager, DesktopDataService, MIGRATION_METHODS, openFormalDatabase, BackupManager, MANAGEMENT_METHODS, recoverInterruptedRestore, backupName } = require('../.electron-main/sqlite-service.cjs')
      const { registerDataIPC } = require('./ipc.cjs')
      const formalFile = path.join(rootDirectory, 'sqlite', 'yaya-companion.db')
      const databaseFile = storageMode === 'sqlite' ? formalFile : path.join(app.getPath('userData'), 'yaya-companion-test.db')
      if(storageMode === 'sqlite') recoverInterruptedRestore(databaseFile,dataDirectory)
      sqliteService = storageMode === 'sqlite' ? openFormalDatabase(databaseFile,true) : new SQLiteService(databaseFile)
      migrationManager = new MigrationManager(app.getPath('userData'), formalFile, storageMode, undefined, storageMode === 'sqlite' ? candidate => backupManager.replace(candidate) : undefined)
      desktop = new DesktopDataService(sqliteService,migrationManager)
      backupManager = new BackupManager(desktop,databaseFile,dataDirectory,app.getVersion())
      const { managementService } = require('./management.cjs')
      dataIPC = registerDataIPC(managementService(desktop,backupManager,()=>mainWindow,dataDirectory,storageMode,backupName), [...BUSINESS_METHODS, ...MIGRATION_METHODS, ...MANAGEMENT_METHODS])
      console.info('SQLite 数据库：', databaseFile)
    }
    await openWindow()
    app.on('activate', () => { if (!mainWindow) void openWindow() })
  }).catch(error => { dialog.showErrorBox('应用启动失败', error.message); app.quit() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  let quitting = false
  app.on('before-quit', event => {
    if (!dataIPC || quitting) return
    event.preventDefault()
    void dataIPC.whenIdle().finally(() => { quitting = true; app.quit() })
  })
  app.on('will-quit', () => { dataIPC?.dispose(); backupManager?.dispose(); migrationManager?.dispose(); (desktop?.service ?? sqliteService)?.close() })
}
