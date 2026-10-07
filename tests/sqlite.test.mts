import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteService } from '../electron/sqlite/service.ts'
import type { BusinessMethod } from '../electron/sqlite/service.ts'
import type { Boss, BalanceEntry } from '../src/features/bosses/types.ts'
import type { Order } from '../src/features/orders/types.ts'
import type { Tip } from '../src/features/tips/types.ts'
import type { HistoryData } from '../src/features/data/contracts.ts'
import { serviceSeconds } from '../src/features/orders/billing.ts'
import { calculateStatistics } from '../src/features/statistics/statistics.ts'

function fixture(t: TestContext) {
  let now = Date.parse('2026-10-07T00:00:00Z'), failure = ''
  const service = new SQLiteService(':memory:', { clock: () => now, checkpoint: stage => { if (stage === failure) throw new Error('模拟中途写入失败') } })
  t.after(() => service.close())
  function call<T>(method: BusinessMethod, ...args: unknown[]) { return service.execute(method, args) as T }
  const create = (id = 'A') => call<Boss>('bosses.create', { id, nickname: '老板', hourlyRateCents: 3500, notes: '' })
  const recharge = (id = 'A', cents = 7000) => call<Boss>('balances.changeBalance', id, { type: 'recharge', amountCents: cents, notes: '充值' })
  return { service, call, create, recharge, advance: (seconds: number) => { now += seconds * 1000 }, now: () => now, fail: (stage: string) => { failure = stage } }
}

