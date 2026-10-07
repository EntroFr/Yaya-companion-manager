import type { DataAccess } from './contracts'
import type { StorageMode } from '../migration/format'

type Reply<T> = { ok: true; value: T } | { ok: false; message: string }
type AsyncRepositories = Omit<DataAccess, 'changes'>
type BridgeRepositories = { [G in keyof AsyncRepositories]: { [M in keyof AsyncRepositories[G]]: AsyncRepositories[G][M] extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<Reply<R>> : never } }
export interface DesktopBridge {
  mode: StorageMode
  packaged?: boolean
  repositories?: BridgeRepositories
  subscribe?: (listener: () => void) => () => void
}
declare global { interface Window { yayaDesktop?: DesktopBridge } }
export function createElectronDataAccess(bridge: DesktopBridge): DataAccess {
  if (!['sqlite-test','sqlite'].includes(bridge.mode) || !bridge.repositories || !bridge.subscribe) throw new Error('SQLite 接口不可用，已停止启动。')
  const result = {} as AsyncRepositories
  for (const group of Object.keys(bridge.repositories) as (keyof AsyncRepositories)[]) {
    const wrapped: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    for (const [name, call] of Object.entries(bridge.repositories[group])) {
      wrapped[name] = async (...args) => {
        const reply = await (call as (...args: unknown[]) => Promise<Reply<unknown>>)(...args)
        if (!reply.ok) throw new Error(reply.message)
        return reply.value
      }
    }
    Object.assign(result, { [group]: wrapped })
  }
  return { ...result, changes: { subscribe: bridge.subscribe } }
}
