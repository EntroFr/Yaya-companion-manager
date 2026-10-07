const path = require('node:path')
const { spawn } = require('node:child_process')

// 必须在单实例锁、数据库和窗口初始化之前执行。
function handleSquirrelLifecycle({ app, argv = process.argv, platform = process.platform, executable = process.execPath, launch = spawn, timeoutMs = 10000, log = console.error }) {
  if (platform !== 'win32') return false
  const event = argv.find(argument => /^--squirrel-(install|updated|uninstall|obsolete)$/.test(argument))
  if (!event) return false // --squirrel-firstrun 是正常应用启动。
  if (event === '--squirrel-obsolete') { app.exit(0); return true }
  const updater = path.resolve(path.dirname(executable), '..', 'Update.exe')
  const target = path.basename(executable)
  const operation = event === '--squirrel-uninstall' ? '--removeShortcut' : '--createShortcut'
  let finished = false, child, timer
  const finish = (code, message) => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    if (message) log(`[Squirrel lifecycle] ${event}: ${message}`)
    app.exit(code)
  }
  try {
    child = launch(updater, [`${operation}=${target}`], { windowsHide: true, stdio: 'ignore' })
    child.once('error', error => finish(1, error.message))
    child.once('close', code => finish(code === 0 ? 0 : 1, code === 0 ? undefined : `快捷方式操作失败，退出码 ${code}`))
    timer = setTimeout(() => {
      child.kill()
      finish(1, '快捷方式操作超时；已停止安装钩子，未启动业务应用。')
    }, timeoutMs)
  } catch (error) { finish(1, error.message) }
  return true
}
module.exports = { handleSquirrelLifecycle }
