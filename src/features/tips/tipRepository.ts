import type { TipRepository } from '../data/contracts'
import type { Tip, TipInput } from './types'
import { readStore, writeStore, profileKey } from '../storage/appStore.ts'
import type { AppStorage } from '../storage/appStore'
import { dataLock } from '../storage/dataLock.ts'
import type { MutationLock } from '../storage/dataLock'

import { validateTipInput as validateInput } from '../data/inputValidation.ts'
export class LocalStorageTipRepository implements TipRepository {
  private readonly storage: () => AppStorage
  private readonly lock: MutationLock
  constructor(storage: () => AppStorage = () => window.localStorage, lock: MutationLock = dataLock) { this.storage = storage; this.lock = lock }
  list(profileId?: string) { return this.lock(async () => readStore(this.storage()).tips.filter(t => !profileId || t.profileId === profileId).reverse().sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))) }
  create(profileId: string, input: TipInput) { return this.lock(async () => {
    const fields = validateInput(input), store = readStore(this.storage())
    const boss = store.bosses.find(b => profileKey(b) === profileId)
    if (!boss) throw new Error('该老板资料已删除或已变更，不能新增打赏，请重新选择老板。')
    const now = new Date().toISOString()
    const tip: Tip = { id: crypto.randomUUID(), profileId, bossIdSnapshot: boss.id, ...(boss.isTestMode ? { isTestMode: true } : {}), nicknameSnapshot: boss.nickname, ...fields, createdAt: now, updatedAt: now }
    store.tips.push(tip); writeStore(this.storage(), store); return tip
  }) }
  update(id: string, input: TipInput) { return this.lock(async () => {
    const fields = validateInput(input), store = readStore(this.storage()), index = store.tips.findIndex(t => t.id === id)
    if (index < 0) throw new Error('该打赏记录已不存在，请刷新后重试。')
    // 只允许修改金额、发生时间和备注，老板关联及快照始终保持原值。
    const tip = { ...store.tips[index], ...fields, updatedAt: new Date().toISOString() }
    store.tips[index] = tip; writeStore(this.storage(), store); return tip
  }) }
  remove(id: string) { return this.lock(async () => {
    const store = readStore(this.storage())
    if (!store.tips.some(t => t.id === id)) throw new Error('该打赏记录已不存在，请刷新后重试。')
    store.tips = store.tips.filter(t => t.id !== id); writeStore(this.storage(), store)
  }) }
}
export const tipRepository = new LocalStorageTipRepository()
export { totalTipCents } from './tipMetrics.ts'
