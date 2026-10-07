import type { Order } from './types'
import { serviceDurationMs } from './orderTime.ts'
export function serviceSeconds(order: Order, now = Date.now()): number { return Math.floor(serviceDurationMs(order, now) / 1000) }
// 对累计费用统一四舍五入到分，差额结算避免分段舍入产生累计误差。
export function chargeCents(rateCents: number, seconds: number): number {
  if (!Number.isSafeInteger(rateCents) || rateCents < 0 || !Number.isSafeInteger(seconds) || seconds < 0) throw new Error('计费金额或服务时长无效。')
  const cents = (BigInt(rateCents) * BigInt(seconds) + 1800n) / 3600n
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('消费金额超出安全范围，未执行扣费。')
  return Number(cents)
}
export function liveBilling(order: Order, formalBalanceCents: number, now = Date.now()) {
  const consumptionCents = chargeCents(order.hourlyRateCentsSnapshot, serviceSeconds(order, now))
  // 旧订单正式余额已扣过分段费用，预计余额只能再减尚未扣过的部分。
  const unpaidCents = Math.max(0, consumptionCents - order.settledAmountCents)
  const estimatedBalanceCents = formalBalanceCents - unpaidCents
  if (!Number.isSafeInteger(estimatedBalanceCents)) throw new Error('预计余额超出安全范围。')
  return { consumptionCents, unpaidCents, estimatedBalanceCents }
}
export function overtimeMinutes(balanceCents: number, rateCents: number): string {
  if (balanceCents >= 0) return '0'
  return (Math.abs(balanceCents) / rateCents * 60).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
