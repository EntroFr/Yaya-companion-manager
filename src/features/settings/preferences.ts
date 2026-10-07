export const PREFERENCES_KEY = 'yaya-diary:preferences:v1'
interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
export function createPreferences(storage: () => PreferenceStorage) {
  let enabled = true
  let initialized = false
  const listeners = new Set<() => void>()
  function getSnapshot() {
    if (!initialized) {
      initialized = true
      try {
        const value: unknown = JSON.parse(storage().getItem(PREFERENCES_KEY) ?? '{}')
        if (value && typeof value === 'object' && 'soundEnabled' in value && typeof value.soundEnabled === 'boolean') enabled = value.soundEnabled
      } catch { /* 配置缺失、损坏或不可读时默认开启，不阻断业务。 */ }
    }
    return enabled
  }
  return {
    getSnapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    setSoundEnabled(value: boolean) {
      getSnapshot()
      enabled = value
      let saved = true
      try { storage().setItem(PREFERENCES_KEY, JSON.stringify({ soundEnabled: enabled })) }
      catch { saved = false }
      for (const listener of listeners) listener()
      return saved
    },
  }
}
// 只保存 UI 偏好；Electron 将其保存在当前 userData 对应的 Renderer 存储空间。
export const preferences = createPreferences(() => window.localStorage)
