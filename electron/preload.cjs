'use strict'
const { contextBridge, ipcRenderer } = require('electron')
const mode = process.argv.includes('--yaya-storage=sqlite') ? 'sqlite' : process.argv.includes('--yaya-storage=sqlite-test') ? 'sqlite-test' : 'local-storage'
const api = { mode }
api.packaged = process.argv.includes('--yaya-packaged')
if (mode !== 'local-storage') {
  const methods = {
    bosses: ['list', 'create', 'update', 'remove'],
    balances: ['entries', 'changeBalance', 'clearDebt'],
    orders: ['list', 'start', 'settle', 'pause', 'resume', 'complete'],
    pauses: ['list', 'pause', 'resume'],
    tips: ['list', 'create', 'update', 'remove'],
    history: ['read'], statistics: ['read'], development: ['clear'],
    migration: ['status', 'exportData', 'prepare', 'activate', 'discard'],
    management: ['info', 'backup', 'inspectRestore', 'restore', 'cancelRestore', 'openFolder', 'openExports'],
  }
  api.repositories = {}
  for (const [group, names] of Object.entries(methods)) {
    api.repositories[group] = {}
    for (const name of names) api.repositories[group][name] = (...args) => ipcRenderer.invoke(`yaya:data:${group}.${name}`, ...args)
  }
  api.subscribe = callback => {
    const listener = () => callback()
    ipcRenderer.on('yaya:data:changed', listener)
    return () => ipcRenderer.removeListener('yaya:data:changed', listener)
  }
}
contextBridge.exposeInMainWorld('yayaDesktop', api)
