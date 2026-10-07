import type { Order } from './types'
import { serviceDurationMs } from './orderTime.ts'

export const ORDER_STORAGE_KEY = 'yaya-diary:orders:v1'
export type OrderStorage = Pick<Storage, 'getItem' | 'setItem'>
const timestamp = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 8640000000000000
export function validOrder(value: unknown): value is Order {
  if (!value || typeof value !== 'object') return false
  const o = value as Order
  if (typeof o.id !== 'string' || !o.id || typeof o.bossId !== 'string' || !o.bossId
    || typeof o.nicknameSnapshot !== 'string'
    || !Number.isSafeInteger(o.hourlyRateCentsSnapshot) || o.hourlyRateCentsSnapshot <= 0
    || !timestamp(o.startedAt) || o.createdAt !== o.startedAt || !Number.isSafeInteger(o.accumulatedMs) || o.accumulatedMs < 0
    || !['active', 'paused', 'completed'].includes(o.status) || !Array.isArray(o.pauses)
    || (o.status === 'completed' ? !timestamp(o.endedAt) || o.endedAt < o.startedAt : o.endedAt !== null)) return false
  let lastTime = o.startedAt
  for (let i = 0; i < o.pauses.length; i++) {
    const p = o.pauses[i]
    if (!p || !timestamp(p.startedAt) || p.startedAt < lastTime) return false
    if (p.endedAt === null) {
      if (o.status !== 'paused' || i !== o.pauses.length - 1) return false
    } else {
      if (!timestamp(p.endedAt) || p.endedAt < p.startedAt || (o.endedAt !== null && p.endedAt > o.endedAt)) return false
      lastTime = p.endedAt
    }
  }
  if (o.status === 'paused' && o.pauses.at(-1)?.endedAt !== null) return false
  const snapshotTime = o.status === 'completed' ? o.endedAt! : o.status === 'paused' ? o.pauses.at(-1)!.startedAt : o.pauses.at(-1)?.endedAt ?? o.startedAt
  return o.accumulatedMs === serviceDurationMs(o, snapshotTime)
}
export function readOrders(storage: OrderStorage): Order[] {
  let raw: string | null
  try { raw = storage.getItem(ORDER_STORAGE_KEY) }
  catch { throw new Error('无法读取订单，请检查浏览器本地存储权限。') }
  if (raw === null) return []
  try {
    const data = JSON.parse(raw)
    if (!data || data.version !== 1 || !Array.isArray(data.orders) || !data.orders.every(validOrder)
      || new Set(data.orders.map((o: Order) => o.id)).size !== data.orders.length
      || data.orders.filter((o: Order) => o.status !== 'completed').length > 1) throw new Error()
    return data.orders
  } catch { throw new Error('订单数据格式异常，已停止读写，原记录未被覆盖。') }
}
export function writeOrders(storage: OrderStorage, orders: Order[]) {
  try { storage.setItem(ORDER_STORAGE_KEY, JSON.stringify({ version: 1, orders })) }
  catch { throw new Error('订单保存失败，原状态未更改，请检查本地存储后重试。') }
}


