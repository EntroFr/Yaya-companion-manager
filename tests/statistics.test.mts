import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateStatistics, periodRange } from '../src/features/statistics/statistics.ts'
import type { TimeRange } from '../src/features/statistics/statistics.ts'
import type { Order } from '../src/features/orders/types.ts'
import type { BalanceEntry } from '../src/features/bosses/types.ts'
import type { Tip } from '../src/features/tips/types.ts'
import { chargeCents } from '../src/features/orders/billing.ts'
import { LocalStorageBossRepository } from '../src/features/bosses/bossRepository.ts'
import { LocalStorageOrderRepository } from '../src/features/orders/orderRepository.ts'
import { LocalStorageTipRepository } from '../src/features/tips/tipRepository.ts'
import { readStore, profileKey } from '../src/features/storage/appStore.ts'

const time = (day: number, hour = 0, minute = 0, second = 0) => new Date(2026, 9, day, hour, minute, second).getTime()
const dayRange = (day: number): TimeRange => ({ start: time(day), end: time(day + 1) })
function order(start: number, end: number | null, changes: Partial<Order> = {}): Order {
  return { id: 'O', bossId: 'A', profileId: 'profile-A', nicknameSnapshot: '旧昵称', hourlyRateCentsSnapshot: 3500, startedAt: start, endedAt: end, status: end === null ? 'active' : 'completed', accumulatedMs: end === null ? 0 : end - start, pauses: [], settledServiceSeconds: 0, settledAmountCents: 0, finalChargeCents: null, balanceAtEndCents: null, endReason: null, createdAt: start, ...changes }
}
const stats = (o: Order, range: TimeRange) => calculateStatistics({ orders: [o], entries: [], tips: [] }, range)
function tip(receivedAt: number): Tip { return { id: 'T', profileId: 'profile-A', bossIdSnapshot: 'A', nicknameSnapshot: '旧昵称', amountCents: 2000, receivedAt: new Date(receivedAt).toISOString(), createdAt: new Date(time(8)).toISOString(), updatedAt: new Date(time(8)).toISOString(), notes: '' } }
function entry(type: BalanceEntry['type'], amount = 7000, at = time(7, 10)): BalanceEntry { return { id: type, bossId: 'A', type, deltaCents: amount, beforeCents: 0, afterCents: amount, createdAt: new Date(at).toISOString(), notes: '' } }

