// 通过 Electron 官方 Main 调试接口验证安装产物。该脚本不打入安装包。
// 在第一行暂停时切换 appData 到调用者提供的临时测试目录，不访问真实资料。
import { spawn } from 'node:child_process'
import { resolve, join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import assert from 'node:assert/strict'
const [executable, directory, phase='create', entrypoint]=process.argv.slice(2)
const canonicalDirectory = directory && join(realpathSync.native(dirname(resolve(directory))),basename(resolve(directory)))
if(!executable || !directory || !canonicalDirectory.toLowerCase().startsWith(join(realpathSync.native(tmpdir()),'yaya-install-check-').toLowerCase())) throw new Error('安装验收只允许 yaya-install-check- 临时资料目录。')
mkdirSync(directory,{recursive:true})
const legacy=phase==='legacy-active'||phase==='legacy-paused'
if(legacy){
  const {createLegacyDatabase}=await import('../tests/helpers/legacyDatabase.ts')
  const file=join(directory,'Yaya-companion-manager/sqlite/yaya-companion.db');mkdirSync(resolve(file,'..'),{recursive:true})
  createLegacyDatabase(file,phase==='legacy-paused'?'paused':'active')
}
const port=9338,env={...process.env};delete env.ELECTRON_RUN_AS_NODE
if(entrypoint)env.YAYA_STORAGE_MODE='sqlite'
const child=spawn(resolve(executable),[`--inspect-brk=127.0.0.1:${port}`,...(entrypoint?[resolve(entrypoint)]:[])],{env,stdio:['ignore','pipe','pipe'],windowsHide:true})
child.stderr.on('data',data=>process.stderr.write(data));child.stdout.on('data',data=>process.stdout.write(data))
let launchError
child.once('error',error=>{launchError=error})
let socket,id=0,paused,pausedResolve;const pending=new Map()
const pause=new Promise(r=>{pausedResolve=r})
const timeout=setTimeout(()=>{child.kill();throw new Error('安装应用检查超时')},60000)
try {
  let endpoint
  for(let tries=0;tries<100;tries++){if(launchError)throw launchError;try{endpoint=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json())[0]?.webSocketDebuggerUrl;if(endpoint)break}catch{}await new Promise(r=>setTimeout(r,100))}
  if(!endpoint)throw new Error('安装应用未打开 Main 调试接口')
  socket=new WebSocket(endpoint)
  await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j})
  socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const request=pending.get(message.id);pending.delete(message.id);if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result)}else if(message.method==='Debugger.paused'){paused=message.params;pausedResolve(paused)}}
  function call(method,params={}){return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}))})}
  await call('Runtime.enable');await call('Debugger.enable');await call('Runtime.runIfWaitingForDebugger');await pause
  const setup=await call('Debugger.evaluateOnCallFrame',{callFrameId:paused.callFrames[0].callFrameId,expression:`globalThis.__checkRequire=typeof require==='function'?require:process.getBuiltinModule('module').createRequire(process.cwd()+'/acceptance.cjs'); __checkRequire('electron').app.setPath('appData',${JSON.stringify(resolve(directory))})`,returnByValue:true})
  if(setup.exceptionDetails)throw new Error(JSON.stringify(setup.exceptionDetails))
  await call('Debugger.resume')
  await call('Debugger.disable')
  await new Promise(r=>setTimeout(r,1500))
  async function main(expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value}
  for(let tries=0;tries<150;tries++){if(await main("!!__checkRequire('electron').BrowserWindow.getAllWindows()[0]?.webContents.getURL()"))break;await new Promise(r=>setTimeout(r,100))}
  const windowExpression="__checkRequire('electron').BrowserWindow.getAllWindows()[0]"
  const renderer=expression=>main(`${windowExpression}.webContents.executeJavaScript(${JSON.stringify(expression)})`)
  async function business(group,method,...args){const reply=await renderer(`window.yayaDesktop.repositories.${group}.${method}(...${JSON.stringify(args)})`);if(!reply.ok)throw new Error(reply.message);return reply.value}
  for(let tries=0;tries<100;tries++){if(await renderer("!!window.yayaDesktop && document.body.textContent.includes('日常工作台')"))break;await new Promise(r=>setTimeout(r,100))}
  assert.equal(await main("__checkRequire('electron').app.isPackaged"),!entrypoint)
  assert.equal(await renderer('window.yayaDesktop.mode'),'sqlite')
  assert.equal(await renderer('typeof require'),'undefined');assert.equal(await renderer('typeof process'),'undefined')
  const preferences=await main(`${windowExpression}.webContents.getLastWebPreferences()`)
  assert.equal(preferences.nodeIntegration,false);assert.equal(preferences.contextIsolation,true)
  assert.equal(await main(`${windowExpression}.getTitle()`),'Yaya的陪玩日记')
  if(phase==='create'){
    assert.equal((await business('bosses','list')).length,0)
    const boss=await business('bosses','create',{id:'INSTALL-CHECK',nickname:'安装测试',hourlyRateCents:3500,notes:'保留测试'})
    await business('balances','changeBalance',boss.id,{type:'recharge',amountCents:7000,notes:'安装测试充值'})
    const order=await business('orders','start',boss.id);await business('orders','pause',order.id);await business('orders','resume',order.id);await business('orders','complete',order.id)
    await business('tips','create',boss.profileId,{amountCents:2000,receivedAt:new Date().toISOString(),notes:'测试打赏'})
    const backupPath=join(directory,'acceptance-backup.db')
    await main(`__checkRequire('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(backupPath)}});__checkRequire('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(backupPath)}]})`)
    await business('management','backup');await business('bosses','create',{id:'RESTORE-REMOVE',nickname:'',hourlyRateCents:3500,notes:''})
    const preview=await business('management','inspectRestore');assert.equal(preview.bosses,1)
    const restored=await business('management','restore',preview.token);assert.equal(restored.bosses,1);assert(existsSync(restored.protectedBackup.path))
    await business('management','openFolder')
  }
  if(legacy){
    const history=await business('history','read');assert.equal(history.entries.length,2);assert.equal(history.orders[0].settledAmountCents,875)
    assert.equal(history.orders[0].status,phase==='legacy-paused'?'paused':'active')
    const ended=await business('orders','complete','legacy-order'),after=await business('history','read')
    assert.deepEqual(after.entries.find(e=>e.id==='segment-1'),history.entries.find(e=>e.id==='segment-1'))
    const charges=after.entries.filter(e=>e.type==='order_consumption');assert.equal(charges.length,phase==='legacy-paused'?1:2)
    assert.equal(charges.reduce((sum,e)=>sum-e.deltaCents,0),ended.finalChargeCents)
  }
  assert.equal((await business('bosses','list'))[0].id,legacy?'A':'INSTALL-CHECK')
  if(!legacy)assert.equal((await business('tips','list'))[0].amountCents,2000)
  for(const route of ['dashboard','bosses',legacy?'bosses/A':'bosses/INSTALL-CHECK','statistics','data','migration']){
    await renderer(`location.hash=${JSON.stringify(route)}`);await new Promise(r=>setTimeout(r,200))
    const text=await renderer('document.body.textContent')
    assert(!text.includes('清除所有测试数据'));if(!entrypoint){assert(!text.includes('pnpm '));assert(!text.includes('SHA-256：'))}
    if(route==='data')assert(text.includes('数据库版本 4'))
  }
  await main(`${windowExpression}.webContents.reload()`);await new Promise(r=>setTimeout(r,500))
  assert.equal((await business('bosses','list')).length,1)
  const info=await business('management','info')
  assert(info.path.startsWith(resolve(directory)));assert.equal(info.appVersion,phase==='after-upgrade'?'1.0.1':'1.1.2')
  writeFileSync(join(directory,`installed-${phase}.json`),JSON.stringify({ok:true,phase,info,checks:['已安装应用启动','默认正式SQLite','Node隔离','业务CRUD','备份恢复','打开目录','hash路由','刷新持久化','正式UI隐藏开发操作']},null,2))
  console.log('Windows安装应用验收通过：',phase,info.path)
  await main("setTimeout(()=>__checkRequire('electron').app.quit(),100); true")
  socket.close()
  await new Promise(r=>child.once('exit',r))
} finally { clearTimeout(timeout);socket?.close();if(child.pid && child.exitCode===null)child.kill() }
