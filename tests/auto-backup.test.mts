import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { openFormalDatabase } from '../electron/sqlite/migration.ts'
import { BackupManager } from '../electron/sqlite/maintenance.ts'
import { AutoBackupManager, localBackupDate } from '../electron/sqlite/autoBackup.ts'
function setup(t:TestContext) {
  const root=mkdtempSync(join(tmpdir(),'yaya-auto-')),file=join(root,'formal.db'),session={service:openFormalDatabase(file,true)}
  const manager=new BackupManager(session,file,root,'1.1.2')
  const directory=join(root,'backups','auto');let now=new Date(2026,9,7,14,5)
  const logs:string[]=[]
  const create=(mode='sqlite')=>new AutoBackupManager(manager,root,mode,()=>now,message=>logs.push(message))
  const files=()=>existsSync(directory)?readdirSync(directory).filter(n=>n.endsWith('.db')):[]
  t.after(()=>{manager.dispose();session.service.close();rmSync(root,{recursive:true,force:true})})
  return {root,directory,session,manager,create,files,logs,day:(day:number)=>{now=new Date(2026,9,day,14,5)}}
}
test('每日首次启动备份，同日重启跳过，次日创建；按本地自然日',async t=>{
  const f=setup(t)
  const first=await f.create().run();assert.equal(first.error,null);assert.equal(f.files().length,1)
  await f.create().run();assert.equal(f.files().length,1)
  f.day(8);await f.create().run();assert.equal(f.files().length,2)
  assert.equal(localBackupDate(new Date(2026,9,7,0,0)),'2026-10-07')
})
test('仅保留7份登记的自动备份，不删除目录内外手动备份',async t=>{
  const f=setup(t);mkdirSync(f.directory,{recursive:true})
  const manual=join(f.directory,'manual.db'),outside=join(f.root,'my-backup.db')
  writeFileSync(manual,'manual');writeFileSync(outside,'manual')
  for(let day=1;day<=9;day++){f.day(day);await f.create().run()}
  const files=f.files().filter(n=>n.startsWith('yaya-diary-auto-'))
  assert.equal(files.length,7);assert(files.every(n=>!n.includes('-10-01-')&&!n.includes('-10-02-')))
  assert.equal(readFileSync(manual,'utf8'),'manual');assert.equal(readFileSync(outside,'utf8'),'manual')
})
test('在线自动备份含WAL中提交的数据，完整性和外键通过，正式数据未改变',async t=>{
  const f=setup(t)
  f.session.service.execute('bosses.create',[{id:'A',nickname:'测试',hourlyRateCents:3500,notes:''}])
  f.session.service.execute('balances.changeBalance',['A',{type:'recharge',amountCents:7000,notes:''}])
  const before=f.session.service.snapshot();await f.create().run()
  const file=join(f.directory,f.files()[0]),db=new DatabaseSync(file,{readOnly:true})
  try {assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)} finally {db.close()}
  const copy=openFormalDatabase(file);try{assert.deepEqual(copy.snapshot(),before)}finally{copy.close()}
  assert.deepEqual(f.session.service.snapshot(),before)
})
test('备份失败不抛异常、不记录成功，下一次启动同日可重试',async t=>{
  const f=setup(t),broken=new AutoBackupManager({backup:async()=>{throw Error('模拟磁盘故障')}},f.root,'sqlite',()=>new Date(2026,9,7),m=>f.logs.push(m))
  const info=await broken.run();assert.match(info.error!,/模拟磁盘故障/);assert.equal(info.lastSuccessAt,null);assert.equal(f.files().length,0);assert.equal(f.logs.length,1)
  assert.equal(f.session.service.snapshot().bosses.length,0)
  assert.equal((await f.create().run()).error,null);assert.equal(f.files().length,1)
})
for(const mode of ['sqlite-test','local-storage'])test(`${mode}不创建正式自动备份或配置`,async t=>{
  const f=setup(t);const info=await f.create(mode).run();assert.equal(info.enabled,false);assert(!existsSync(f.directory))
})
test('配置写入失败不阻止启动；下一次启动仍可重试',async t=>{
  const f=setup(t);mkdirSync(f.directory,{recursive:true});mkdirSync(join(f.directory,'auto-backup-state.json.new'))
  assert.match((await f.create().run()).error!,/每日自动备份失败/)
  assert(!existsSync(join(f.directory,'auto-backup-state.json')))
  rmSync(join(f.directory,'auto-backup-state.json.new'),{recursive:true})
  assert.equal((await f.create().run()).error,null)
})
