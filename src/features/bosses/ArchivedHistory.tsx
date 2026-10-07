import { TipRecords } from '../tips/TipRecords'
import { useEffect, useState } from 'react'
import { dataAccess } from '../data/dataAccess'
import type { HistoryData } from '../data/contracts'
import { BossOrderHistory } from '../orders/BossOrderHistory'
import { BalanceHistory } from '../history/BalanceHistory'


export function ArchivedHistory() {
  const [store, setStore] = useState<HistoryData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const refresh = () => { dataAccess.history.read().then(data => { if (active) { setStore(data); setError('') } }).catch(err => { if (active) setError(err instanceof Error ? err.message : '历史记录读取失败。') }) }
    refresh(); const unsubscribe = dataAccess.changes.subscribe(refresh)
    return () => { active = false; unsubscribe() }
  }, [])
  return <section className="panel"><h2>全部历史记录</h2><p className="muted">包含已删除老板及旧资料的记录，按时间倒序显示，订单和余额流水仅供查看，打赏支持修改与删除。</p>
    {error && <p role="alert" className="feedback error">{error}</p>}
    {store && <><BossOrderHistory orders={store.orders.slice().sort((a, b) => b.startedAt - a.startedAt)} />
      <BalanceHistory entries={store.entries}/><TipRecords /></>}
  </section>
}
