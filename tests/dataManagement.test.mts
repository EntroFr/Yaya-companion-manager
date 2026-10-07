import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LocalStorageBossRepository } from '../src/features/bosses/bossRepository.ts'
import { LocalStorageOrderRepository } from '../src/features/orders/orderRepository.ts'
import { readStore, APP_STORAGE_KEY } from '../src/features/storage/appStore.ts'
import { clearTestData, TEST_DATA_KEYS } from '../src/features/storage/testData.ts'

function setup() {
  const data = new Map<string, string>()
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
  let now = 1700000000000
  return { data, storage, bosses: new LocalStorageBossRepository(() => storage), orders: new LocalStorageOrderRepository({ storage: () => storage, clock: () => now }), advance: () => { now += 900000 } }
}
const input = { id: 'A', nickname: '旧昵称', hourlyRateCents: 3500, notes: '' }
test('active和paused均禁止删除；完成后删除保留订单流水，刷新可读', async () => {
  const s = setup()
  await s.bosses.create(input); await s.bosses.changeBalance('A', { type: 'recharge', amountCents: 7000, notes: '' })
  const o = await s.orders.start('A')
  await assert.rejects(s.bosses.remove('A'), /该老板当前存在进行中的订单，请先结束订单后再删除。/)
  await s.orders.pause(o.id)
  await assert.rejects(s.bosses.remove('A'), /请先结束订单/)
  await s.orders.resume(o.id); s.advance(); await s.orders.complete(o.id)
  const before = readStore(s.storage)
  await s.bosses.remove('A')
  const after = readStore(s.storage)
  assert.deepEqual(after.orders, before.orders); assert.deepEqual(after.entries, before.entries)
  assert.equal(after.bosses.length, 0); assert.equal(after.entries[1].nicknameSnapshot, '旧昵称')
  assert.equal((await s.orders.settle()).length, 1)
})
test('重新创建同ID使用新资料标识，余额及流水与旧资料隔离，旧历史不变', async () => {
  const s = setup()
  const old = await s.bosses.create(input)
  await s.bosses.changeBalance('A', { type: 'recharge', amountCents: 7000, notes: '' })
  const o = await s.orders.start('A'); s.advance(); await s.orders.complete(o.id)
  await s.bosses.remove('A'); const history = readStore(s.storage)
  const fresh = await s.bosses.create({ ...input, nickname: '新昵称' })
  assert.notEqual(fresh.profileId, old.profileId); assert.equal(fresh.balanceCents, 0)
  assert.deepEqual(await s.bosses.entries('A'), [])
  await s.bosses.changeBalance('A', { type: 'recharge', amountCents: 1000, notes: '' })
  const next = await s.orders.start('A'); s.advance(); await s.orders.complete(next.id)
  const current = readStore(s.storage)
  assert.deepEqual(current.orders[0], history.orders[0]); assert.deepEqual(current.entries.slice(0, 2), history.entries)
  assert.equal(current.bosses[0].balanceCents, 125)
  assert.equal((await s.bosses.entries('A')).length, 2)
})
test('旧v3资料删除后历史保留，同ID重建不继承旧余额或流水', async () => {
  const s = setup(); await s.bosses.create(input); await s.bosses.changeBalance('A', { type: 'recharge', amountCents: 100, notes: '' })
  const raw = readStore(s.storage)
  raw.bosses.forEach(b => { delete (b as { profileId?: string }).profileId })
  raw.entries.forEach(e => { delete (e as { profileId?: string; nicknameSnapshot?: string }).profileId; delete (e as { nicknameSnapshot?: string }).nicknameSnapshot })
  s.data.set(APP_STORAGE_KEY, JSON.stringify(raw))
  await s.bosses.remove('A'); await s.bosses.create(input)
  assert.equal((await s.bosses.list())[0].balanceCents, 0); assert.deepEqual(await s.bosses.entries('A'), [])
  assert.equal(readStore(s.storage).entries[0].nicknameSnapshot, '旧昵称')
})
test('集中清理当前和旧版本键，正在进行订单也清空，保留无关存储且不复活旧数据', async () => {
  const s = setup(); await s.bosses.create(input); await s.bosses.changeBalance('A', { type: 'recharge', amountCents: 100, notes: '' }); await s.orders.start('A')
  for (const k of TEST_DATA_KEYS.slice(1)) s.data.set(k, '旧测试备份')
  s.data.set('other-app', '保留')
  await clearTestData(s.storage)
  assert.ok(TEST_DATA_KEYS.every(k => !s.data.has(k)))
  assert.deepEqual(readStore(s.storage), { version: 3, bosses: [], entries: [], orders: [], tips: [] })
  assert.equal(s.data.get('other-app'), '保留')
  assert.deepEqual(await s.orders.settle(), [])
})
