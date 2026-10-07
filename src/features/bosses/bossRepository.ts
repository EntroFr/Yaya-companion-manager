import type { Boss, BossChanges, BossInput, BossRepository, BalanceEntry, BalanceInput } from './types'
import { APP_STORAGE_KEY, LEGACY_BOSSES_KEY, readStore, writeStore, isCents, isInteger, profileKey, recordProfileKey } from '../storage/appStore.ts'
import type { AppStorage } from '../storage/appStore'
import { dataLock } from '../storage/dataLock.ts'
import type { MutationLock } from '../storage/dataLock'
export const LEGACY_BOSS_STORAGE_KEY = LEGACY_BOSSES_KEY
export const BOSS_STORAGE_KEY = APP_STORAGE_KEY
import { validateBossFields as validateFields } from '../data/inputValidation.ts'
export class LocalStorageBossRepository implements BossRepository {
  private readonly storage: () => AppStorage
  private readonly lock: MutationLock
  constructor(storage: () => AppStorage = () => window.localStorage, lock: MutationLock = dataLock) { this.storage = storage; this.lock = lock }
  async list() { return this.lock(async () => readStore(this.storage()).bosses) }
  create(input: BossInput) { return this.lock(async () => {
    const id = input.id.trim()
    if (!id) throw new Error('老板 ID 不能为空，请输入自定义 ID。')
    const store = readStore(this.storage())
    if (store.bosses.some(b => b.id === id)) throw new Error(`老板 ID「${id}」已存在，请使用其他 ID。`)
    const boss: Boss = { id, profileId: crypto.randomUUID(), ...validateFields(input), balanceCents: 0, createdAt: new Date().toISOString() }
    store.bosses.push(boss); writeStore(this.storage(), store); return boss
  }) }
  update(id: string, changes: BossChanges) { return this.lock(async () => {
    const store = readStore(this.storage()), index = store.bosses.findIndex(b => b.id === id)
    if (index < 0) throw new Error('该老板已不存在，请刷新列表。')
    const boss = { ...store.bosses[index], ...validateFields(changes) }
    store.bosses[index] = boss; writeStore(this.storage(), store); return boss
  }) }
  remove(id: string) { return this.lock(async () => {
    const store = readStore(this.storage())
    if (!store.bosses.some(b => b.id === id)) throw new Error('该老板已不存在，请刷新列表。')
    if (store.orders.some(o => o.bossId === id && o.status !== 'completed')) throw new Error('该老板当前存在进行中的订单，请先结束订单后再删除。')
    store.bosses = store.bosses.filter(b => b.id !== id); writeStore(this.storage(), store)
  }) }
  async entries(bossId: string) { return this.lock(async () => {
    const store = readStore(this.storage()), boss = store.bosses.find(b => b.id === bossId)
    return store.entries.filter(e => e.bossId === bossId && (!boss || recordProfileKey(e) === profileKey(boss))).reverse().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  }) }
  changeBalance(bossId: string, input: BalanceInput) { return this.lock(async () => {
    if (!['recharge', 'manual_add', 'manual_deduct'].includes(input.type)) throw new Error('请选择正确的余额流水类型。')
    if (!isCents(input.amountCents) || input.amountCents === 0) throw new Error('金额必须大于 0，最多保留两位小数。')
    const store = readStore(this.storage()), boss = store.bosses.find(b => b.id === bossId)
    if (!boss) throw new Error('该老板已不存在，请刷新列表。')
    const deltaCents = input.type === 'manual_deduct' ? -input.amountCents : input.amountCents
    const afterCents = boss.balanceCents + deltaCents
    // 手动扣除沿用余额不足拦截；订单消费独立允许负数。
    if (input.type === 'manual_deduct' && afterCents < 0) throw new Error('余额不足，手动扣除金额不能超过当前余额。')
    if (!isInteger(afterCents)) throw new Error('余额超出安全金额范围，无法保存。')
    const entry: BalanceEntry = { id: crypto.randomUUID(), bossId, profileId: profileKey(boss), nicknameSnapshot: boss.nickname, type: input.type, deltaCents, beforeCents: boss.balanceCents, afterCents, createdAt: new Date().toISOString(), notes: input.notes.trim() }
    const updated = { ...boss, balanceCents: afterCents }
    store.bosses = store.bosses.map(b => b.id === bossId ? updated : b); store.entries.push(entry)
    writeStore(this.storage(), store); return updated
  }) }
  clearDebt(bossId: string, notes = '用户确认清零负余额') { return this.lock(async () => {
    const store = readStore(this.storage()), boss = store.bosses.find(b => b.id === bossId)
    if (!boss) throw new Error('该老板已不存在，请刷新列表。')
    if (boss.balanceCents >= 0) throw new Error('当前余额不为负数，无需清零。')
    store.entries.push({ id: crypto.randomUUID(), bossId, profileId: profileKey(boss), nicknameSnapshot: boss.nickname, type: 'debt_clear', deltaCents: -boss.balanceCents, beforeCents: boss.balanceCents, afterCents: 0, createdAt: new Date().toISOString(), notes })
    const updated = { ...boss, balanceCents: 0 }
    store.bosses = store.bosses.map(b => b.id === bossId ? updated : b)
    writeStore(this.storage(), store); return updated
  }) }
}
export const bossRepository: BossRepository = new LocalStorageBossRepository()

