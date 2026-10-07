import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LocalStorageTipRepository, totalTipCents } from '../src/features/tips/tipRepository.ts'
import { LocalStorageBossRepository } from '../src/features/bosses/bossRepository.ts'
import { LocalStorageOrderRepository } from '../src/features/orders/orderRepository.ts'
import { readStore, APP_STORAGE_KEY, profileKey } from '../src/features/storage/appStore.ts'
import { clearTestData } from '../src/features/storage/testData.ts'
import { localDateTime, receivedAtIso } from '../src/features/tips/tipTime.ts'

async function setup() {
  const data = new Map<string, string>()
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
  const bosses = new LocalStorageBossRepository(() => storage)
  const boss = await bosses.create({ id: 'A', nickname: '小鱼', hourlyRateCents: 3500, notes: '' })
  await bosses.changeBalance('A', { type: 'recharge', amountCents: 7000, notes: '' })
  return { data, storage, bosses, boss, tips: new LocalStorageTipRepository(() => storage) }
}
const input = { amountCents: 2000, receivedAt: '2026-10-07T05:30:00.000Z', notes: '下午补录' }

test('新增20元打赏不改余额和流水，也不修改订单；保存快照、整数分与时间', async () => {
  const s = await setup()
  const orders = new LocalStorageOrderRepository({ storage: () => s.storage })
  await orders.start('A')
  const before = readStore(s.storage)
  const tip = await s.tips.create(profileKey(s.boss), input)
  const after = readStore(s.storage)
  assert.deepEqual(after.bosses, before.bosses); assert.deepEqual(after.entries, before.entries); assert.deepEqual(after.orders, before.orders)
  assert.equal(tip.amountCents, 2000); assert.equal(tip.bossIdSnapshot, 'A'); assert.equal(tip.nicknameSnapshot, '小鱼')
  assert.equal(tip.profileId, profileKey(s.boss)); assert.equal(tip.receivedAt, input.receivedAt)
  assert.equal(tip.createdAt, tip.updatedAt); assert.ok(Number.isFinite(Date.parse(tip.createdAt)))
})
test('多条打赏累计、修改金额时间备注、删除后累计同步，按发生时间排序', async () => {
  const s = await setup(), p = profileKey(s.boss)
  const first = await s.tips.create(p, input)
  const second = await s.tips.create(p, { ...input, amountCents: 1000, receivedAt: '2026-10-06T10:00:00.000Z' })
  assert.equal(totalTipCents(await s.tips.list(p)), 3000)
  const changed = await s.tips.update(second.id, { amountCents: 1500, receivedAt: '2026-10-07T20:00:00+11:00', notes: ' 修改 ' })
  assert.equal(changed.receivedAt, '2026-10-07T09:00:00.000Z'); assert.equal(changed.notes, '修改')
  assert.equal(changed.createdAt, second.createdAt); assert.ok(Date.parse(changed.updatedAt) >= Date.parse(second.updatedAt))
  assert.equal(totalTipCents(await s.tips.list(p)), 3500)
  assert.deepEqual((await s.tips.list(p)).map(t => t.id), [second.id, first.id])
  await s.tips.remove(first.id); assert.equal(totalTipCents(await s.tips.list(p)), 1500)
  await s.tips.remove(second.id); assert.equal(totalTipCents(await s.tips.list(p)), 0)
  assert.equal((await s.bosses.list())[0].balanceCents, 7000)
})
test('刷新保持打赏；改昵称及编辑打赏不改老板快照或关联，额外字段不会转移老板', async () => {
  const s = await setup(), tip = await s.tips.create(profileKey(s.boss), input)
  await s.bosses.update('A', { nickname: '新昵称', hourlyRateCents: 7000, notes: '' })
  const reloaded = new LocalStorageTipRepository(() => s.storage)
  assert.deepEqual(await reloaded.list(), [tip])
  const changed = await reloaded.update(tip.id, { ...input, profileId: 'other', bossIdSnapshot: 'other', nicknameSnapshot: 'other' } as typeof input)
  assert.equal(changed.profileId, tip.profileId); assert.equal(changed.bossIdSnapshot, 'A'); assert.equal(changed.nicknameSnapshot, '小鱼')
})
test('删除老板保留打赏，删除后的资料不能新增，同ID重建隔离，历史可编辑删除', async () => {
  const s = await setup(), tip = await s.tips.create(profileKey(s.boss), input)
  await s.bosses.remove('A')
  assert.deepEqual(await s.tips.list(), [tip])
  await assert.rejects(s.tips.create(profileKey(s.boss), input), /已删除/)
  const fresh = await s.bosses.create({ id: 'A', nickname: '', hourlyRateCents: 3500, notes: '' })
  assert.deepEqual(await s.tips.list(profileKey(fresh)), [])
  assert.deepEqual(await s.tips.list(), [tip])
  await assert.rejects(s.tips.create(profileKey(s.boss), input), /已删除/)
  await s.tips.update(tip.id, { ...input, amountCents: 2500 })
  assert.equal(totalTipCents(await s.tips.list(profileKey(fresh))), 0)
  await s.tips.remove(tip.id); assert.deepEqual(await s.tips.list(), [])
})
test('零、负数、小数分和不安全金额、空或非法时间均拒绝，修改失败不写入', async () => {
  const s = await setup(), p = profileKey(s.boss)
  for (const amountCents of [0, -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(s.tips.create(p, { ...input, amountCents }), /金额/)
  for (const receivedAt of ['', 'not-a-date']) await assert.rejects(s.tips.create(p, { ...input, receivedAt }), /时间/)
  const tip = await s.tips.create(p, input), before = s.data.get(APP_STORAGE_KEY)
  await assert.rejects(s.tips.update(tip.id, { ...input, amountCents: 0 }), /金额/)
  assert.equal(s.data.get(APP_STORAGE_KEY), before)
  await assert.rejects(s.tips.update('missing', input), /不存在/); await assert.rejects(s.tips.remove('missing'), /不存在/)
})
test('测试清理同时清空所有打赏，刷新不恢复', async () => {
  const s = await setup(); await s.tips.create(profileKey(s.boss), input)
  await clearTestData(s.storage)
  assert.deepEqual(readStore(s.storage).tips, [])
  assert.deepEqual(await new LocalStorageTipRepository(() => s.storage).list(), [])
})
test('旧v3无tips平滑补空集合，原老板订单流水保留；损坏打赏不覆盖数据', async () => {
  const s = await setup(), raw = JSON.parse(s.data.get(APP_STORAGE_KEY)!)
  delete raw.tips; s.data.set(APP_STORAGE_KEY, JSON.stringify(raw))
  assert.deepEqual(await s.tips.list(), [])
  assert.deepEqual(readStore(s.storage).bosses, raw.bosses); assert.deepEqual(readStore(s.storage).entries, raw.entries)
  const tip = await s.tips.create(profileKey(s.boss), input)
  const damaged = JSON.stringify({ ...readStore(s.storage), tips: [{ ...tip, amountCents: -1 }] })
  s.data.set(APP_STORAGE_KEY, damaged)
  await assert.rejects(s.tips.list(), /格式异常/)
  assert.equal(s.data.get(APP_STORAGE_KEY), damaged)
})
test('打赏存储失败不修改记录或余额，累计金额溢出不失精度', async () => {
  const s = await setup(), before = s.data.get(APP_STORAGE_KEY)
  const broken = new LocalStorageTipRepository(() => ({ ...s.storage, setItem: () => { throw new Error('quota') } }))
  await assert.rejects(broken.create(profileKey(s.boss), input), /保存失败/)
  assert.equal(s.data.get(APP_STORAGE_KEY), before)
  const tip = await s.tips.create(profileKey(s.boss), input)
  assert.throws(() => totalTipCents([{ ...tip, amountCents: Number.MAX_SAFE_INTEGER }, tip]), /安全范围/)
})
test('电脑本地时间输入与ISO保存互相转换，发生时间可以早于创建时间', () => {
  const instant = new Date('2026-10-07T05:30:12.000Z')
  assert.equal(receivedAtIso(localDateTime(instant)), instant.toISOString())
  assert.throws(() => receivedAtIso(''), /时间/)
})
