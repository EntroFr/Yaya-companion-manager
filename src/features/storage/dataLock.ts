export type MutationLock = <T>(action: () => Promise<T>) => Promise<T>
let queue: Promise<unknown> = Promise.resolve()
export const dataLock: MutationLock = action => {
  if (typeof window !== 'undefined') {
    if (!navigator.locks) return Promise.reject(new Error('当前浏览器不支持数据互斥锁，请使用新版 Chrome 或 Edge。'))
    return navigator.locks.request('yaya-diary:data-mutation', action)
  }
  const result = queue.then(action)
  queue = result.catch(() => {})
  return result
}
