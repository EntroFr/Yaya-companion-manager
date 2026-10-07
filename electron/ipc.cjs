const { ipcMain } = require('electron')

function registerDataIPC(service, methods) {
  const clients = new Set()
  let queue = Promise.resolve()
  for (const method of methods) {
    ipcMain.handle(`yaya:data:${method}`, (event, ...args) => {
      // 只允许已注册窗口的顶层 Renderer；不给任意页面、iframe 或 SQL 入口。
      const client = [...clients].find(c => c.contents === event.sender)
      if (!client || event.senderFrame !== event.sender.mainFrame || !client.allowed(event.senderFrame.url)) return { ok: false, message: '该页面无权访问测试数据库。' }
      const operation = queue.then(async () => { try {
        const value = await service.execute(method, args)
        if (service.lastChanged) for (const c of clients) if (!c.contents.isDestroyed()) c.contents.send('yaya:data:changed')
        return { ok: true, value }
      } catch (error) {
        console.error(`SQLite ${method}：`, error.message)
        return { ok: false, message: error.code === 'ERR_SQLITE_ERROR' ? '数据库操作失败，事务已回滚，请重试。' : error.message || '数据操作失败，未保存。' }
      } })
      queue = operation.catch(() => {})
      return operation
    })
  }
  return {
    whenIdle() { return queue },
    attach(win, target) {
      for (const existing of clients) if (existing.contents === win.webContents) clients.delete(existing)
      const base = new URL(target)
      const client = { contents: win.webContents, allowed(url) { try { const u = new URL(url); return u.origin === base.origin && u.pathname === base.pathname && u.search === base.search } catch { return false } } }
      clients.add(client); win.once('closed', () => clients.delete(client))
    },
    dispose() { for (const method of methods) ipcMain.removeHandler(`yaya:data:${method}`); clients.clear() },
  }
}
module.exports = { registerDataIPC }
