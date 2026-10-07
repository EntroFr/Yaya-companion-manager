import { useSyncExternalStore } from 'react'
import { preferences } from './preferences'
export function useSoundEnabled() {
  return useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, () => true)
}
