import { TipRecords } from '../tips/TipRecords'
import { useEffect, useState } from 'react'
import { dataAccess } from '../data/dataAccess'
import type { HistoryData } from '../data/contracts'
import { BossOrderHistory } from '../orders/BossOrderHistory'
import { displayNickname } from './bossPresentation'
import { formatMoney } from '../../utils/money'

const labels = { recharge: '充值', manual_add: '手动增加', manual_deduct: '手动扣除', order_consumption: '订单消费', debt_clear: '欠费清零' }
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
      <h3>全部余额流水</h3>{!store.entries.length ? <p className="empty-state">暂无余额流水。</p> : <div className="table-scroll"><table>
        <thead><tr><th>老板 ID / 昵称快照</th><th>类型 / 流水 ID / 订单 ID</th><th>金额变化</th><th>变化前</th><th>变化后</th><th>时间</th><th>备注</th></tr></thead>
        <tbody>{store.entries.slice().reverse().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(e => <tr key={e.id}>
          <td>{e.bossId}<small>{displayNickname(e.nicknameSnapshot ?? '')}</small></td><td>{labels[e.type]}<small>{e.id}</small>{e.orderId && <small>{e.orderId}</small>}</td>
          <td>{e.deltaCents >= 0 ? '+' : ''}{formatMoney(e.deltaCents)}</td><td>{formatMoney(e.beforeCents)}</td><td>{formatMoney(e.afterCents)}</td><td>{new Date(e.createdAt).toLocaleString('zh-CN')}</td><td>{e.notes || '—'}</td>
        </tr>)}</tbody></table></div>}<TipRecords /></>}
  </section>
}
