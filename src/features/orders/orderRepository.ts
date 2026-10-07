import { displayNickname } from '../bosses/bossPresentation.ts'
import type { Order, OrderRepository } from './types'
import { readStore, writeStore, isInteger, profileKey, recordProfileKey } from '../storage/appStore.ts'
import type { AppStorage, AppStore } from '../storage/appStore'
import { dataLock } from '../storage/dataLock.ts'
import type { MutationLock } from '../storage/dataLock'
import { serviceDurationMs } from './orderTime.ts'
import { chargeCents } from './billing.ts'

function settleThrough(store: AppStore, order: Order, seconds: number, now: number, final: boolean): boolean {
  let boss = store.bosses.find(b => profileKey(b) === recordProfileKey(order))
  if (!boss) throw new Error('订单关联的老板不存在，未执行扣费。')
  if (seconds < order.settledServiceSeconds) throw new Error('系统时间异常，服务时长早于已结算时长，未重复扣费。')
  let changed = false
  function post(through: number, note: string) {
    const cumulative = chargeCents(order.hourlyRateCentsSnapshot, through)
    const delta = cumulative - order.settledAmountCents
    const after = boss!.balanceCents - delta
    if (!isInteger(after)) throw new Error('余额超出安全金额范围，未执行扣费。')
    store.entries.push({ id: crypto.randomUUID(), bossId: boss!.id, profileId: profileKey(boss!), nicknameSnapshot: order.nicknameSnapshot, orderId: order.id, type: 'order_consumption', deltaCents: -delta, beforeCents: boss!.balanceCents, afterCents: after, createdAt: new Date(now).toISOString(), notes: `订单 ${order.id}，${note}`, settledThroughSeconds: through })
    boss = { ...boss!, balanceCents: after }; store.bosses = store.bosses.map(b => b.id === boss!.id ? boss! : b)
    order.settledServiceSeconds = through; order.settledAmountCents = cumulative; changed = true
  }
  if (final && (order.billingModel === 'on-completion' || seconds > order.settledServiceSeconds)) post(seconds, order.billingModel === 'on-completion' ? '结束订单一次性结算' : '旧订单结束补结算（抵扣已扣费用）')
  return changed
}
export class LocalStorageOrderRepository implements OrderRepository {
  private readonly storage: () => AppStorage
  private readonly clock: () => number
  private readonly lock: MutationLock
  constructor(options: { storage?: () => AppStorage; clock?: () => number; lock?: MutationLock } = {}) {
    this.storage = options.storage ?? (() => window.localStorage)
    this.clock = options.clock ?? Date.now; this.lock = options.lock ?? dataLock
  }
  async list() { return this.lock(async () => readStore(this.storage()).orders.reverse().sort((a, b) => b.startedAt - a.startedAt)) }
  // 保留旧接口供兼容调用，1.1.0 不在读取或恢复时执行结算。
  settle() { return this.list() }
  start(bossId: string) { return this.lock(async () => {
    const store = readStore(this.storage()), boss = store.bosses.find(b => b.id === bossId)
    if (!boss) throw new Error('老板不存在，请刷新老板列表。')
    const current = store.orders.find(o => o.status !== 'completed')
    if (current) throw new Error(`当前正在服务「${displayNickname(current.nicknameSnapshot)}」（老板 ID：${current.bossId}），请先结束该订单。暂停中的订单也不能另开新单。`)
    if (boss.balanceCents <= 0) throw new Error('老板当前余额必须大于 0，请先充值。')
    if (boss.hourlyRateCents <= 0) throw new Error('老板当前单价必须大于 0，请先修改单价。')
    const now = this.clock()
    const order: Order = { id: crypto.randomUUID(), bossId: boss.id, profileId: profileKey(boss), nicknameSnapshot: boss.nickname, hourlyRateCentsSnapshot: boss.hourlyRateCents, startedAt: now, endedAt: null, status: 'active', accumulatedMs: 0, pauses: [], createdAt: now, settledServiceSeconds: 0, settledAmountCents: 0, finalChargeCents: null, balanceAtEndCents: null, endReason: null }
    const currentOrder = { ...order, billingModel: 'on-completion' as const }
    store.orders.push(currentOrder); writeStore(this.storage(), store); return currentOrder
  }) }
  private transition(id: string, action: 'pause' | 'resume' | 'complete') { return this.lock(async () => {
    const store = readStore(this.storage()), order = store.orders.find(o => o.id === id)
    if (!order) throw new Error('订单不存在，请刷新页面。')
    if (order.status === 'completed') throw new Error('订单已结束，不能再修改。')
    if (action === 'pause' && order.status !== 'active') throw new Error('只有进行中的订单可以暂停。')
    if (action === 'resume' && order.status !== 'paused') throw new Error('只有暂停中的订单可以继续。')
    const now = this.clock(), lastTime = order.pauses.at(-1)?.endedAt ?? order.pauses.at(-1)?.startedAt ?? order.startedAt
    if (now < lastTime) throw new Error('系统时间早于订单最近操作时间，请校正系统时间后重试。')
    const ms = serviceDurationMs(order, now)
    settleThrough(store, order, Math.floor(ms / 1000), now, action === 'complete')
    order.accumulatedMs = ms
    if (action === 'pause') { order.pauses.push({ startedAt: now, endedAt: null }); order.status = 'paused' }
    else {
      if (order.status === 'paused') order.pauses.at(-1)!.endedAt = now
      if (action === 'resume') order.status = 'active'
      else { order.status = 'completed'; order.endedAt = now; order.finalChargeCents = order.settledAmountCents; order.balanceAtEndCents = store.bosses.find(b => profileKey(b) === recordProfileKey(order))!.balanceCents; order.endReason = '用户手动结束' }
    }
    writeStore(this.storage(), store); return order
  }) }
  pause(id: string) { return this.transition(id, 'pause') }
  resume(id: string) { return this.transition(id, 'resume') }
  complete(id: string) { return this.transition(id, 'complete') }
}
export const orderRepository: OrderRepository = new LocalStorageOrderRepository()



