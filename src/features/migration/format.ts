import { APP_STORAGE_KEY, LEGACY_ACCOUNTS_KEY, LEGACY_BOSSES_KEY, readStore, validateStore } from '../storage/appStore.ts'
import type { AppStore, AppStorage } from '../storage/appStore'
import { ORDER_STORAGE_KEY } from '../orders/orderStorage.ts'
import { profileKey, recordProfileKey } from '../bosses/bossIdentity.ts'
import { serviceSeconds } from '../orders/billing.ts'
import { calculateStatistics, periodRange } from '../statistics/statistics.ts'

export const MIGRATION_KEYS = [APP_STORAGE_KEY, LEGACY_ACCOUNTS_KEY, LEGACY_BOSSES_KEY, ORDER_STORAGE_KEY] as const
export interface MigrationFile { format: 'yaya-diary-migration'; formatVersion: 1; dataVersion: 3; capturedAt: number; rawKeys: Record<string, string | null>; data: AppStore; fingerprint: string }
export type StorageMode = 'local-storage' | 'sqlite-test' | 'sqlite'
export interface MigrationStatus { mode: StorageMode; formalAvailable: boolean; pending?: MigrationReport }
export interface MigrationSummary {
  bosses: number; identities: number; orders: number; active: number; paused: number; completed: number; entries: number; tips: number
  balances: { profileId: string; bossId: string; balanceCents: number }[]
  rechargeCents: number; consumptionCents: number; tipCents: number; finalChargeCents: number
  periods: Record<string, ReturnType<typeof calculateStatistics>>
}
export interface MigrationReport { token: string; fingerprint: string; comparedAt: number; passed: boolean; before: MigrationSummary; after: MigrationSummary; differences: string[]; warnings: string[] }
export interface MigrationAccess {
  status(): Promise<MigrationStatus>
  exportData(): Promise<string>
  prepare(text: string): Promise<MigrationReport>
  activate(token: string): Promise<void>
  discard(token: string): Promise<void>
}
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJSON((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}
export function canonicalStore(store: AppStore) {
  return { ...store, bosses: [...store.bosses].sort((a,b) => a.id.localeCompare(b.id)), orders: [...store.orders].sort((a,b) => a.id.localeCompare(b.id)), tips: [...store.tips].sort((a,b) => a.id.localeCompare(b.id)) }
}
export function fingerprintPayload(file: Omit<MigrationFile, 'fingerprint'> | MigrationFile) {
  // 导出时间不影响指纹；JSON排版、属性顺序不影响指纹。
  const rawKeys = Object.fromEntries(MIGRATION_KEYS.map(key => [key, file.rawKeys[key] === null ? null : JSON.parse(file.rawKeys[key]!)]))
  return canonicalJSON({ format: file.format, formatVersion: file.formatVersion, dataVersion: file.dataVersion, data: canonicalStore(file.data), rawKeys })
}
function normalized(rawKeys: Record<string, string | null>, now: number): AppStore {
  const memory = new Map(Object.entries(rawKeys))
  // 原兼容转换只运行在内存副本，不调用原localStorage.setItem。
  const store = readStore({ getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value) } }, false)
  return normalizeStore(store, now)
}
export function normalizeStore(value: AppStore, now: number): AppStore {
  try {
    if (!Number.isSafeInteger(now) || now < 0 || now > 8640000000000000) throw new Error('导出时间无效')
    const store = structuredClone(value)
    validateStore(store)
    const identities = new Map<string, string>()
    const register = (profileId: string, id: string) => {
      if (!profileId.trim() || !id.trim() || (identities.has(profileId) && identities.get(profileId) !== id)) throw new Error('内部身份与老板 ID 关联不一致')
      identities.set(profileId, id)
    }
    const currentProfiles = new Set<string>()
    for (const boss of store.bosses) {
      Object.assign(boss, { profileId: profileKey(boss) })
      if (currentProfiles.has(boss.profileId!)) throw new Error('老板内部身份重复')
      currentProfiles.add(boss.profileId!); register(boss.profileId!, boss.id)
      Object.assign(boss, { createdAt: new Date(boss.createdAt).toISOString() })
    }
    for (const order of store.orders) {
      Object.assign(order, { profileId: recordProfileKey(order) }); register(order.profileId!, order.bossId)
      if (order.legacyUnbilled !== undefined && typeof order.legacyUnbilled !== 'boolean') throw new Error('历史订单标记无效')
      if (order.legacyUnbilled === false) delete order.legacyUnbilled
      if (order.endReason !== null && typeof order.endReason !== 'string') throw new Error('结束原因无效')
      if (order.status !== 'completed' && (order.startedAt > now || order.pauses.some(p => p.startedAt > now || (p.endedAt !== null && p.endedAt > now)) || order.settledServiceSeconds > serviceSeconds(order, now))) throw new Error('进行中订单结算进度或系统时间不一致')
    }
    for (const entry of store.entries) {
      Object.assign(entry, { profileId: recordProfileKey(entry) }); register(entry.profileId!, entry.bossId)
      Object.assign(entry, { nicknameSnapshot: entry.nicknameSnapshot ?? '' })
      Object.assign(entry, { createdAt: new Date(entry.createdAt).toISOString() })
      if (entry.type !== 'order_consumption' && (entry.orderId !== undefined || entry.settledThroughSeconds !== undefined)) throw new Error('非订单流水包含异常结算关联')
    }
    for (const tip of store.tips) {
      register(tip.profileId, tip.bossIdSnapshot)
      Object.assign(tip, { createdAt: new Date(tip.createdAt).toISOString() }); tip.updatedAt = new Date(tip.updatedAt).toISOString(); tip.receivedAt = new Date(tip.receivedAt).toISOString()
    }
    const modes = new Map<string, boolean>()
    for (const record of [...store.bosses, ...store.orders, ...store.entries, ...store.tips]) {
      if (record.isTestMode !== undefined && typeof record.isTestMode !== 'boolean') throw new Error('测试模式标记无效')
      const key = record.profileId!, mode = !!record.isTestMode
      if (modes.has(key) && modes.get(key) !== mode) throw new Error('同一身份的测试模式标记不一致')
      modes.set(key, mode)
      if (record.isTestMode === false) delete record.isTestMode
    }
    validateStore(store)
    return store
  } catch (error) { throw new Error(`迁移校验失败：${error instanceof Error && error.message ? error.message : '资料、订单、金额、时间或余额流水链不一致'}。原数据未更改。`) }
}
export function parseMigration(text: string): MigrationFile {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 20 * 1024 * 1024) throw new Error('迁移文件超过20MB或格式无效。')
  try {
    const file = JSON.parse(text) as MigrationFile
    if (!file || file.format !== 'yaya-diary-migration' || file.formatVersion !== 1 || file.dataVersion !== 3 || !file.rawKeys || typeof file.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(file.fingerprint)) throw new Error('迁移文件版本或指纹无效')
    if (Object.keys(file.rawKeys).length !== MIGRATION_KEYS.length) throw new Error('原始存储键不完整')
    for (const key of MIGRATION_KEYS) {
      const raw = file.rawKeys[key]
      if (raw !== null && typeof raw !== 'string') throw new Error('原始存储键无效')
      if (raw !== null) JSON.parse(raw)
    }
    const data = normalizeStore(file.data, file.capturedAt)
    const fromRaw = normalized(file.rawKeys, file.capturedAt)
    if (canonicalJSON(canonicalStore(data)) !== canonicalJSON(canonicalStore(fromRaw))) throw new Error('原始存储与导出业务快照不一致')
    return { ...file, data }
  } catch (error) { throw new Error(`迁移文件无效：${error instanceof Error ? error.message : 'JSON格式错误'}。未执行导入。`) }
}
export async function exportMigration(storage: AppStorage, now = Date.now()): Promise<string> {
  const rawKeys = Object.fromEntries(MIGRATION_KEYS.map(key => [key, storage.getItem(key)]))
  for (const raw of Object.values(rawKeys)) if (raw !== null) { try { JSON.parse(raw) } catch { throw new Error('原始存储 JSON 格式异常，已阻止导出，原资料未更改。') } }
  const data = normalized(rawKeys, now)
  const file: Omit<MigrationFile, 'fingerprint'> = { format: 'yaya-diary-migration', formatVersion: 1, dataVersion: 3, capturedAt: now, rawKeys, data }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprintPayload(file)))
  const text = JSON.stringify({ ...file, fingerprint: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') }, null, 2)
  if (new TextEncoder().encode(text).length > 20 * 1024 * 1024) throw new Error('迁移文件超过20MB，已阻止导出，原资料保持不变。')
  return text
}
function sum(values: number[]) {
  const total = values.reduce((n,v) => n + BigInt(v), 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('对账合计超出安全整数范围，已停止迁移。')
  return Number(total)
}
export function summarize(store: AppStore, now: number): MigrationSummary {
  const ids = new Set([...store.bosses.map(profileKey), ...store.orders.map(recordProfileKey), ...store.entries.map(recordProfileKey), ...store.tips.map(t => t.profileId)])
  const periods = Object.fromEntries((['today','week','month'] as const).map(period => [period, calculateStatistics(store, periodRange(period, now))]))
  if (Object.values(periods).some(metrics => Object.values(metrics).some(value => !Number.isSafeInteger(value)))) throw new Error('统计合计超出安全整数范围，已停止迁移。')
  return { bosses: store.bosses.length, identities: ids.size, orders: store.orders.length, active: store.orders.filter(o => o.status === 'active').length, paused: store.orders.filter(o => o.status === 'paused').length, completed: store.orders.filter(o => o.status === 'completed').length, entries: store.entries.length, tips: store.tips.length,
    balances: store.bosses.map(b => ({ profileId: profileKey(b), bossId: b.id, balanceCents: b.balanceCents })).sort((a,b) => a.profileId.localeCompare(b.profileId)),
    rechargeCents: sum(store.entries.filter(e => e.type === 'recharge').map(e => e.deltaCents)), consumptionCents: sum(store.entries.filter(e => e.type === 'order_consumption').map(e => -e.deltaCents)), tipCents: sum(store.tips.map(t => t.amountCents)), finalChargeCents: sum(store.orders.filter(o => o.status === 'completed').map(o => o.finalChargeCents ?? 0)),
    periods }
}
