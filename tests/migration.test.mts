import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createLocalStorageDataAccess } from '../src/features/storage/localStorageDataAccess.ts'
import { APP_STORAGE_KEY } from '../src/features/storage/appStore.ts'
import { MIGRATION_KEYS, parseMigration, summarize } from '../src/features/migration/format.ts'
import { SQLiteService } from '../electron/sqlite/service.ts'
import { MigrationManager, DesktopDataService, importState, reconcile, verifiedFile, openFormalDatabase } from '../electron/sqlite/migration.ts'
import { migrations } from '../electron/sqlite/schema.ts'
import type { Boss } from '../src/features/bosses/types.ts'
import type { Order } from '../src/features/orders/types.ts'
import type { AppStore } from '../src/features/storage/appStore.ts'

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'yaya-migration-')), raw = new Map<string,string>()
  const storage = { getItem: (k: string) => raw.get(k) ?? null, setItem: (k: string,v: string) => { raw.set(k,v) }, removeItem: (k: string) => { raw.delete(k) } }
  let now = Date.now(), failure = ''
  const api = createLocalStorageDataAccess({ storage: () => storage, clock: () => now })
  const manager = new MigrationManager(join(dir,'test'), join(dir,'formal','yaya-companion.db'), 'sqlite-test', stage => { if (stage === failure) throw new Error('模拟导入失败') })
  t.after(() => { manager.dispose(); rmSync(dir, { recursive: true, force: true }) })
  const create = (id = 'A') => api.bosses.create({ id, nickname: '迁移老板', hourlyRateCents: 3500, notes: '原备注' })
  const recharge = (id = 'A', amountCents = 7000) => api.balances.changeBalance(id, { type: 'recharge', amountCents, notes: '原充值' })
  return { dir, raw, storage, api, manager, create, recharge, now: () => now, advance: (sec: number) => { now += sec * 1000 }, fail: (stage: string) => { failure = stage } }
}
test('迁移导出完整当前原文/所有旧键及业务字段，不写回原存储', async t => {
  const f = fixture(t), boss = await f.create(); await f.recharge(); const order = await f.api.orders.start('A')
  f.advance(900); await f.api.orders.settle(); await f.api.orders.pause(order.id)
  await f.api.tips.create(boss.profileId!, { amountCents: 2000, receivedAt: new Date(f.now()).toISOString(), notes: '原打赏' })
  f.raw.set(MIGRATION_KEYS[1], JSON.stringify({ version:2, bosses:[],entries:[] })); f.raw.set(MIGRATION_KEYS[2], '[]'); f.raw.set(MIGRATION_KEYS[3], JSON.stringify({ version:1, orders:[] }))
  const before = new Map(f.raw), text = await f.api.migration.exportData(), file = verifiedFile(text)
  assert.deepEqual(f.raw, before); assert.equal(file.rawKeys[APP_STORAGE_KEY], before.get(APP_STORAGE_KEY))
  assert.equal(file.formatVersion, 1); assert.equal(file.dataVersion, 3); assert.equal(file.data.orders[0].status, 'paused'); assert.equal(file.data.orders[0].settledServiceSeconds, 0)
  assert.equal(file.data.orders[0].pauses.length, 1); assert.equal(file.data.tips.length, 1); assert.equal(Object.keys(file.rawKeys).length, 4)
})
test('迁移指纹不受导出时间、属性排列及JSON排版影响，原文篡改拒绝', async t => {
  const f = fixture(t); await f.create()
  const first = await f.api.migration.exportData(); f.advance(10); const second = await f.api.migration.exportData()
  assert.equal(verifiedFile(first).fingerprint, verifiedFile(second).fingerprint)
  const parsed = JSON.parse(first); assert.equal(verifiedFile(JSON.stringify(parsed)).fingerprint, parsed.fingerprint)
  parsed.fingerprint = '0'.repeat(64); assert.throws(() => verifiedFile(JSON.stringify(parsed)), /指纹不一致/)
})
test('非法JSON、版本、金额、时间、身份、流水链和订单进度阻止导出/导入', async t => {
  const f = fixture(t); await f.create(); await f.recharge(); const order = await f.api.orders.start('A'); f.advance(900); await f.api.orders.settle()
  const text = await f.api.migration.exportData(), original = f.raw.get(APP_STORAGE_KEY)!
  assert.throws(() => parseMigration('{'), /无效/)
  assert.throws(() => f.manager.prepare(JSON.stringify({ ...JSON.parse(text), formatVersion: 99 })), /版本/)
  for (const mutate of [
    (s: AppStore) => { s.bosses[0].balanceCents += 1 },
    (s: AppStore) => { Object.assign(s.bosses[0], { profileId: '' }) },
    (s: AppStore) => { s.bosses[0].hourlyRateCents = 1.1 },
    (s: AppStore) => { Object.assign(s.entries[0], { createdAt: 'bad' }) },
    (s: AppStore) => { s.orders[0].settledServiceSeconds += 900 },
    (s: AppStore) => { s.orders.push({ ...s.orders[0], id: 'second' }) },
  ]) {
    const data = JSON.parse(original); mutate(data); f.raw.set(APP_STORAGE_KEY, JSON.stringify(data))
    await assert.rejects(f.api.migration.exportData(), /校验|格式/)
  }
  f.raw.set(APP_STORAGE_KEY, original); assert.equal((await f.api.bosses.list()).length, 1)
  assert.equal(order.id, verifiedFile(text).data.orders[0].id)
})
test('空数据导入、对账、启用、正式重开仍为空；不存在正式库不自动创建', async t => {
  const f = fixture(t); assert.throws(() => openFormalDatabase(f.manager.formalFile), /尚未启用/)
  const before = new Map(f.raw), report = f.manager.prepare(await f.api.migration.exportData())
  assert.equal(report.passed, true); assert.equal(report.before.bosses, 0); assert.deepEqual(f.raw, before)
  assert.equal(existsSync(f.manager.formalFile), false); f.manager.activate(report.token)
  const db = openFormalDatabase(f.manager.formalFile); try { assert.equal(db.snapshot().orders.length, 0) } finally { db.close() }
})
test('完整状态导入保留ID、快照、暂停、金额及所有统计；不执行业务重放', async t => {
  const f = fixture(t), boss = await f.create(); await f.recharge(); const order = await f.api.orders.start('A')
  f.advance(600); await f.api.orders.pause(order.id); f.advance(1200); await f.api.orders.resume(order.id); f.advance(780); await f.api.orders.complete(order.id)
  await f.api.tips.create(boss.profileId!, { amountCents: 2000, receivedAt: new Date(f.now()-3600000).toISOString(), notes: '补录' })
  const file = verifiedFile(await f.api.migration.exportData()), before = new Map(f.raw), report = f.manager.prepare(JSON.stringify(file))
  assert.deepEqual(report.before, report.after); assert.equal(report.before.consumptionCents, 1342); assert.equal(report.before.finalChargeCents, 1342)
  assert.deepEqual(f.raw, before); f.manager.activate(report.token)
  const db = openFormalDatabase(f.manager.formalFile)
  try { const snapshot = db.snapshot(); assert.equal(snapshot.orders[0].id, order.id); assert.deepEqual(snapshot.orders[0].pauses, file.data.orders[0].pauses); assert.deepEqual(summarize(snapshot,file.capturedAt),report.before) } finally { db.close() }
})
test('已删除老板历史及同自定义ID不同profileId迁移后仍隔离', async t => {
  const f = fixture(t), old = await f.create(); await f.recharge(); const o = await f.api.orders.start('A'); f.advance(900); await f.api.orders.complete(o.id)
  await f.api.tips.create(old.profileId!, { amountCents:2000,receivedAt:new Date(f.now()).toISOString(),notes:'' }); await f.api.bosses.remove('A'); const fresh = await f.create()
  const report = f.manager.prepare(await f.api.migration.exportData()); assert.equal(report.before.identities,2); f.manager.activate(report.token)
  const db = openFormalDatabase(f.manager.formalFile)
  try { const s = db.snapshot(); assert.equal(s.bosses[0].profileId,fresh.profileId); assert.equal(s.bosses[0].balanceCents,0); assert.equal(s.orders[0].profileId,old.profileId); assert.equal(s.tips[0].profileId,old.profileId); assert.equal(s.orders[0].nicknameSnapshot,'迁移老板') } finally { db.close() }
})
test('负余额和打赏迁移金额精确保留', async t => {
  const f = fixture(t), b = await f.create(); await f.recharge('A',500); const o = await f.api.orders.start('A'); f.advance(900); await f.api.orders.complete(o.id)
  await f.api.tips.create(b.profileId!,{amountCents:2000,receivedAt:new Date(f.now()).toISOString(),notes:''})
  const r = f.manager.prepare(await f.api.migration.exportData()); assert.equal(r.after.balances[0].balanceCents,-375); assert.equal(r.after.tipCents,2000)
})
for (const paused of [false,true]) test(`迁移${paused ? 'paused' : 'active'}订单保留进度；恢复不重复收费`, async t => {
  const f = fixture(t); await f.create(); await f.recharge(); const o = await f.api.orders.start('A'); f.advance(900); await f.api.orders.settle(); if (paused) await f.api.orders.pause(o.id)
  const file = verifiedFile(await f.api.migration.exportData()), report = f.manager.prepare(JSON.stringify(file)); assert.equal(report.warnings.length,1); f.manager.activate(report.token)
  const db = new SQLiteService(f.manager.formalFile,{clock:()=>f.now()})
  try {
    db.execute('orders.settle'); assert.equal(db.snapshot().entries.length,file.data.entries.length)
    assert.equal(db.snapshot().orders[0].status,paused ? 'paused' : 'active')
    f.advance(900); db.execute('orders.settle'); assert.equal(db.snapshot().entries.length,file.data.entries.length)
    if (paused) { db.execute('orders.resume',[o.id]); f.advance(900); db.execute('orders.settle'); assert.equal(db.snapshot().orders[0].settledAmountCents,0) }
  } finally { db.close() }
})
test('legacyUnbilled及没有profileId的旧资料忠实迁移，不追扣未知余额', async t => {
  const f = fixture(t), start = f.now()-3600000
  const oldOrder: Order = { id:'legacy-order',bossId:'OLD',nicknameSnapshot:'旧昵称',hourlyRateCentsSnapshot:3500,startedAt:start,endedAt:start+900000,status:'completed',accumulatedMs:900000,pauses:[],createdAt:start,settledServiceSeconds:900,settledAmountCents:0,finalChargeCents:0,balanceAtEndCents:null,endReason:'阶段四历史订单（未计费）',legacyUnbilled:true }
  f.raw.set(APP_STORAGE_KEY,JSON.stringify({version:3,bosses:[],entries:[],orders:[oldOrder],tips:[]}))
  const r = f.manager.prepare(await f.api.migration.exportData()); assert.equal(r.before.finalChargeCents,0); f.manager.activate(r.token)
  const db = openFormalDatabase(f.manager.formalFile)
  try { db.execute('orders.settle'); const o = db.snapshot().orders[0]; assert.equal(o.legacyUnbilled,true); assert.equal(o.balanceAtEndCents,null); assert.equal(o.profileId,'legacy:OLD'); assert.equal(db.snapshot().entries.length,0) } finally { db.close() }
})
test('旧兼容键只在内存中转换，保留原文不写回真实存储', async t => {
  const f = fixture(t)
  f.raw.set(MIGRATION_KEYS[2],JSON.stringify([{id:'OLD',nickname:'旧昵称',hourlyRate:35,createdAt:new Date(f.now()).toISOString(),notes:''}]))
  const before = new Map(f.raw), file = verifiedFile(await f.api.migration.exportData())
  assert.deepEqual(f.raw,before); assert.equal(file.data.bosses[0].profileId,'legacy:OLD'); assert.equal(file.data.bosses[0].hourlyRateCents,3500)
  assert.equal(file.rawKeys[APP_STORAGE_KEY],null)
})
for (const stage of ['after-profiles','after-orders','after-entries','after-tips','before-import-commit']) test(`导入${stage}失败废弃临时库，原文/测试库/正式库不变`, async t => {
  const f = fixture(t), b = await f.create(); await f.recharge(); const o = await f.api.orders.start('A'); f.advance(900); await f.api.orders.complete(o.id); await f.api.tips.create(b.profileId!,{amountCents:2000,receivedAt:new Date(f.now()).toISOString(),notes:''})
  const before = new Map(f.raw), text = await f.api.migration.exportData(); f.fail(stage)
  assert.throws(()=>f.manager.prepare(text),/模拟导入失败/); assert.deepEqual(f.raw,before); assert.equal(existsSync(f.manager.formalFile),false); assert.deepEqual(readdirSync(join(f.dir,'test','migration-staging')),[])
  f.fail(''); assert.equal(f.manager.prepare(text).passed,true)
})
test('导入事务失败时表中没有半份业务或import_batches', async t => {
  const f = fixture(t); await f.create(); await f.recharge(); const file = verifiedFile(await f.api.migration.exportData()), db = new SQLiteService(':memory:')
  try { assert.throws(()=>importState(db,file,stage=>{if(stage==='after-entries')throw new Error('故障')}),/故障/); assert.equal(db.snapshot().bosses.length,0); assert.equal(db.database.prepare('SELECT count(*) AS n FROM import_batches').get()!.n,0) } finally { db.close() }
})
test('同一文件同一库重复导入拒绝；取消不影响原资料；正式库禁止覆盖', async t => {
  const f = fixture(t); await f.create(); const text = await f.api.migration.exportData(), file = verifiedFile(text), db = new SQLiteService(':memory:')
  try { importState(db,file); assert.throws(()=>importState(db,file),/不能重复/); assert.equal(db.snapshot().bosses.length,1) } finally { db.close() }
  const report = f.manager.prepare(text); assert.throws(()=>f.manager.prepare(text),/重复导入/); assert.equal(f.manager.status().pending?.token,report.token)
  f.manager.discard(report.token); const second = f.manager.prepare(text); f.manager.activate(second.token)
  assert.throws(()=>f.manager.prepare(text),/重复导入/); assert.equal((await f.api.bosses.list()).length,1)
})
test('对账发现记录篡改即失败，启用失败不会创建正式库', async t => {
  const f = fixture(t); await f.create(); await f.recharge(); const file = verifiedFile(await f.api.migration.exportData()), r = f.manager.prepare(JSON.stringify(file))
  const path = join(f.dir,'test','migration-staging',`${r.token}.db`), db = new SQLiteService(path)
  try { db.database.prepare('UPDATE boss_profiles SET notes=?').run('篡改'); assert.equal(reconcile(file,db).passed,false) } finally { db.close() }
  assert.throws(()=>f.manager.activate(r.token),/禁止启用/); assert.equal(existsSync(f.manager.formalFile),false)
})
test('正式启用失败可重试；成功后重启正式库数据保留，测试库不受影响', async t => {
  const f = fixture(t); await f.create(); await f.recharge()
  const testDb = new SQLiteService(join(f.dir,'test.db')); testDb.execute('bosses.create',[{id:'TEST',nickname:'',hourlyRateCents:3500,notes:''}])
  try {
    const r = f.manager.prepare(await f.api.migration.exportData()); f.fail('before-activate'); assert.throws(()=>f.manager.activate(r.token),/模拟导入失败/); assert.equal(existsSync(f.manager.formalFile),false)
    f.fail(''); f.manager.activate(r.token)
    let db = openFormalDatabase(f.manager.formalFile); assert.equal((db.execute('bosses.list') as Boss[])[0].balanceCents,7000); db.close(); db = openFormalDatabase(f.manager.formalFile)
    try { assert.equal(db.snapshot().bosses[0].id,'A') } finally { db.close() }
    assert.equal(testDb.snapshot().bosses[0].id,'TEST'); assert.equal(testDb.snapshot().orders.length,0)
  } finally { testDb.close() }
})
test('v1 SQLite升级v2保留订单与外键数据，增加legacy支持', () => {
  const dir = mkdtempSync(join(tmpdir(),'yaya-schema-upgrade-')), file = join(dir,'v1.db')
  try {
    const old = new DatabaseSync(file); old.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at INTEGER NOT NULL) STRICT'); old.exec(migrations[0].sql); old.prepare('INSERT INTO schema_migrations VALUES (1,?,?)').run(migrations[0].name,Date.now())
    old.exec("INSERT INTO boss_identities VALUES ('P','A',1); INSERT INTO boss_profiles VALUES ('P','A','昵称',3500,7000,1,''); INSERT INTO orders VALUES ('O','P','A','昵称',3500,1,1,'completed',0,0,0,0,7000,'用户手动结束',1); INSERT INTO balance_entries VALUES ('E','P','A','昵称',NULL,'recharge',7000,0,7000,NULL,1,'')"); old.close()
    const db = new SQLiteService(file)
    try { assert.equal(db.snapshot().orders[0].id,'O'); assert.equal(db.snapshot().entries[0].id,'E'); assert.equal(db.database.prepare('PRAGMA foreign_keys').get()!.foreign_keys,1); assert.equal(db.database.prepare('PRAGMA foreign_key_check').all().length,0) } finally { db.close() }
  } finally { rmSync(dir,{recursive:true,force:true}) }
})
test('正式模式拒绝清除测试数据，业务和导入验收记录保持完整', async t => {
  const f = fixture(t); await f.create(); await f.recharge(); const r = f.manager.prepare(await f.api.migration.exportData()); f.manager.activate(r.token)
  const db = openFormalDatabase(f.manager.formalFile), manager = new MigrationManager(join(f.dir,'formal'),f.manager.formalFile,'sqlite')
  try {
    const api = new DesktopDataService(db,manager), before = db.snapshot()
    assert.throws(()=>api.execute('development.clear',[]),/不提供/); assert.deepEqual(db.snapshot(),before)
    assert.equal(db.database.prepare('SELECT count(*) AS n FROM import_batches').get()!.n,1)
  } finally { manager.dispose(); db.close() }
})
