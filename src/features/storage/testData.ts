import { APP_STORAGE_KEY, LEGACY_ACCOUNTS_KEY, LEGACY_BOSSES_KEY, DATA_CHANGED_EVENT } from './appStore.ts'
import { ORDER_STORAGE_KEY } from '../orders/orderStorage.ts'
import { dataLock } from './dataLock.ts'
import type { MutationLock } from './dataLock'

export const TEST_DATA_KEYS = [APP_STORAGE_KEY, LEGACY_ACCOUNTS_KEY, LEGACY_BOSSES_KEY, ORDER_STORAGE_KEY]
// 集中管理开发入口；正式发布时可关闭此开关。
export { ENABLE_TEST_DATA_MANAGEMENT } from '../data/development.ts'
export function clearTestData(storage: Pick<Storage, 'removeItem'> = window.localStorage, lock: MutationLock = dataLock) {
  return lock(async () => {
    for (const key of TEST_DATA_KEYS) storage.removeItem(key)
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(DATA_CHANGED_EVENT))
  })
}
