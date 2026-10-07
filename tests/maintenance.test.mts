import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { openFormalDatabase, MigrationManager, DesktopDataService } from '../electron/sqlite/migration.ts'
import { BackupManager, recoverInterruptedRestore, backupName } from '../electron/sqlite/maintenance.ts'
import type { Boss } from '../src/features/bosses/types.ts'
import { createLocalStorageDataAccess } from '../src/features/storage/localStorageDataAccess.ts'
function fixture(t:TestContext) {
  const directory=mkdtempSync(join(tmpdir(),'yaya-backup-')),file=join(directory,'yaya-companion.db')
  const session={service:openFormalDatabase(file,true)};let failure=''
  const manager=new BackupManager(session,file,directory,'1.0.0',stage=>{if(stage===failure)throw new Error('模拟故障')})
  t.after(()=>{manager.dispose();session.service.close();rmSync(directory,{recursive:true,force:true})})
  const create=(id='A')=>session.service.execute('bosses.create',[{id,nickname:'老板',hourlyRateCents:3500,notes:''}]) as Boss
  const recharge=()=>session.service.execute('balances.changeBalance',['A',{type:'recharge',amountCents:7000,notes:''}])
  return {directory,file,session,manager,create,recharge,fail:(stage:string)=>{failure=stage}}
}
test('首次创建正式库、重启保留，并拒绝覆盖不合法现有库',t=>{
  const f=fixture(t);f.create();f.session.service.close();f.session.service=openFormalDatabase(f.file,true)
  assert.equal(f.manager.info().bosses,1);const bad=join(f.directory,'bad.db');writeFileSync(bad,'invalid');assert.throws(()=>openFormalDatabase(bad,true));assert.equal(readFileSync(bad,'utf8'),'invalid')
})
test('在线备份包含WAL内余额流水和打赏，备份一致且可重启恢复',async t=>{
  const f=fixture(t),boss=f.create();f.recharge();f.session.service.execute('tips.create',[boss.profileId,{amountCents:2000,receivedAt:new Date().toISOString(),notes:''}])
  const before=f.session.service.snapshot(),target=join(f.directory,backupName());const info=await f.manager.backup(target)
  assert.equal(info.bosses,1);assert.equal(info.entries,1);assert.equal(info.tips,1);assert(info.size>0)
  const copy=openFormalDatabase(target);assert.deepEqual(copy.snapshot(),before);copy.close()
  f.create('B');const preview=await f.manager.inspect(target);const result=await f.manager.restore(preview.token)
  assert.equal(result.bosses,1);assert(existsSync(result.protectedBackup.path));assert.deepEqual(f.session.service.snapshot(),before)
  f.session.service.close();f.session.service=openFormalDatabase(f.file);assert.deepEqual(f.session.service.snapshot(),before)
})
for(const point of ['after-backup','after-close','after-old-move','after-new-move','after-open'])test(`恢复故障 ${point} 保留完整原库和自动备份`,async t=>{
  const f=fixture(t);f.create();const target=join(f.directory,'copy.db');await f.manager.backup(target);f.create('B');const original=f.session.service.snapshot();const p=await f.manager.inspect(target)
  f.fail(point);await assert.rejects(f.manager.restore(p.token));assert.deepEqual(f.session.service.snapshot(),original)
  assert(readdirSync(join(f.directory,'backups')).some(n=>n.startsWith('before-restore-')))
})
test('损坏数据库、非数据库、不兼容schema、外键和流水损坏均拒绝',async t=>{
  const f=fixture(t);f.create();f.recharge();const original=f.session.service.snapshot()
  const text=join(f.directory,'text.db');writeFileSync(text,'bad');await assert.rejects(f.manager.inspect(text),/不是有效/)
  for(const kind of ['schema','foreign','ledger','corrupt','trigger']){
    const path=join(f.directory,kind+'.db');await f.manager.backup(path)
    if(kind==='corrupt')writeFileSync(path,Buffer.from('SQLite format 3\0'+ 'broken'.repeat(100)))
    else {const db=new DatabaseSync(path);if(kind==='schema')db.prepare('INSERT INTO schema_migrations VALUES (99,?,?)').run('future',Date.now());if(kind==='foreign'){db.exec('PRAGMA foreign_keys=OFF');db.exec('DELETE FROM boss_identities')}if(kind==='ledger')db.exec('UPDATE boss_profiles SET balance_cents=1');if(kind==='trigger')db.exec('CREATE TRIGGER unknown_trigger AFTER INSERT ON tips BEGIN DELETE FROM tips; END');db.close()}
    await assert.rejects(f.manager.inspect(path));assert.deepEqual(f.session.service.snapshot(),original)
  }
})
test('active与paused订单禁止恢复，确认前重新检查状态',async t=>{
  const f=fixture(t);f.create();f.recharge();const path=join(f.directory,'copy.db');await f.manager.backup(path);const p=await f.manager.inspect(path)
  const order=f.session.service.execute('orders.start',['A']) as {id:string}
  await assert.rejects(f.manager.restore(p.token),/当前存在进行中的订单/);await assert.rejects(f.manager.inspect(path),/当前存在进行中的订单/)
  f.session.service.execute('orders.pause',[order.id]);await assert.rejects(f.manager.restore(p.token),/当前存在进行中的订单/)
})
test('不覆盖已有备份或正式库，取消后令牌失效，源文件保持原样',async t=>{
  const f=fixture(t),path=join(f.directory,'copy.db');await f.manager.backup(path);const bytes=readFileSync(path)
  await assert.rejects(f.manager.backup(path),/已存在/);await assert.rejects(f.manager.backup(f.file),/已存在/)
  const p=await f.manager.inspect(path);f.manager.cancel();await assert.rejects(f.manager.restore(p.token),/失效/);assert.deepEqual(readFileSync(path),bytes)
})
test('中断文件切换在启动时回到原库，并拒绝任意路径保护记录',t=>{
  const f=fixture(t);f.create();f.session.service.close();const rollback=join(f.directory,'backups','rollback-crash.db');requireDirectory(rollback)
  renameSync(f.file,rollback);writeFileSync(f.file,'broken');const journal=join(f.directory,'restore-journal.json');writeFileSync(journal,JSON.stringify({target:f.file,original:rollback}))
  recoverInterruptedRestore(f.file,f.directory);f.session.service=openFormalDatabase(f.file);assert.equal(f.manager.info().bosses,1)
  writeFileSync(journal,JSON.stringify({target:f.file,original:join(f.directory,'outside.db')}));assert.throws(()=>recoverInterruptedRestore(f.file,f.directory),/不合法/)
})
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
function requireDirectory(path:string){mkdirSync(dirname(path),{recursive:true})}
test('首次安装的空正式库可导入旧资料，已有资料后禁止迁移覆盖',async t=>{
  const f=fixture(t),raw=new Map<string,string>(),storage={getItem:(k:string)=>raw.get(k)??null,setItem:(k:string,v:string)=>{raw.set(k,v)},removeItem:(k:string)=>{raw.delete(k)}}
  const local=createLocalStorageDataAccess({storage:()=>storage,lock:async fn=>fn()});await local.bosses.create({id:'old',nickname:'旧资料',hourlyRateCents:3500,notes:''})
  const migration=new MigrationManager(f.directory,f.file,'sqlite',undefined,candidate=>{f.manager.replace(candidate)})
  const desktop=new DesktopDataService(f.session.service,migration)
  assert.equal(migration.status().formalAvailable,false);const report=migration.prepare(await local.migration.exportData());migration.activate(report.token)
  desktop.service=f.session.service;assert.equal(f.manager.info().bosses,1);assert.equal(migration.status().formalAvailable,true)
  await local.bosses.create({id:'other',nickname:'',hourlyRateCents:3500,notes:''})
  const another=await local.migration.exportData();assert.throws(()=>migration.prepare(another),/已有正式数据库/)
  migration.dispose()
})
