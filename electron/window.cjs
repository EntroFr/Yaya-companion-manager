const { BrowserWindow, app } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

function createWindow({ devUrl, show = true, indexFile = path.join(__dirname, '../dist/index.html'), storageMode = 'local-storage', beforeLoad, initialHash } = {}) {
  const win = new BrowserWindow({
    title: 'Yaya的陪玩日记', icon: path.join(__dirname, app.isPackaged ? '../dist/brand/app-icon.ico' : '../public/brand/app-icon.ico'), width: 1200, height: 800, minWidth: 760, minHeight: 600,
    show: false, backgroundColor: '#fff8fb', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, additionalArguments: [`--yaya-storage=${storageMode}`, ...(app.isPackaged ? ['--yaya-packaged'] : [])] },
  })
  const target = devUrl ?? pathToFileURL(indexFile).href
  beforeLoad?.(win, target)
  const allowed = url => { try { const a = new URL(url), b = new URL(target); return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search } catch { return false } }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
  win.webContents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault() })
  win.webContents.on('will-attach-webview', event => event.preventDefault())
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  win.webContents.session.setPermissionCheckHandler(() => false)
  if (show) win.once('ready-to-show', () => win.show())
  const ready = devUrl ? win.loadURL(devUrl) : win.loadFile(indexFile, initialHash ? { hash: initialHash } : {})
  return { win, ready }
}
module.exports = { createWindow }
