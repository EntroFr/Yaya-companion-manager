import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LocalStorageBossRepository, BOSS_STORAGE_KEY } from '../src/features/bosses/bossRepository.ts'
import { LocalStorageOrderRepository } from '../src/features/orders/orderRepository.ts'
import { APP_STORAGE_KEY as ORDER_STORAGE_KEY } from '../src/features/storage/appStore.ts'
import { formatDuration, serviceDurationMs } from '../src/features/orders/orderTime.ts'

function setup() {
  const data = new Map<string, string>()
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  const bosses = new LocalStorageBossRepository(() => storage)
  let now = 1000000
  let queue: Promise<unknown> = Promise.resolve()
  function lock<T>(action: () => Promise<T>): Promise<T> {
    const result = queue.then(action)
    queue = result.catch(() => {})
    return result
  }
  const options = { storage: () => storage, clock: () => now, lock }
  const repo = new LocalStorageOrderRepository(options)
  async function addBoss(id = 'boss-01', rate = 3500, balance = 7000) {
    await bosses.create({ id, nickname: `昵称-${id}`, hourlyRateCents: rate, notes: '' })
    if (balance > 0) await bosses.changeBalance(id, { type: 'recharge', amountCents: balance, notes: '' })
  }
  return { data, storage, bosses, repo, options, addBoss, advance: (ms: number) => { now += ms }, time: () => now }
}

test('创建订单检查老板、余额与单价；初始状态及快照完整', async () => {
  const s = setup()
  await assert.rejects(s.repo.start('missing'), /老板不存在/)
  await s.addBoss('zero-balance', 3500, 0)
  await assert.rejects(s.repo.start('zero-balance'), /余额必须大于 0/)
  await s.addBoss('zero-rate', 0)
  await assert.rejects(s.repo.start('zero-rate'), /单价必须大于 0/)
  await s.addBoss()
  const order = await s.repo.start('boss-01')
  assert.equal(order.status, 'active')
  assert.equal(order.bossId, 'boss-01')
  assert.equal(order.nicknameSnapshot, '昵称-boss-01')
  assert.equal(order.hourlyRateCentsSnapshot, 3500)
  assert.equal(order.startedAt, s.time())
  assert.equal(order.createdAt, order.startedAt)
  assert.equal(order.endedAt, null)
  assert.equal(order.accumulatedMs, 0)
  assert.deepEqual(order.pauses, [])
})

test('同一时间只允许一个订单，暂停也占名额；并发开始只有一个成功', async () => {
  const s = setup()
  await s.addBoss(); await s.addBoss('boss-02')
  const other = new LocalStorageOrderRepository(s.options)
  const results = await Promise.allSettled([s.repo.start('boss-01'), other.start('boss-02')])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal((await s.repo.list()).length, 1)
  const [order] = await s.repo.list()
  await assert.rejects(s.repo.start('boss-02'), /当前正在服务「昵称-boss-01」/)
  await s.repo.pause(order.id)
  await assert.rejects(s.repo.start('boss-02'), /暂停中的订单/)
})

test('多次暂停排除暂停时间，恢复继续累计，完成保存最终时长', async () => {
  const s = setup(); await s.addBoss()
  const order = await s.repo.start('boss-01')
  s.advance(10000)
  const paused = await s.repo.pause(order.id)
  assert.equal(paused.accumulatedMs, 10000)
  s.advance(60000)
  assert.equal(serviceDurationMs(paused, s.time()), 10000)
  const resumed = await s.repo.resume(order.id)
  assert.equal(resumed.pauses[0].endedAt, s.time())
  s.advance(5000)
  assert.equal(serviceDurationMs(resumed, s.time()), 15000)
  await s.repo.pause(order.id)
  s.advance(30000)
  await s.repo.resume(order.id)
  s.advance(7000)
  const completed = await s.repo.complete(order.id)
  assert.equal(completed.accumulatedMs, 22000)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.endedAt, s.time())
  assert.equal(formatDuration(completed.accumulatedMs), '00:00:22')
  s.advance(100000)
  assert.equal(serviceDurationMs(completed, s.time()), 22000)
  assert.equal((await s.repo.list()).filter(o => o.status !== 'completed').length, 0)
})

