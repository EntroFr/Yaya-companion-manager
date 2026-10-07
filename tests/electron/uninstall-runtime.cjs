const { app, ipcMain } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createWindow } = require('../../electron/window.cjs')
const { registerUninstallIPC } = require('../../electron/uninstall.cjs')
const { openFormalDatabase, BUSINESS_METHODS } = require('../../.electron-main/sqlite-service.cjs')
const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(app.getPath('temp'), 'yaya-uninstall-ui-')))
app.setPath('userData', path.join(directory, 'renderer'))
let win, dataIPC, uninstallIPC, service, launches = 0, quits = 0, fail = true
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(js) { for (let i = 0; i < 100; i++) { if (await win.webContents.executeJavaScript(js)) return; await wait(50) } throw Error('卸载界面检查超时：' + js) }
app.whenReady().then(async () => {
  const programDirectory = path.join(directory, 'portable'), appData = path.join(directory, 'appData')
  const plan = { programDirectory, exe: path.join(programDirectory, 'YayaDiary.exe'), appData, dataDirectory: path.join(appData, 'Yaya-companion-manager'), home: path.join(directory, 'home'), desktop: path.join(directory, 'desktop'), temp: directory, startMenu: path.join(directory, 'programs') }
  fs.mkdirSync(path.join(programDirectory, 'resources', 'app.asar'), { recursive: true }); fs.writeFileSync(plan.exe, 'fixture')
  fs.writeFileSync(path.join(programDirectory, 'resources', 'app.asar', 'package.json'), JSON.stringify({ name: 'yaya-companion-manager', main: 'electron/main.cjs' }))
  service = openFormalDatabase(path.join(directory, 'formal.db'), true)
  dataIPC = require('../../electron/ipc.cjs').registerDataIPC(service, BUSINESS_METHODS)
  // 本测试只替换执行器，不能删除任何实际程序或用户数据。
  uninstallIPC = registerUninstallIPC({ app: { isPackaged: true, getPath: () => directory }, ipcMain, whenIdle: () => dataIPC.whenIdle(), makePlan: () => plan, parentStart: () => '0', launch: async () => { if (fail) throw Error('测试：helper 启动失败'); launches++ }, quit: () => { quits++ } })
  const created = createWindow({ show: false, storageMode: 'sqlite', indexFile: path.resolve('dist/index.html'), beforeLoad: (w, target) => { dataIPC.attach(w, target); uninstallIPC.attach(w, target) } }); win = created.win; await created.ready
  const execute = js => win.webContents.executeJavaScript(js, true)
  async function click(text) { assert.equal(await execute(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}); if(!b||b.disabled)return false;b.click();return true})()`), true, text); await wait(80) }
  await execute("location.hash='#other'"); await until("document.body.textContent.includes('卸载丫丫的陪玩日记')")
  async function open() { await click('卸载丫丫的陪玩日记'); await until("document.querySelector('[role=dialog]')?.textContent.includes('你真的要卸载这本小小的日记吗？')") }
  async function second() { await open(); await click('是的我自己记也可以'); await until("document.querySelector('[role=dialog]')?.textContent.includes('你又要离开我了对吗？')") }
  async function third() { await second(); await click('嗯。'); await until("document.querySelector('[role=dialog]')?.textContent.includes('真的要走吗？')") }
  await open(); assert.equal(await execute("document.querySelector('.uninstall-image').complete && document.querySelector('.uninstall-image').naturalWidth>0"), true)
  await click('骗你的我才舍不得呢'); assert.equal(await execute("!!document.querySelector('[role=dialog]')"), false)
  for (const cancel of ['不是的！我们和好！', '我才不会不会离开你呢！']) { await second(); await click(cancel); assert.equal(await execute("!!document.querySelector('[role=dialog]')"), false) }
  await third(); assert.equal(await execute("document.querySelector('.uninstall-image').complete && document.querySelector('.uninstall-image').naturalWidth>0"), true, 'AVIF 图片解码')
  assert.equal(await execute("document.body.textContent.includes('这将删除程序文件、快捷方式以及本机保存的数据（数据库、自动备份、Excel 日报），且不可恢复。')"), true)
  await click('你好好哄哄我我们就和好！'); assert.equal(await execute("document.body.textContent.includes('给我发个平底锅我就知道啦！')"), true); assert.equal(launches, 0)
  await third(); await click('我真的走了，以后的日子照顾好自己。'); await until("document.body.textContent.includes('测试：helper 启动失败')"); assert.equal(quits, 0); assert.equal(fs.existsSync(plan.exe), true)
  await click('关闭'); fail = false; await third(); await click('我真的走了，以后的日子照顾好自己。'); await wait(300)
  assert.equal(launches, 1); assert.equal(quits, 1); assert.equal(fs.existsSync(plan.exe), true)
  await win.webContents.reload(); await until("document.body.textContent.includes('卸载丫丫的陪玩日记')")
  assert.equal(await execute("!!document.querySelector('[role=dialog]')"), false)
  console.info('Electron 卸载隔离检查通过：三次确认、全部取消、图片、失败保留、最终触发；未执行真实卸载。')
  win.destroy(); await wait(100); await dataIPC.whenIdle(); uninstallIPC.dispose(); dataIPC.dispose(); service.close(); app.exit(0)
}).catch(error => { console.error(error); uninstallIPC?.dispose(); dataIPC?.dispose(); service?.close(); app.exit(1) })
