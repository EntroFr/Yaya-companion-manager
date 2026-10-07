import { LocalStorageBossRepository } from '../bosses/bossRepository.ts'
import { LocalStorageOrderRepository } from '../orders/orderRepository.ts'
import { LocalStorageTipRepository } from '../tips/tipRepository.ts'
import type { DataAccess, HistoryRepository, StatisticsDataRepository } from '../data/contracts'
import { readStore, writeStore, profileKey, recordProfileKey, APP_STORAGE_KEY, LEGACY_ACCOUNTS_KEY, LEGACY_BOSSES_KEY, DATA_CHANGED_EVENT } from './appStore.ts'
import type { AppStorage } from './appStore'
import { ORDER_STORAGE_KEY } from '../orders/orderStorage.ts'
import { dataLock } from './dataLock.ts'
import type { MutationLock } from './dataLock'
import { clearTestData } from './testData.ts'
import { exportMigration } from '../migration/format.ts'

export class LocalStorageHistoryRepository implements HistoryRepository, StatisticsDataRepository {
  private readonly storage: () => AppStorage
  private readonly lock: MutationLock
  constructor(storage: () => AppStorage = () => window.localStorage, lock: MutationLock = dataLock) { this.storage = storage; this.lock = lock }
  read() { return this.lock(async () => {
    const { orders, entries, tips } = readStore(this.storage())
    // 单次读取提供一致快照，不暴露存储版本、键或当前老板资料。
    return { orders, entries, tips }
  }) }
}
export function createLocalStorageDataAccess(options: { storage?: () => AppStorage & Pick<Storage, 'removeItem'>; clock?: () => number; lock?: MutationLock } = {}): DataAccess {
  const storage = options.storage ?? (() => window.localStorage), lock = options.lock ?? dataLock
  const bosses = new LocalStorageBossRepository(storage, lock)
  const orders = new LocalStorageOrderRepository({ storage, lock, clock: options.clock })
  const history = new LocalStorageHistoryRepository(storage, lock)
  return {
    bosses,
    balances: { entries: id => bosses.entries(id), changeBalance: (id, input) => bosses.changeBalance(id, input), clearDebt: (id, notes) => bosses.clearDebt(id, notes) },
    orders,
    pauses: {
      list: async id => {
        const order = (await orders.list()).find(o => o.id === id)
        if (!order) throw new Error('订单不存在，请刷新页面。')
        return order.pauses.map(pause => ({ ...pause }))
      },
      pause: id => orders.pause(id), resume: id => orders.resume(id),
    },
    tips: new LocalStorageTipRepository(storage, lock),
    history, statistics: history,
    changes: { subscribe: listener => {
      if (typeof window === 'undefined') return () => {}
      const keys = [APP_STORAGE_KEY, LEGACY_ACCOUNTS_KEY, LEGACY_BOSSES_KEY, ORDER_STORAGE_KEY]
      const changed = (event: StorageEvent) => { if (event.key === null || keys.includes(event.key)) listener() }
      window.addEventListener(DATA_CHANGED_EVENT, listener); window.addEventListener('storage', changed)
      return () => { window.removeEventListener(DATA_CHANGED_EVENT, listener); window.removeEventListener('storage', changed) }
    } },
    testing: { clear: () => lock(async () => {
      const store = readStore(storage())
      const ids = new Set([...store.bosses, ...store.orders, ...store.entries, ...store.tips].filter(r => r.isTestMode).map(r => 'id' in r && 'balanceCents' in r ? profileKey(r) : (r.profileId ?? ('bossId' in r ? recordProfileKey(r) : ''))))
      store.bosses = store.bosses.filter(b => !ids.has(profileKey(b)))
      store.orders = store.orders.filter(r => !ids.has((r.profileId ?? ('bossId' in r ? recordProfileKey(r) : ''))))
      store.entries = store.entries.filter(r => !ids.has((r.profileId ?? ('bossId' in r ? recordProfileKey(r) : ''))))
      store.tips = store.tips.filter(r => !ids.has(r.profileId))
      writeStore(storage(), store)
    }) },
    development: { clear: () => clearTestData(storage(), lock) },
    management: {
      openExports: async () => { throw new Error('请在 Electron SQLite 正式模式打开导出目录。') },
      info: async () => { throw new Error('请在 Electron SQLite 正式模式使用数据管理。') },
      backup: async () => { throw new Error('请在 Electron SQLite 正式模式备份。') },
      inspectRestore: async () => { throw new Error('请在 Electron SQLite 正式模式恢复。') },
      restore: async () => { throw new Error('当前模式不能恢复数据库。') },
      cancelRestore: async () => {},
      openFolder: async () => { throw new Error('请在 Electron SQLite 正式模式打开数据目录。') },
    },
    migration: {
      status: async () => ({ mode: 'local-storage', formalAvailable: false }),
      exportData: () => lock(() => exportMigration(storage(), options.clock?.() ?? Date.now())),
      prepare: async () => { throw new Error('请在 Electron SQLite 测试模式中导入迁移文件。') },
      activate: async () => { throw new Error('请在 Electron SQLite 测试模式中验收迁移。') },
      discard: async () => { throw new Error('当前没有待验收迁移。') },
    },
  }
}