test('暂停中结束，暂停直到结束期间不计时；结束后不能再暂停或恢复', async () => {
  const s = setup(); await s.addBoss()
  const order = await s.repo.start('boss-01')
  s.advance(3000); await s.repo.pause(order.id)
  s.advance(120000)
  const completed = await s.repo.complete(order.id)
  assert.equal(completed.accumulatedMs, 3000)
  assert.equal(completed.pauses[0].endedAt, completed.endedAt)
  await assert.rejects(s.repo.resume(order.id), /已结束/)
  await assert.rejects(s.repo.pause(order.id), /已结束/)
  await assert.rejects(s.repo.complete(order.id), /已结束/)
})

test('重建存储实例恢复 active 和 paused；长时间不刷新界面也能正确计算', async () => {
  const s = setup(); await s.addBoss()
  const order = await s.repo.start('boss-01')
  s.advance(3600000)
  const restored = new LocalStorageOrderRepository(s.options)
  const [active] = await restored.list()
  assert.equal(serviceDurationMs(active, s.time()), 3600000)
  await restored.pause(order.id)
  s.advance(7200000)
  const [paused] = await new LocalStorageOrderRepository(s.options).list()
  assert.equal(paused.status, 'paused')
  assert.equal(serviceDurationMs(paused, s.time()), 3600000)
  await restored.resume(order.id)
  s.advance(10000)
  const completed = await restored.complete(order.id)
  assert.equal(completed.accumulatedMs, 3610000)
  assert.equal(formatDuration(3610000), '01:00:10')
  assert.equal((await new LocalStorageOrderRepository(s.options).list())[0].status, 'completed')
})

test('老板单价及昵称修改不会影响订单快照，结束按旧单价扣费', async () => {
  const s = setup(); await s.addBoss()
  const order = await s.repo.start('boss-01')
  await s.bosses.update('boss-01', { nickname: '新昵称', hourlyRateCents: 7000, notes: '' })
  const accountsBefore = JSON.parse(s.data.get(BOSS_STORAGE_KEY)!)
  const [saved] = await s.repo.list()
  assert.equal(saved.hourlyRateCentsSnapshot, 3500)
  assert.equal(saved.nicknameSnapshot, '昵称-boss-01')
  s.advance(10000); await s.repo.pause(order.id)
  s.advance(10000); await s.repo.resume(order.id)
  s.advance(10000); await s.repo.complete(order.id)
  const accountsAfter = JSON.parse(s.data.get(BOSS_STORAGE_KEY)!)
  assert.equal(accountsAfter.bosses[0].balanceCents, accountsBefore.bosses[0].balanceCents - 19)
  assert.equal(accountsAfter.entries.at(-1).type, 'order_consumption')
  const next = await s.repo.start('boss-01')
  assert.equal(next.hourlyRateCentsSnapshot, 7000)
  assert.equal(next.nicknameSnapshot, '新昵称')
})

test('历史记录最新在前，非法状态转换拒绝，保存失败原状态不改变', async () => {
  const s = setup(); await s.addBoss()
  const first = await s.repo.start('boss-01')
  await assert.rejects(s.repo.resume(first.id), /只有暂停/)
  await s.repo.pause(first.id)
  await assert.rejects(s.repo.pause(first.id), /只有进行/)
  const raw = s.data.get(ORDER_STORAGE_KEY)
  const broken = new LocalStorageOrderRepository({ ...s.options, storage: () => ({ ...s.storage, setItem: () => { throw new Error('quota') } }) })
  await assert.rejects(broken.resume(first.id), /保存失败/)
  assert.equal(s.data.get(ORDER_STORAGE_KEY), raw)
  await s.repo.complete(first.id)
  s.advance(1000)
  const second = await s.repo.start('boss-01')
  await s.repo.complete(second.id)
  assert.deepEqual((await s.repo.list()).map(o => o.id), [second.id, first.id])
})

test('损坏存储及多个未结束订单被拒绝，系统时间倒退不能写入操作', async () => {
  const s = setup(); await s.addBoss()
  const order = await s.repo.start('boss-01')
  s.advance(1000); await s.repo.pause(order.id)
  const before = s.data.get(ORDER_STORAGE_KEY)
  s.advance(-1000)
  await assert.rejects(s.repo.resume(order.id), /系统时间/)
  assert.equal(s.data.get(ORDER_STORAGE_KEY), before)
  const damaged = JSON.parse(before!)
  damaged.orders.push({ ...damaged.orders[0], id: 'duplicate-active' })
  const invalid = JSON.stringify(damaged)
  s.data.set(ORDER_STORAGE_KEY, invalid)
  await assert.rejects(s.repo.list(), /格式异常/)
  await assert.rejects(s.repo.start('boss-01'), /格式异常/)
  assert.equal(s.data.get(ORDER_STORAGE_KEY), invalid)
})