test('同日一小时收入35元、15分钟875分，有效时间准确', () => {
  assert.equal(stats(order(time(7, 10), time(7, 11)), dayRange(7)).serviceIncomeCents, 3500)
  const s = stats(order(time(7, 10), time(7, 10, 15)), dayRange(7))
  assert.equal(s.serviceMs, 900000); assert.equal(s.serviceIncomeCents, 875)
})
test('暂停时间不计入时长和服务收入，多次暂停正确', () => {
  const o = order(time(7, 10), time(7, 11), { pauses: [{ startedAt: time(7, 10, 10), endedAt: time(7, 10, 20) }, { startedAt: time(7, 10, 30), endedAt: time(7, 10, 50) }] })
  assert.equal(stats(o, dayRange(7)).serviceMs, 1800000)
  assert.equal(stats(o, dayRange(7)).serviceIncomeCents, 1750)
})
test('23:50到次日00:30拆分10分钟和30分钟，分日金额之和等于总金额', () => {
  const o = order(time(7, 23, 50), time(8, 0, 30)), first = stats(o, dayRange(7)), second = stats(o, dayRange(8))
  assert.equal(first.serviceMs, 600000); assert.equal(second.serviceMs, 1800000)
  assert.equal(first.serviceIncomeCents, 583); assert.equal(second.serviceIncomeCents, 1750)
  assert.equal(first.serviceIncomeCents + second.serviceIncomeCents, chargeCents(3500, 2400))
})
test('跨午夜暂停23:55到00:10，首日5分钟次日20分钟', () => {
  const o = order(time(7, 23, 50), time(8, 0, 30), { pauses: [{ startedAt: time(7, 23, 55), endedAt: time(8, 0, 10) }] })
  const first = stats(o, dayRange(7)), second = stats(o, dayRange(8))
  assert.equal(first.serviceMs, 300000); assert.equal(second.serviceMs, 1200000)
  assert.equal(first.serviceIncomeCents + second.serviceIncomeCents, chargeCents(3500, 1500))
})
test('active按当前时刻计算，跨日和未结算时长都计入', () => {
  const o = order(time(7, 23, 50), null)
  const s = stats(o, periodRange('today', time(8, 0, 30)))
  assert.equal(s.serviceMs, 1800000); assert.equal(s.serviceIncomeCents, 1750)
  assert.equal(stats(o, periodRange('today', time(8, 0, 35))).serviceMs, 2100000)
})
test('paused到暂停开始为止，跨午夜暂停后统计不再增长', () => {
  const o = order(time(7, 23, 50), null, { status: 'paused', pauses: [{ startedAt: time(8, 0, 10), endedAt: null }] })
  const first = stats(o, periodRange('today', time(8, 1)))
  assert.equal(first.serviceMs, 600000)
  assert.deepEqual(stats(o, periodRange('today', time(8, 2))), first)
})
test('打赏以receivedAt而非创建时间归属日期', () => {
  const data = { orders: [], entries: [], tips: [tip(time(7, 15))] }
  assert.equal(calculateStatistics(data, dayRange(7)).tipCents, 2000)
  assert.equal(calculateStatistics(data, dayRange(8)).tipCents, 0)
})
test('修改打赏发生日期和金额后，所属统计周期同步变化', () => {
  const data = { orders: [], entries: [], tips: [tip(time(7, 15))] }
  data.tips[0].receivedAt = new Date(time(8, 15)).toISOString(); data.tips[0].amountCents = 2500
  assert.equal(calculateStatistics(data, dayRange(7)).tipCents, 0)
  assert.equal(calculateStatistics(data, dayRange(8)).tipCents, 2500)
})
test('只有充值计入收款，手动增减、欠费清零和消费流水均排除', () => {
  const data = { orders: [], entries: [entry('recharge'), entry('manual_add'), entry('manual_deduct', -100), entry('debt_clear'), entry('order_consumption', -875)], tips: [] }
  const s = calculateStatistics(data, dayRange(7))
  assert.equal(s.rechargeCents, 7000); assert.equal(s.receiptsCents, 7000); assert.equal(s.incomeCents, 0)
})
test('服务收入与结算标记无关，订单消费流水不会重复计入', () => {
  const o = order(time(7, 10), time(7, 10, 30))
  const data = { orders: [o], entries: [entry('order_consumption', -1750)], tips: [] }
  const before = calculateStatistics(data, dayRange(7))
  o.settledAmountCents = 1750; o.settledServiceSeconds = 1800
  assert.deepEqual(calculateStatistics(data, dayRange(7)), before)
  assert.equal(before.serviceIncomeCents, 1750)
})
test('收款合计=充值+打赏，实际收入=服务+打赏，不混淆预收款', () => {
  const s = calculateStatistics({ orders: [order(time(7, 10), time(7, 11))], entries: [entry('recharge')], tips: [tip(time(7, 15))] }, dayRange(7))
  assert.equal(s.receiptsCents, 9000); assert.equal(s.incomeCents, 5500)
})
test('删除老板后全部历史仍统计，同ID新资料不影响旧统计', async () => {
  const data = new Map<string, string>(), storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
  const bosses = new LocalStorageBossRepository(() => storage), tips = new LocalStorageTipRepository(() => storage)
  const boss = await bosses.create({ id: 'A', nickname: '老板', hourlyRateCents: 3500, notes: '' })
  await bosses.changeBalance('A', { type: 'recharge', amountCents: 7000, notes: '' })
  let now = Date.now(); const start = now
  const orders = new LocalStorageOrderRepository({ storage: () => storage, clock: () => now })
  const o = await orders.start('A'); now += 900000; await orders.complete(o.id)
  await tips.create(profileKey(boss), { amountCents: 2000, receivedAt: new Date(start).toISOString(), notes: '' })
  const range = { start: start - 10000, end: now }, before = calculateStatistics(readStore(storage), range)
  await bosses.remove('A'); assert.deepEqual(calculateStatistics(readStore(storage), range), before)
  await bosses.create({ id: 'A', nickname: '新老板', hourlyRateCents: 9999, notes: '' })
  assert.deepEqual(calculateStatistics(readStore(storage), range), before)
  assert.equal(before.incomeCents, 2875); assert.equal(before.rechargeCents, 7000)
})
test('周一零点为周起点，周日属于此前周，跨月周正确', () => {
  assert.equal(periodRange('week', time(7, 15)).start, time(5))
  assert.equal(periodRange('week', time(5, 15)).start, time(5))
  assert.equal(periodRange('week', time(4, 23, 59)).start, new Date(2026, 8, 28).getTime())
})
test('今日本地零点，自然月1日零点，所有周期截至当前时间', () => {
  const now = time(7, 15, 30)
  assert.deepEqual(periodRange('today', now), { start: time(7), end: now })
  assert.deepEqual(periodRange('month', now), { start: time(1), end: now })
  assert.equal(periodRange('month', new Date(2027, 0, 2, 15).getTime()).start, new Date(2027, 0, 1).getTime())
})
test('统一舍入：低单价跨午夜不会重复舍入，多日分摊之和一致', () => {
  const o = order(time(7, 23, 30), time(8, 0, 30), { hourlyRateCentsSnapshot: 1 })
  const a = stats(o, dayRange(7)), b = stats(o, dayRange(8))
  assert.equal(a.serviceIncomeCents, chargeCents(1, 1800)); assert.equal(b.serviceIncomeCents, 0)
  assert.equal(a.serviceIncomeCents + b.serviceIncomeCents, chargeCents(1, 3600))
})
test('区间外订单、充值和未来打赏不计入，无数据为零', () => {
  const range = periodRange('today', time(7, 15))
  const s = calculateStatistics({ orders: [order(time(6, 10), time(6, 11)), order(time(8, 10), null)], entries: [entry('recharge', 7000, time(8, 10))], tips: [tip(time(7, 16))] }, range)
  assert.deepEqual(s, { serviceMs: 0, serviceIncomeCents: 0, rechargeCents: 0, tipCents: 0, incomeCents: 0, receiptsCents: 0 })
})
test('跨月订单按月初拆分，历史未计费订单也按真实服务计入统计', () => {
  const o = order(new Date(2026, 8, 30, 23, 50).getTime(), time(1, 0, 30), { legacyUnbilled: true })
  assert.equal(stats(o, periodRange('month', time(7, 15))).serviceMs, 1800000)
  assert.equal(stats(o, periodRange('month', time(7, 15))).serviceIncomeCents, 1750)
})