test('SQLite 建立8张表、严格整数/外键和只执行一次 schema migration', t => {
  const f = fixture(t), db = f.service.database
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  assert.deepEqual(tables.sort(), ['boss_identities','boss_profiles','orders','order_pauses','balance_entries','tips','schema_migrations','import_batches','app_metadata'].sort())
  assert.equal(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys, 1)
  assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n, 5)
  const boss = f.create()
  assert.throws(() => db.prepare('UPDATE boss_profiles SET balance_cents = 1.5 WHERE profile_id = ?').run(boss.profileId!), /INTEGER/)
  assert.throws(() => db.prepare('DELETE FROM boss_identities WHERE profile_id = ?').run(boss.profileId!), /FOREIGN KEY/)
})
test('SQLite 老板CRUD、ID唯一、选填重复昵称和创建时间', t => {
  const f = fixture(t), a = f.create()
  assert.throws(() => f.create(' A '), /已存在/)
  assert.throws(() => f.create(' '), /不能为空/)
  f.create('B')
  const b = f.call<Boss>('bosses.update', a.id, { nickname: '', hourlyRateCents: 4000, notes: ' 备注 ' })
  assert.equal(b.nickname, ''); assert.equal(b.notes, '备注'); assert.equal(b.createdAt, a.createdAt)
  f.call('bosses.remove', 'B'); assert.equal(f.call<Boss[]>('bosses.list').length, 1)
})
test('SQLite 充值和调整同时更新余额与正确流水', t => {
  const f = fixture(t); f.create(); f.recharge()
  f.call('balances.changeBalance', 'A', { type: 'manual_add', amountCents: 1000, notes: '' })
  f.call('balances.changeBalance', 'A', { type: 'manual_deduct', amountCents: 500, notes: '' })
  const entries = f.call<BalanceEntry[]>('balances.entries', 'A')
  assert.equal(f.call<Boss[]>('bosses.list')[0].balanceCents, 7500)
  assert.deepEqual(entries.map(e => [e.beforeCents, e.deltaCents, e.afterCents]), [[8000,-500,7500],[7000,1000,8000],[0,7000,7000]])
  assert.throws(() => f.call('balances.changeBalance', 'A', { type: 'manual_deduct', amountCents: 8000, notes: '' }), /余额不足/)
})
test('SQLite 订单创建检查余额、单价并保存快照', t => {
  const f = fixture(t), boss = f.create()
  assert.throws(() => f.call('orders.start', 'missing'), /不存在/)
  assert.throws(() => f.call('orders.start', 'A'), /余额必须大于/)
  f.recharge()
  const o = f.call<Order>('orders.start', 'A')
  f.call('bosses.update', 'A', { nickname: '新昵称', hourlyRateCents: 5000, notes: '' })
  assert.equal(o.profileId, boss.profileId); assert.equal(o.nicknameSnapshot, '老板'); assert.equal(o.hourlyRateCentsSnapshot, 3500)
  f.advance(900); assert.equal(f.call<Order[]>('orders.settle')[0].settledAmountCents, 0)
})
test('SQLite 单一active/paused服务及数据库级约束，活动老板不可删除', t => {
  const f = fixture(t); f.create(); f.create('B'); f.recharge(); f.recharge('B')
  const o = f.call<Order>('orders.start', 'A')
  assert.throws(() => f.call('orders.start', 'B'), /当前正在服务/)
  f.call('orders.pause', o.id)
  assert.throws(() => f.call('orders.start', 'B'), /暂停中的订单/)
  assert.throws(() => f.call('bosses.remove', 'A'), /请先结束订单/)
  assert.throws(() => f.service.database.prepare("INSERT INTO orders SELECT 'second',profile_id,boss_id_snapshot,nickname_snapshot,hourly_rate_cents_snapshot,started_at,ended_at,status,accumulated_ms,settled_service_seconds,settled_amount_cents,final_charge_cents,balance_at_end_cents,end_reason,created_at,legacy_unbilled,billing_model FROM orders WHERE order_id=?").run(o.id), /UNIQUE/)
  assert.throws(() => f.service.database.prepare("UPDATE orders SET status='unknown' WHERE order_id=?").run(o.id), /CHECK/)
})
test('SQLite 暂停不计时扣费，恢复后按有效时间结算', t => {
  const f = fixture(t); f.create(); f.recharge(); const o = f.call<Order>('orders.start', 'A')
  f.advance(600); f.call('pauses.pause', o.id); f.advance(3600)
  const paused = f.call<Order[]>('orders.settle')[0]
  assert.equal(serviceSeconds(paused, f.now()), 600); assert.equal(paused.settledAmountCents, 0)
  f.call('pauses.resume', o.id); f.advance(300)
  assert.equal(f.call<Order[]>('orders.settle')[0].settledAmountCents, 0)
  assert.equal(f.call<{ startedAt: number; endedAt: number }[]>('pauses.list', o.id)[0].endedAt - paused.pauses[0].startedAt, 3600000)
})
test('SQLite 3小时期间不写账，结束仅一条流水并防重复', t => {
  const f=fixture(t);f.create();f.recharge();const o=f.call<Order>('orders.start','A')
  const before=f.service.snapshot();f.advance(900);f.call('orders.settle');f.advance(9900);f.call('orders.settle')
  assert.deepEqual(f.service.snapshot(),before);assert.equal(f.service.lastChanged,false)
  const done=f.call<Order>('orders.complete',o.id);assert.equal(done.finalChargeCents,10500);assert.equal(done.balanceAtEndCents,-3500)
  const entries=f.call<BalanceEntry[]>('balances.entries','A').filter(e=>e.type==='order_consumption');assert.equal(entries.length,1)
  assert.throws(()=>f.service.database.exec("INSERT INTO balance_entries SELECT 'duplicate',profile_id,boss_id_snapshot,nickname_snapshot,order_id,type,delta_cents,before_cents,after_cents,settled_through_seconds,created_at,notes FROM balance_entries WHERE type='order_consumption' LIMIT 1"),/只允许|UNIQUE/)
})
test('SQLite 23分钟一次扣1342分，总1342分，保存结束余额及原因', t => {
  const f = fixture(t); f.create(); f.recharge(); const o = f.call<Order>('orders.start', 'A')
  f.advance(900); f.call('orders.settle'); f.advance(480)
  const ended = f.call<Order>('orders.complete', o.id)
  assert.equal(ended.status, 'completed'); assert.equal(ended.finalChargeCents, 1342); assert.equal(ended.settledServiceSeconds, 1380)
  assert.equal(ended.balanceAtEndCents, 5658); assert.equal(ended.endReason, '用户手动结束')
  assert.equal(f.call<BalanceEntry[]>('balances.entries', 'A')[0].deltaCents, -1342)
  assert.throws(() => f.call('orders.complete', o.id), /已结束/)
})
test('SQLite 余额可负、充值补回、清零留流水',t=>{
  const f=fixture(t);f.create();f.recharge('A',500);const o=f.call<Order>('orders.start','A');f.advance(900)
  f.call('orders.settle');assert.equal(f.call<Boss[]>('bosses.list')[0].balanceCents,500)
  assert.equal(f.call<Order>('orders.complete',o.id).balanceAtEndCents,-375)
  assert.equal(f.recharge('A',200).balanceCents,-175)
  f.call('balances.clearDebt','A');const entry=f.call<BalanceEntry[]>('balances.entries','A')[0];assert.equal(entry.deltaCents,175);assert.equal(entry.afterCents,0)
})
test('SQLite 打赏CRUD独立余额、receivedAt和快照不变', t => {
  const f = fixture(t), boss = f.create(); f.recharge()
  const receivedAt = '2026-10-06T03:00:00Z'
  const tip = f.call<Tip>('tips.create', boss.profileId, { amountCents: 2000, receivedAt, notes: '' })
  const updated = f.call<Tip>('tips.update', tip.id, { amountCents: 2500, receivedAt: '2026-10-07T01:00:00Z', notes: '改', profileId: 'other' })
  assert.equal(updated.profileId, boss.profileId); assert.equal(updated.amountCents, 2500)
  assert.equal(updated.receivedAt, '2026-10-07T01:00:00.000Z')
  assert.equal(f.call<Boss[]>('bosses.list')[0].balanceCents, 7000); assert.equal(f.call<BalanceEntry[]>('balances.entries', 'A').length, 1)
  for (const amountCents of [0,-1,1.5]) assert.throws(() => f.call('tips.create', boss.profileId, { amountCents, receivedAt, notes: '' }), /大于/)
  assert.throws(() => f.service.database.prepare('UPDATE tips SET amount_cents=0 WHERE tip_id=?').run(tip.id), /CHECK/)
  f.call('tips.remove', tip.id); assert.equal(f.call<Tip[]>('tips.list').length, 0)
})
test('SQLite 删除老板保留身份和所有历史，同ID重建不继承旧数据', t => {
  const f = fixture(t), old = f.create(); f.recharge(); const order = f.call<Order>('orders.start', 'A')
  f.advance(900); f.call('orders.complete', order.id)
  f.call('tips.create', old.profileId, { amountCents: 2000, receivedAt: new Date(f.now()).toISOString(), notes: '' })
  f.call('bosses.remove', 'A'); const fresh = f.create()
  assert.notEqual(fresh.profileId, old.profileId); assert.equal(fresh.balanceCents, 0)
  assert.equal(f.call<BalanceEntry[]>('balances.entries', 'A').length, 0); assert.equal(f.call<Tip[]>('tips.list', fresh.profileId).length, 0)
  const h = f.call<HistoryData>('history.read')
  assert.equal(h.orders[0].bossId, 'A'); assert.equal(h.orders[0].nicknameSnapshot, '老板'); assert.equal(h.entries.length, 2); assert.equal(h.tips.length, 1)
  assert.throws(() => f.call('tips.create', old.profileId, { amountCents: 2000, receivedAt: new Date(f.now()).toISOString(), notes: '' }), /资料已删除/)
})
test('SQLite 统计一致快照复用现有计算，不依赖当前老板资料', t => {
  const f = fixture(t), boss = f.create(); f.recharge(); f.call('balances.changeBalance', 'A', { type: 'manual_add', amountCents: 1000, notes: '' })
  f.call('tips.create', boss.profileId, { amountCents: 2000, receivedAt: new Date(f.now()).toISOString(), notes: '' })
  const order = f.call<Order>('orders.start', 'A'); f.advance(900); f.call('orders.complete', order.id); f.call('bosses.remove', 'A')
  const data = f.call<HistoryData>('statistics.read')
  const metrics = calculateStatistics(data, { start: f.now() - 900000, end: f.now() })
  assert.equal(metrics.serviceIncomeCents, 875); assert.equal(metrics.rechargeCents, 7000); assert.equal(metrics.tipCents, 2000)
})
for (const stage of ['after-entry','after-balance','after-settlement-progress','after-order-result','before-commit']) {
  test(`SQLite 订单事务 ${stage} 失败，余额/流水/进度/结束结果全部回滚`, t => {
    const f = fixture(t); f.create(); f.recharge(); const o = f.call<Order>('orders.start', 'A'); f.advance(1380)
    const before = f.call<HistoryData>('history.read'); f.fail(stage)
    assert.throws(() => f.call('orders.complete', o.id), /模拟中途/)
    f.fail(''); assert.deepEqual(f.call('history.read'), before); assert.equal(f.call<Boss[]>('bosses.list')[0].balanceCents, 7000)
    assert.equal(f.call<Order>('orders.complete', o.id).finalChargeCents, 1342)
  })
}
test('SQLite 充值和删除事务失败不留下半笔账/资料，后续仍可执行', t => {
  const f = fixture(t); f.create(); f.fail('after-entry')
  assert.throws(() => f.recharge(), /模拟中途/); f.fail('')
  assert.equal(f.call<Boss[]>('bosses.list')[0].balanceCents, 0); assert.equal(f.call<BalanceEntry[]>('balances.entries', 'A').length, 0)
  f.fail('before-commit'); assert.throws(() => f.call('bosses.remove', 'A'), /模拟中途/); f.fail('')
  assert.equal(f.call<Boss[]>('bosses.list').length, 1); assert.equal(f.recharge().balanceCents, 7000)
})
test('SQLite 清理所有测试数据保留schema，不删除库文件或localStorage', t => {
  const f = fixture(t), boss = f.create(); f.recharge(); f.call('orders.start', 'A')
  f.call('tips.create', boss.profileId, { amountCents: 2000, receivedAt: new Date(f.now()).toISOString(), notes: '' })
  f.call('development.clear'); assert.deepEqual(f.call('history.read'), { orders: [], entries: [], tips: [] })
  assert.equal(f.call<Boss[]>('bosses.list').length, 0); assert.equal(f.service.database.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n, 5)
})
test('SQLite 重开数据库恢复active/暂停/历史，计时恢复且不写消费流水', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaya-sqlite-')), file = join(dir, 'yaya-companion-test.db')
  let now = 1800000000000, service = new SQLiteService(file, { clock: () => now })
  try {
    const boss = service.execute('bosses.create', [{ id: 'A', nickname: '', hourlyRateCents: 3500, notes: '' }]) as Boss
    service.execute('balances.changeBalance', ['A', { type: 'recharge', amountCents: 7000, notes: '' }])
    const order = service.execute('orders.start', ['A']) as Order
    service.close(); now += 2700000; service = new SQLiteService(file, { clock: () => now })
    const recovered = (service.execute('orders.settle') as Order[])[0]
    assert.equal(recovered.settledAmountCents, 0); assert.equal((service.execute('history.read') as HistoryData).entries.length, 1)
    service.execute('orders.settle'); assert.equal(service.lastChanged, false); assert.equal((service.execute('history.read') as HistoryData).entries.length, 1)
    service.execute('orders.pause', [order.id]); service.close(); now += 3600000; service = new SQLiteService(file, { clock: () => now })
    assert.equal((service.execute('orders.list') as Order[])[0].status, 'paused')
    assert.equal(serviceSeconds((service.execute('orders.list') as Order[])[0], now), 2700)
    assert.equal((service.execute('bosses.list') as Boss[])[0].profileId, boss.profileId)
    assert.equal(service.database.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n, 5)
  } finally { service.close(); rmSync(dir, { recursive: true, force: true }) }
})
test('SQLite 拒绝不属于本应用或高版本的数据库，不覆盖原数据', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaya-schema-')), file = join(dir, 'existing.db')
  try {
    const db = new DatabaseSync(file); db.exec('CREATE TABLE personal(value TEXT); INSERT INTO personal VALUES (\'保留\')'); db.close()
    assert.throws(() => new SQLiteService(file), /未覆盖/)
    const check = new DatabaseSync(file); assert.equal(check.prepare('SELECT value FROM personal').get()!.value, '保留'); check.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('SQLite 高版本迁移记录被拒绝且原数据库保留', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaya-future-schema-')), file = join(dir, 'future.db')
  try {
    const service = new SQLiteService(file)
    service.database.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(99, 'future', Date.now()); service.close()
    assert.throws(() => new SQLiteService(file), /版本不受/)
    const db = new DatabaseSync(file); assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n, 6); db.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
