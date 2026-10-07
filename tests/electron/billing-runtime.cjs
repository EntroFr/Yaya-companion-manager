const {app}=require('electron')
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {createWindow}=require('../../electron/window.cjs')
const {SQLiteService,openFormalDatabase,DesktopDataService,MigrationManager,BUSINESS_METHODS,MIGRATION_METHODS}=require('../../.electron-main/sqlite-service.cjs')
const directory=fs.mkdtempSync(path.join(app.getPath('temp'),'yaya-billing-1.1-')),file=path.join(directory,'formal.db')
app.setPath('userData',directory)
let service,ipc,migration,win
let now=Date.now(),base=now
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function until(expression){for(let i=0;i<100;i++){const value=await win.webContents.executeJavaScript(expression);if(value)return value;await wait(100)}throw Error('检查超时：'+expression)}
app.whenReady().then(async()=>{
  const initial=openFormalDatabase(file,true);initial.close();service=new SQLiteService(file,{clock:()=>now})
  migration=new MigrationManager(directory,file,'sqlite');ipc=require('../../electron/ipc.cjs').registerDataIPC(new DesktopDataService(service,migration),[...BUSINESS_METHODS,...MIGRATION_METHODS])
  const created=createWindow({show:false,storageMode:'sqlite',indexFile:path.resolve('dist/index.html'),beforeLoad:(w,target)=>ipc.attach(w,target)});win=created.win;await created.ready
  await until("document.body.textContent.includes('日常工作台')")
  const execute=js=>win.webContents.executeJavaScript(js,true)
  async function call(group,method,...args){const result=await execute(`window.yayaDesktop.repositories.${group}.${method}(...${JSON.stringify(args)})`);if(!result.ok)throw Error(result.message);return result.value}
  await execute(`window.__tones=0;window.__clock=${base};Date.now=()=>window.__clock;const original=AudioContext;window.AudioContext=class extends original{constructor(...args){super(...args);window.__audio=this}};const oscillator=original.prototype.createOscillator;original.prototype.createOscillator=function(){window.__tones++;return oscillator.call(this)};document.dispatchEvent(new PointerEvent('pointerdown'))`)
  await until("window.__audio?.state==='running'")
  const boss=await call('bosses','create',{id:'BALANCE-ALERT',nickname:'提示音测试',hourlyRateCents:3500,notes:''});await call('balances','changeBalance',boss.id,{type:'recharge',amountCents:875,notes:''});const order=await call('orders','start',boss.id)
  await until("document.body.textContent.includes('实时预计余额')")
  const changes=service.database.prepare('SELECT total_changes() AS n').get().n
  now=base+900000;await execute(`window.__clock=${now}`)
  await until("window.__tones===2 && document.body.textContent.includes('老板余额已用完，当前进入超时服务')")
  await wait(2300);assert.equal(await execute('window.__tones'),2)
  assert.equal(service.database.prepare('SELECT total_changes() AS n').get().n,changes)
  assert.equal(service.snapshot().entries.length,1);assert.equal(service.snapshot().bosses[0].balanceCents,875)
  await call('orders','pause',order.id);now+=600000;await execute(`window.__clock=${now}`);await wait(1200)
  assert.equal(await execute('window.__tones'),2);assert.equal(service.snapshot().orders[0].status,'paused')
  await call('balances','changeBalance',boss.id,{type:'recharge',amountCents:875,notes:'充值重新提醒'})
  await until("!document.body.textContent.includes('老板余额已用完')")
  await call('orders','resume',order.id);now+=900000;await execute(`window.__clock=${now}`)
  await until('window.__tones===4');await wait(2200);assert.equal(await execute('window.__tones'),4)
  assert.equal(service.snapshot().entries.length,2)
  fs.writeFileSync(path.resolve('.electron-smoke/balance-alert-1.1.png'),(await win.webContents.capturePage()).toPNG())
  const done=await call('orders','complete',order.id);assert.equal(done.finalChargeCents,1750);assert.equal(done.balanceAtEndCents,0);assert.equal(service.snapshot().entries.filter(e=>e.type==='order_consumption').length,1)
  console.log('Electron正式计费通过：期间零数据库写入；真实离线短音每次两个音符，仅两次提醒；暂停、充值重新提醒及结束一条流水。')
  await wait(200);win.destroy();await ipc.whenIdle();ipc.dispose();migration.dispose();service.close();app.exit(0)
}).catch(error=>{console.error(error);win?.destroy();ipc?.dispose();migration?.dispose();service?.close();app.exit(1)})
