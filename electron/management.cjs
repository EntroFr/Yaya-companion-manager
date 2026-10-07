const { dialog, shell, app } = require('electron')
const path = require('node:path')
// 文件路径只来自 Main 的原生文件选择窗口，Renderer 仅提交预览令牌。
function managementService(desktop, manager, window, directory, mode, backupName, pickers = dialog) {
  return {
    get lastChanged() { return desktop.lastChanged },
    async execute(method, args) {
      if (!method.startsWith('management.')) return desktop.execute(method,args)
      desktop.lastChanged = false
      if (mode !== 'sqlite') throw new Error('备份与恢复仅在 SQLite 正式模式可用。')
      if (method === 'management.info') return { ...manager.info(), packaged:app.isPackaged }
      if (method === 'management.openFolder') { const error=await shell.openPath(directory); if(error) throw new Error('无法打开数据文件夹：'+error); return }
      if (method === 'management.backup') {
        const selected = await pickers.showSaveDialog(window(),{ title:'备份数据', defaultPath:path.join(app.getPath('documents'),backupName()), filters:[{name:'陪玩日记数据库备份',extensions:['db']}] })
        return selected.canceled || !selected.filePath ? null : manager.backup(selected.filePath)
      }
      if (method === 'management.inspectRestore') {
        const selected=await pickers.showOpenDialog(window(),{title:'选择数据库备份',properties:['openFile'],filters:[{name:'数据库备份',extensions:['db']}]})
        return selected.canceled ? null : manager.inspect(selected.filePaths[0])
      }
      if (method === 'management.restore') { const result=await manager.restore(args[0]); desktop.lastChanged=true; return result }
      if (method === 'management.cancelRestore') return manager.cancel()
      throw new Error('未知数据管理操作。')
    },
  }
}
module.exports={managementService}
