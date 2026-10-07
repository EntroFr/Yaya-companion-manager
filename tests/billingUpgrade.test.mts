import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteService } from '../electron/sqlite/service.ts'
import { BackupManager } from '../electron/sqlite/maintenance.ts'
import { createLegacyDatabase,legacyStart } from './helpers/legacyDatabase.ts'
import { createLocalStorageDataAccess } from '../src/features/storage/localStorageDataAccess.ts'
import { APP_STORAGE_KEY } from '../src/features/storage/appStore.ts'
import { verifiedFile,importState,reconcile } from '../electron/sqlite/migration.ts'
import { calculateStatistics } from '../src/features/statistics/statistics.ts'
import { liveBilling } from '../src/features/orders/billing.ts'
import type { Order } from '../src/features/orders/types.ts'
for(const status of ['active','paused','completed'] as const)test(`SQLite 1.0.0 ${status} 升级保留历史；结束只补尚未扣过的差额`,t=>{
  const dir=mkdtempSync(join(tmpdir(),'yaya-upgrade-')),file=join(dir,'old.db');createLegacyDatabase(file,status)
  const old=new DatabaseSync(file,{readOnly:true}),oldEntries=old.prepare('SELECT * FROM balance_entries ORDER BY rowid').all(),oldOrder=old.prepare('SELECT * FROM orders').get();old.close()
  let now=legacyStart+1380000;const service=new SQLiteService(file,{clock:()=>now});t.after(()=>{service.close();rmSync(dir,{recursive:true,force:true})})
  assert.deepEqual(service.database.prepare('SELECT * FROM balance_entries ORDER BY rowid').all(),oldEntries)
  const order=service.snapshot().orders[0];assert.equal(order.billingModel,undefined);assert.equal(order.status,status)
  assert.deepEqual(Object.fromEntries(Object.entries(service.database.prepare('SELECT * FROM orders').get()!).filter(([k])=>k!=='billing_model')),{...oldOrder})
  service.execute('orders.settle');assert.equal(service.lastChanged,false)
  if(status==='completed'){assert.throws(()=>service.execute('orders.complete',['legacy-order']),/已结束/);return}
  assert.equal(liveBilling(order,6125,now).estimatedBalanceCents,status==='paused'?6125:5658)
  if(status==='paused'){service.execute('orders.resume',['legacy-order']);now+=480000}
  const done=service.execute('orders.complete',['legacy-order']) as Order
  assert.equal(done.finalChargeCents,1342);assert.equal(done.balanceAtEndCents,5658)
  const entries=service.snapshot().entries.filter(e=>e.type==='order_consumption');assert.equal(entries.length,2);assert.equal(entries[1].deltaCents,-467)
  assert.deepEqual(service.database.prepare("SELECT * FROM balance_entries WHERE entry_id='segment-1'").get(),oldEntries[1])
  assert.equal(calculateStatistics(service.snapshot(),{start:legacyStart,end:now}).serviceIncomeCents,1342)
})
test('1.0.0备份在临时副本升级恢复，原备份与已扣进度保留',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'yaya-restore-upgrade-')),old=join(dir,'backup-1.0.0.db'),file=join(dir,'formal.db');createLegacyDatabase(old,'paused')
  const {openFormalDatabase}=await import('../electron/sqlite/migration.ts');const session={service:openFormalDatabase(file,true)},manager=new BackupManager(session,file,dir,'1.1.0')
  t.after(()=>{manager.dispose();session.service.close();rmSync(dir,{recursive:true,force:true})})
  const preview=await manager.inspect(old);assert.equal(preview.schemaVersion,4);await manager.restore(preview.token)
  assert.equal(session.service.snapshot().orders[0].settledAmountCents,875);session.service.execute('orders.settle');assert.equal(session.service.snapshot().entries.length,2)
  const original=new DatabaseSync(old,{readOnly:true});assert.equal(original.prepare('SELECT max(version) AS n FROM schema_migrations').get()!.n,3);original.close()
})
test('旧分段快照导出迁移对账一致，迁移不执行扣费',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'yaya-migration-upgrade-')),file=join(dir,'old.db');createLegacyDatabase(file,'active')
  const old=new SQLiteService(file,{clock:()=>legacyStart+1380000}),store=old.snapshot();old.close()
  const raw=new Map([[APP_STORAGE_KEY,JSON.stringify(store)]]),storage={getItem:(k:string)=>raw.get(k)??null,setItem:(k:string,v:string)=>{raw.set(k,v)},removeItem:(k:string)=>{raw.delete(k)}}
  const api=createLocalStorageDataAccess({storage:()=>storage,clock:()=>legacyStart+1380000,lock:async fn=>fn()}),source=verifiedFile(await api.migration.exportData()),target=new SQLiteService(join(dir,'target.db'),{clock:()=>legacyStart+1380000})
  t.after(()=>{target.close();rmSync(dir,{recursive:true,force:true})});importState(target,source);assert(reconcile(source,target).passed);target.execute('orders.settle');assert.deepEqual(target.snapshot(),store)
  assert.equal((target.execute('orders.complete',['legacy-order']) as Order).finalChargeCents,1342)
})
