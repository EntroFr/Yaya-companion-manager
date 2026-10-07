import { dataAccess } from '../data/dataAccess'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Order } from './types'
import type { Boss } from '../bosses/types'
const errorText = (error: unknown) => error instanceof Error ? error.message : '订单操作失败，请重试。'
export function useOrders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [bosses, setBosses] = useState<Boss[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const refreshing = useRef(false)
  const pending = useRef(false)
  const refresh = useCallback(async function refreshData() {
    if (refreshing.current) { pending.current = true; return }
    refreshing.current = true
    try { setOrders(await dataAccess.orders.list()); setBosses(await dataAccess.bosses.list()) }
    catch (err) { setError(errorText(err)) }
    finally { refreshing.current = false; setLoading(false) }
    if (pending.current) { pending.current = false; void Promise.resolve().then(refreshData) }
  }, [])
  useEffect(() => {
    void Promise.resolve().then(refresh)
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    const localChanged = () => { void refresh() }
    const unsubscribe = dataAccess.changes.subscribe(localChanged)
    document.addEventListener('visibilitychange', visible)
    return () => { unsubscribe(); document.removeEventListener('visibilitychange', visible) }
  }, [refresh])
  async function run(action: () => Promise<Order>, success: string) {
    if (busy) return false
    setBusy(true); setError(''); setNotice('')
    try { await action(); await refresh(); setNotice(success); return true }
    catch (err) { setError(errorText(err)); await refresh(); return false }
    finally { setBusy(false) }
  }
  return {
    orders, bosses, loading, busy, error, notice, refresh,
    start: (bossId: string) => run(() => dataAccess.orders.start(bossId), '订单已开始，实时显示消费，结束时一次性结算。'),
    pause: (id: string) => run(() => dataAccess.pauses.pause(id), '订单已暂停，暂停期间不计时、不计费。'),
    resume: (id: string) => run(() => dataAccess.pauses.resume(id), '订单已继续。'),
    complete: (id: string) => run(() => dataAccess.orders.complete(id), '订单已结束，剩余费用已结算并保存到历史记录。'),
  }
}
export type OrderController = ReturnType<typeof useOrders>


