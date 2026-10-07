import type { Order } from '../orders/types'
import type { BalanceEntry } from '../bosses/types'
import type { Tip } from '../tips/types'
import { chargeCents } from '../orders/billing.ts'

export type StatisticsPeriod = 'today' | 'week' | 'month'
export interface TimeRange { start: number; end: number }
export interface Statistics {
  serviceMs: number
  serviceIncomeCents: number
  rechargeCents: number
  tipCents: number
  receiptsCents: number
  incomeCents: number
}
export function periodRange(period: StatisticsPeriod, now = Date.now()): TimeRange {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (period === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7)
  if (period === 'month') start.setDate(1)
  return { start: start.getTime(), end: now }
}
// 时间戳形成真实服务区间；暂停区间被切除，界面刷新频率不参与计算。
export function serviceIntervals(order: Order, now: number): TimeRange[] {
  const end = Math.min(order.endedAt ?? now, now, order.status === 'paused' ? order.pauses.at(-1)!.startedAt : Infinity)
  const intervals: TimeRange[] = []
  let cursor = order.startedAt
  for (const pause of order.pauses) {
    if (pause.startedAt >= end) break
    if (pause.startedAt > cursor) intervals.push({ start: cursor, end: Math.min(pause.startedAt, end) })
    cursor = Math.max(cursor, pause.endedAt ?? end)
  }
  if (cursor < end) intervals.push({ start: cursor, end })
  return intervals
}
function safeSum(a: number, b: number) {
  const result = a + b
  if (!Number.isSafeInteger(result)) throw new Error('统计合计超出安全范围，无法显示准确结果。')
  return result
}
export function calculateStatistics(data: { orders: Order[]; entries: BalanceEntry[]; tips: Tip[] }, range: TimeRange): Statistics {
  let serviceMs = 0, serviceIncomeCents = 0, rechargeCents = 0, tipCents = 0
  for (const order of data.orders) {
    let beforeMs = 0, throughMs = 0
    for (const interval of serviceIntervals(order, range.end)) {
      beforeMs = safeSum(beforeMs, Math.max(0, Math.min(interval.end, range.start) - interval.start))
      throughMs = safeSum(throughMs, interval.end - interval.start)
    }
    serviceMs = safeSum(serviceMs, throughMs - beforeMs)
    // 使用订单累计费用的差额分摊整秒和舍入尾差，多个日期相加仍等于订单费用。
    const income = chargeCents(order.hourlyRateCentsSnapshot, Math.floor(throughMs / 1000)) - chargeCents(order.hourlyRateCentsSnapshot, Math.floor(beforeMs / 1000))
    serviceIncomeCents = safeSum(serviceIncomeCents, income)
  }
  const within = (value: string) => { const time = Date.parse(value); return time >= range.start && time <= range.end }
  for (const entry of data.entries) if (entry.type === 'recharge' && within(entry.createdAt)) rechargeCents = safeSum(rechargeCents, entry.deltaCents)
  for (const tip of data.tips) if (within(tip.receivedAt)) tipCents = safeSum(tipCents, tip.amountCents)
  return { serviceMs, serviceIncomeCents, rechargeCents, tipCents, receiptsCents: safeSum(rechargeCents, tipCents), incomeCents: safeSum(serviceIncomeCents, tipCents) }
}
