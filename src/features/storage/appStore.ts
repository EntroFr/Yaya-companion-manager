import { profileKey, recordProfileKey } from '../bosses/bossIdentity.ts'
export { profileKey, recordProfileKey } from '../bosses/bossIdentity.ts'
import type { Boss, BalanceEntry } from '../bosses/types'
import type { Order } from '../orders/types'
import type { Tip } from '../tips/types'
import { readOrders, validOrder } from '../orders/orderStorage.ts'
import { serviceSeconds, chargeCents } from '../orders/billing.ts'
export const APP_STORAGE_KEY = 'yaya-diary:app:v3'
export const LEGACY_ACCOUNTS_KEY = 'yaya-diary:accounts:v2'
export const LEGACY_BOSSES_KEY = 'yaya-diary:bosses:v1'
export const DATA_CHANGED_EVENT = 'yaya:data-changed'
export type AppStorage = Pick<Storage, 'getItem' | 'setItem'>
export interface AppStore { version: 3; bosses: Boss[]; entries: BalanceEntry[]; orders: Order[]; tips: Tip[] }
export const isInteger = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n)
export const isCents = (n: unknown): n is number => isInteger(n) && n >= 0
const date = (s: unknown) => typeof s === 'string' && Number.isFinite(Date.parse(s))
function validBoss(b: Boss) {
  return b && typeof b.id === 'string' && b.id.trim() === b.id && b.id.length > 0 && typeof b.nickname === 'string'
    && (b.profileId === undefined || (typeof b.profileId === 'string' && b.profileId.length > 0))
    && isCents(b.hourlyRateCents) && b.hourlyRateCents <= 100000000 && isInteger(b.balanceCents) && date(b.createdAt) && typeof b.notes === 'string'
}
export function validateStore(store: AppStore): AppStore {
  if (!store || store.version !== 3 || !Array.isArray(store.bosses) || !store.bosses.every(validBoss)
    || new Set(store.bosses.map(b => b.id)).size !== store.bosses.length || !Array.isArray(store.entries) || !Array.isArray(store.orders)) throw new Error()
  if (!Array.isArray(store.tips) || new Set(store.tips.map(t => t.id)).size !== store.tips.length || !store.tips.every(t => t
    && typeof t.id === 'string' && t.id && typeof t.profileId === 'string' && t.profileId
    && typeof t.bossIdSnapshot === 'string' && t.bossIdSnapshot && typeof t.nicknameSnapshot === 'string'
    && isCents(t.amountCents) && t.amountCents > 0 && date(t.receivedAt) && date(t.createdAt) && date(t.updatedAt) && typeof t.notes === 'string')) throw new Error()
  const balances = new Map<string, number>(store.bosses.map(b => [profileKey(b), 0]))
  for (const e of store.entries) if (!balances.has(recordProfileKey(e))) balances.set(recordProfileKey(e), 0)
  const orderMap = new Map(store.orders.map(o => [o.id, o]))
  if (orderMap.size !== store.orders.length || store.orders.filter(o => o.status !== 'completed').length > 1) throw new Error()
  for (const o of store.orders) {
    if (o.billingModel !== undefined && o.billingModel !== 'on-completion') throw new Error()
    if (o.billingModel === 'on-completion' && o.status !== 'completed' && (o.settledServiceSeconds !== 0 || o.settledAmountCents !== 0)) throw new Error()
    if (!validOrder(o) || (o.profileId !== undefined && (typeof o.profileId !== 'string' || !o.profileId)) || (o.status !== 'completed' && !store.bosses.some(b => profileKey(b) === recordProfileKey(o))) || !isCents(o.settledServiceSeconds) || !isCents(o.settledAmountCents)) throw new Error()
    if (o.legacyUnbilled) {
      if (o.status !== 'completed' || o.settledAmountCents !== 0 || o.finalChargeCents !== 0 || o.balanceAtEndCents !== null) throw new Error()
    } else {
      if (o.settledAmountCents !== chargeCents(o.hourlyRateCentsSnapshot, o.settledServiceSeconds)) throw new Error()
      if (o.status === 'completed') {
        if (o.settledServiceSeconds !== serviceSeconds(o) || o.finalChargeCents !== o.settledAmountCents || !isInteger(o.balanceAtEndCents) || o.endReason !== '用户手动结束') throw new Error()
      } else if (o.finalChargeCents !== null || o.balanceAtEndCents !== null || o.endReason !== null || o.settledServiceSeconds % 900 !== 0) throw new Error()
    }
  }
  const ids = new Set<string>()
  const totals = new Map<string, number>()
  const settled = new Map<string, number>()
  for (const e of store.entries) {
    if (!e || typeof e.id !== 'string' || !e.id || ids.has(e.id) || typeof e.bossId !== 'string' || !e.bossId || (e.profileId !== undefined && (typeof e.profileId !== 'string' || !e.profileId)) || (e.nicknameSnapshot !== undefined && typeof e.nicknameSnapshot !== 'string') || !isInteger(e.deltaCents)
      || !isInteger(e.beforeCents) || !isInteger(e.afterCents) || !date(e.createdAt) || typeof e.notes !== 'string'
      || e.beforeCents !== balances.get(recordProfileKey(e)) || e.afterCents !== e.beforeCents + e.deltaCents) throw new Error()
    if (e.type === 'order_consumption') {
      const o = e.orderId ? orderMap.get(e.orderId) : undefined
      if (!o || (o.bossId !== e.bossId || recordProfileKey(o) !== recordProfileKey(e)) || o.legacyUnbilled || e.deltaCents > 0 || !isCents(e.settledThroughSeconds)
        || e.settledThroughSeconds <= (settled.get(o.id) ?? (o.billingModel === 'on-completion' ? -1 : 0))
        || -e.deltaCents !== chargeCents(o.hourlyRateCentsSnapshot, e.settledThroughSeconds) - (totals.get(o.id) ?? 0)) throw new Error()
      totals.set(o.id, (totals.get(o.id) ?? 0) - e.deltaCents); settled.set(o.id, e.settledThroughSeconds)
    } else if (e.type === 'debt_clear') {
      if (e.beforeCents >= 0 || e.afterCents !== 0 || e.deltaCents !== -e.beforeCents) throw new Error()
    } else if (!['recharge', 'manual_add', 'manual_deduct'].includes(e.type) || (e.type === 'manual_deduct' ? e.deltaCents >= 0 : e.deltaCents <= 0)) throw new Error()
    ids.add(e.id); balances.set(recordProfileKey(e), e.afterCents)
  }
  if (store.bosses.some(b => b.balanceCents !== balances.get(profileKey(b)))) throw new Error()
  if (store.orders.some(o => !o.legacyUnbilled && ((totals.get(o.id) ?? 0) !== o.settledAmountCents || (settled.get(o.id) ?? 0) !== o.settledServiceSeconds))) throw new Error()
  if (store.orders.some(o => o.billingModel === 'on-completion' && store.entries.filter(e => e.type === 'order_consumption' && e.orderId === o.id).length !== (o.status === 'completed' ? 1 : 0))) throw new Error()
  return store
}
export function writeStore(storage: AppStorage, store: AppStore, notify = true) {
  try { storage.setItem(APP_STORAGE_KEY, JSON.stringify(store)) }
  catch { throw new Error('保存失败，余额、流水和订单均未更改，请检查本地存储后重试。') }
  if (notify && typeof window !== 'undefined') window.dispatchEvent(new Event(DATA_CHANGED_EVENT))
}
export function readStore(storage: AppStorage, notify = true): AppStore {
  let raw: string | null, accounts: string | null, bosses: string | null
  try {
    raw = storage.getItem(APP_STORAGE_KEY)
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw)
        const missingTips = parsed && !Object.hasOwn(parsed, 'tips')
        if (missingTips) parsed.tips = []
        const store = validateStore(parsed)
        let changed = missingTips
        for (const entry of store.entries) if (entry.nicknameSnapshot === undefined) {
          Object.assign(entry, { nicknameSnapshot: (entry.orderId ? store.orders.find(o => o.id === entry.orderId)?.nicknameSnapshot : undefined) ?? store.bosses.find(b => profileKey(b) === recordProfileKey(entry))?.nickname ?? '' })
          changed = true
        }
        if (changed) writeStore(storage, store, notify)
        return store
      }
      catch { throw new Error('老板、余额、订单或打赏数据格式异常，已停止读写，原资料未被覆盖。') }
    }
    accounts = storage.getItem(LEGACY_ACCOUNTS_KEY)
    bosses = accounts === null ? storage.getItem(LEGACY_BOSSES_KEY) : null
  } catch (err) {
    if (err instanceof Error && err.message.includes('格式异常')) throw err
    throw new Error('无法读取本地数据，请检查浏览器存储权限。')
  }
  let store: AppStore
  try {
    const old = accounts === null ? null : JSON.parse(accounts)
    const oldBosses = bosses === null ? [] : JSON.parse(bosses)
    if (old && (old.version !== 2 || !Array.isArray(old.bosses) || !Array.isArray(old.entries))) throw new Error()
    if (!Array.isArray(oldBosses)) throw new Error()
    const migratedBosses = old ? old.bosses : oldBosses.map(b => {
      if (!b || typeof b.hourlyRate !== 'number' || !Number.isFinite(b.hourlyRate) || Math.abs(b.hourlyRate * 100 - Math.round(b.hourlyRate * 100)) > 0.000001) throw new Error()
      return { id: b.id, nickname: b.nickname, hourlyRateCents: Math.round(b.hourlyRate * 100), balanceCents: 0, createdAt: b.createdAt, notes: b.notes }
    })
    const orders = readOrders(storage).map(o => ({ ...o, profileId: o.profileId ?? migratedBosses.find((b: Boss) => b.id === o.bossId)?.profileId, settledServiceSeconds: o.status === 'completed' ? serviceSeconds(o) : 0, settledAmountCents: 0,
      finalChargeCents: o.status === 'completed' ? 0 : null, balanceAtEndCents: null,
      endReason: o.status === 'completed' ? '阶段四历史订单（未计费）' : null, ...(o.status === 'completed' ? { legacyUnbilled: true } : {}) }))
    store = validateStore({ version: 3, bosses: migratedBosses, entries: old?.entries ?? [], orders, tips: [] })
    for (const entry of store.entries) if (entry.nicknameSnapshot === undefined) Object.assign(entry, { nicknameSnapshot: store.bosses.find(b => profileKey(b) === recordProfileKey(entry))?.nickname ?? '' })
  } catch { throw new Error('旧数据格式异常，已停止迁移；原资料未被覆盖。') }
  // 即使初始为空也只迁移一次，保留所有旧键作为迁移前备份。
  writeStore(storage, store, notify)
  return store
}

