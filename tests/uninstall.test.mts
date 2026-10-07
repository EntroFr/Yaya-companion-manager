import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { transitionUninstall } from '../src/features/uninstall/flow.ts'
const { validatePlan, helperScript, launchHelper, registerUninstallIPC } = createRequire(import.meta.url)('../electron/uninstall.cjs')
function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'yaya-uninstall-test-')))
  const programDirectory = path.join(root, 'Portable'), appData = path.join(root, 'appData')
  const plan = { programDirectory, appData, dataDirectory: path.join(appData, 'Yaya-companion-manager'), exe: path.join(programDirectory, 'YayaDiary.exe'), home: path.join(root, 'home'), desktop: path.join(root, 'desktop'), startMenu: path.join(root, 'programs'), temp: root, parentPid: 2147483647, parentStarted: '0', logFile: path.join(root, 'uninstall.log'), silent: true }
  for (const dir of [path.join(programDirectory, 'resources', 'app.asar'), plan.dataDirectory, plan.desktop, plan.startMenu]) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(programDirectory, 'resources', 'app.asar', 'package.json'), JSON.stringify({ name: 'yaya-companion-manager', main: 'electron/main.cjs' }))
  fs.writeFileSync(plan.exe, 'fixture'); fs.writeFileSync(path.join(plan.dataDirectory, 'data.db'), 'fixture')
  return plan
}
function runHelper(plan: object) {
  return spawnSync(path.join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(helperScript(plan), 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 20000, windowsHide: true })
}
test('卸载三次确认、全部取消和挽留提示', () => {
  let step = transitionUninstall(0, 'open').step; assert.equal(step, 1)
  step = transitionUninstall(step, 'next').step; assert.equal(step, 2)
  step = transitionUninstall(step, 'next').step; assert.equal(step, 3)
  for (const current of [1, 2, 3] as const) assert.equal(transitionUninstall(current, 'cancel').step, 0)
  assert.deepEqual(transitionUninstall(3, 'stay'), { step: 0, notice: '给我发个平底锅我就知道啦！' })
})
test('只接受专属 Portable 目录和固定数据目录，拒绝系统、共享目录、安装器和伪造身份', () => {
  const plan = fixture(); assert.equal(validatePlan(plan).programDirectory, plan.programDirectory)
  assert.throws(() => validatePlan({ ...plan, dataDirectory: plan.appData }))
  assert.throws(() => validatePlan({ ...plan, programDirectory: plan.desktop, exe: path.join(plan.desktop, 'YayaDiary.exe') }))
  assert.throws(() => validatePlan({ ...plan, programDirectory: path.parse(plan.programDirectory).root }))
  assert.throws(() => validatePlan({ ...plan, exe: path.join(plan.programDirectory, 'other.exe') }))
  fs.writeFileSync(path.join(plan.programDirectory, 'Update.exe'), 'fixture'); assert.throws(() => validatePlan(plan))
  fs.unlinkSync(path.join(plan.programDirectory, 'Update.exe'))
  fs.writeFileSync(path.join(plan.programDirectory, 'resources', 'app.asar', 'package.json'), '{}'); assert.throws(() => validatePlan(plan))
})
test('拒绝经过 junction 的删除路径', () => {
  const plan = fixture(); const link = path.join(plan.temp, 'linked'); fs.symlinkSync(plan.programDirectory, link, 'junction')
  assert.throws(() => validatePlan({ ...plan, programDirectory: link, exe: path.join(link, 'YayaDiary.exe') }))
})
test('外部 helper 只删除隔离目标，保留其他文件与其他程序快捷方式', { skip: process.platform !== 'win32' }, () => {
  const plan = fixture(); const unrelated = path.join(plan.desktop, '其他文件.txt'); fs.writeFileSync(unrelated, '保留')
  // 构造真正的 Windows 快捷方式，删除条件是 TargetPath，而不是文件名。
  const setup = `$s=New-Object -ComObject WScript.Shell; $a=$s.CreateShortcut('${plan.desktop.replaceAll("'", "''")}\\YayaDiary.lnk'); $a.TargetPath='${plan.exe.replaceAll("'", "''")}'; $a.Save(); $b=$s.CreateShortcut('${plan.desktop.replaceAll("'", "''")}\\Other.lnk'); $b.TargetPath='C:\\Windows\\notepad.exe'; $b.Save()`
  const created = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(setup, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true }); assert.equal(created.status, 0, created.stderr)
  const result = runHelper(validatePlan(plan)); assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.existsSync(plan.programDirectory), false); assert.equal(fs.existsSync(plan.dataDirectory), false)
  assert.equal(fs.existsSync(unrelated), true); assert.equal(fs.existsSync(path.join(plan.desktop, 'Other.lnk')), true); assert.equal(fs.existsSync(path.join(plan.desktop, 'YayaDiary.lnk')), false)
  assert.match(fs.readFileSync(plan.logFile, 'utf8'), /卸载完成/)
})
test('helper 拒绝不匹配的数据目录，整体不删除；失败写日志', { skip: process.platform !== 'win32' }, () => {
  const plan = fixture(); const result = runHelper({ ...plan, dataDirectory: plan.appData })
  assert.equal(result.status, 1); assert.equal(fs.existsSync(plan.exe), true); assert.equal(fs.existsSync(plan.dataDirectory), true)
  assert.match(fs.readFileSync(plan.logFile, 'utf8'), /用户数据目录校验失败/)
})
test('目录内 junction 阻止递归删除，不影响链接目标', { skip: process.platform !== 'win32' }, () => {
  const plan = fixture(); const outside = path.join(plan.temp, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'keep'), 'keep')
  fs.symlinkSync(outside, path.join(plan.programDirectory, 'link'), 'junction')
  const result = runHelper(validatePlan(plan)); assert.equal(result.status, 1); assert.equal(fs.existsSync(path.join(outside, 'keep')), true)
  assert.equal(fs.existsSync(plan.exe), true); assert.match(fs.readFileSync(plan.logFile, 'utf8'), /链接/)
})
test('helper 启动失败可被捕获，不触发退出', async () => {
  const { EventEmitter } = await import('node:events')
  await assert.rejects(launchHelper(fixture(), () => { const child = new EventEmitter(); process.nextTick(() => child.emit('error', Error('blocked'))); return child }), /blocked/)
})
test('真实 helper 等待父进程退出，退出前不删除任何资料', { skip: process.platform !== 'win32' }, async () => {
  const plan = fixture()
  const parent = spawn(process.execPath, ['-e', 'setTimeout(()=>{},2500)'], { stdio: 'ignore', windowsHide: true })
  const exited = new Promise(resolve => parent.once('exit', resolve))
  const started = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${parent.pid}).StartTime.ToUniversalTime().Ticks.ToString()`], { encoding: 'utf8', windowsHide: true })
  assert.equal(started.status, 0, started.stderr)
  await launchHelper({ ...validatePlan(plan), parentPid: parent.pid, parentStarted: started.stdout.trim() })
  assert.equal(fs.existsSync(plan.exe), true); assert.equal(fs.existsSync(plan.dataDirectory), true)
  await exited
  for (let i=0; i<100 && (fs.existsSync(plan.programDirectory) || fs.existsSync(plan.dataDirectory)); i++) await new Promise(r=>setTimeout(r,50))
  assert.equal(fs.existsSync(plan.programDirectory), false); assert.equal(fs.existsSync(plan.dataDirectory), false)
})
test('文件占用时有限重试并记录失败，不误删无关文件', { skip: process.platform !== 'win32' }, async () => {
  const plan=fixture(), ready=path.join(plan.temp,'lock.ready')
  const script=`$f=[IO.File]::Open('${plan.exe.replaceAll("'","''")}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None);Set-Content -LiteralPath '${ready.replaceAll("'","''")}' -Value ready;try{Start-Sleep -Seconds 15}finally{$f.Dispose()}`
  const locker=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{stdio:'ignore',windowsHide:true})
  try {
    for(let i=0;i<100&&!fs.existsSync(ready);i++) await new Promise(r=>setTimeout(r,50))
    assert.equal(fs.existsSync(ready),true)
    const result=runHelper(validatePlan(plan));assert.equal(result.status,1);assert.equal(fs.existsSync(plan.exe),true)
    assert.match(fs.readFileSync(plan.logFile,'utf8'),/YayaDiary|Portable/)
  } finally { locker.kill() }
})
test('卸载 helper 在启动它的主进程退出后仍能完成删除', { skip: process.platform !== 'win32' }, async () => {
  const plan=validatePlan(fixture())
  const launcher=`const {launchHelper}=require(process.argv[1]);const plan=JSON.parse(process.argv[2]);const {execFileSync}=require('node:child_process');plan.parentPid=process.pid;plan.parentStarted=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','(Get-Process -Id '+process.pid+').StartTime.ToUniversalTime().Ticks.ToString()'],{encoding:'utf8',windowsHide:true}).trim();launchHelper(plan).then(()=>setTimeout(()=>process.exit(0),200)).catch(e=>{console.error(e);process.exit(1)})`
  const result=spawnSync(process.execPath,['-e',launcher,path.resolve('electron/uninstall.cjs'),JSON.stringify(plan)],{encoding:'utf8',timeout:15000,windowsHide:true})
  assert.equal(result.status,0,result.stderr)
  for(let i=0;i<100&&(fs.existsSync(plan.programDirectory)||fs.existsSync(plan.dataDirectory));i++) await new Promise(r=>setTimeout(r,50))
  assert.equal(fs.existsSync(plan.programDirectory),false);assert.equal(fs.existsSync(plan.dataDirectory),false)
})
test('卸载 IPC 拒绝 iframe 和开发执行；正式最终确认等待写入结束并启动 helper', async () => {
  const handlers = new Map(); const ipcMain = { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: (name: string) => handlers.delete(name) }
  const plan = fixture(); const app = { isPackaged: true, getPath: () => plan.temp, quit() {} }
  const order: string[] = []; let launches = 0
  const control = registerUninstallIPC({ app, ipcMain, whenIdle: async () => { order.push('idle') }, makePlan: () => plan, parentStart: () => '0', launch: async () => { order.push('helper'); launches++ }, quit: () => order.push('quit') })
  const mainFrame = { url: 'file:///fixture/index.html#other' }, contents = { mainFrame }; control.attach({ webContents: contents }, 'file:///fixture/index.html')
  const event = { sender: contents, senderFrame: mainFrame }
  assert.equal((await handlers.get('yaya:uninstall:execute')({ ...event, senderFrame: {} })).ok, false)
  assert.equal((await handlers.get('yaya:uninstall:execute')(event)).ok, true)
  assert.equal(launches, 1); assert.deepEqual(order, ['idle', 'helper'])
  assert.equal((await handlers.get('yaya:uninstall:execute')(event)).ok, false)
  await new Promise(r => setTimeout(r, 250)); assert.deepEqual(order, ['idle', 'helper', 'quit'])
  app.isPackaged = false
  assert.equal((await handlers.get('yaya:uninstall:execute')(event)).ok, false); assert.equal(launches, 1)
  control.dispose(); assert.equal(handlers.size, 0)
})
