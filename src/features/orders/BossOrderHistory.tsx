import { useHistoryWindow } from '../history/useHistoryWindow'
import { displayNickname } from '../bosses/bossPresentation'
import { useId } from 'react'
import { recordProfileKey } from '../bosses/bossIdentity'
import type { Order } from './types'
import { formatDuration } from './orderTime'
import { formatMoney } from '../../utils/money'
import { compactTime } from '../history/presentation'
import { HistoryDateControl, HistoryToggle } from '../history/HistoryControls'
export function BossOrderHistory({ orders, bossId, profileId }: { orders: Order[]; bossId?: string; profileId?: string }) {
  const titleId=useId()
  const records=orders.filter(o=>(!bossId||o.bossId===bossId)&&(!profileId||recordProfileKey(o)===profileId)&&o.status==='completed').sort((a,b)=>b.startedAt-a.startedAt)
  const history=useHistoryWindow(records,o=>o.endedAt!)
  return <section className="balance-section" aria-labelledby={titleId}>
    <div className="section-heading"><h3 id={titleId}>订单历史</h3><span>显示最近 3 条 · 不可编辑或删除</span></div>
    <HistoryDateControl value={history.date} onChange={history.setDate}/>
    {!history.total?<p className="empty-state">该日期暂无已结束的订单。</p>:<div className="table-scroll"><table className="history-table">
      <thead><tr>{['老板 ID / 昵称快照','开始时间','结束时间','有效服务时长','最终消费','结束时余额','结束原因','状态'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{history.visible.map(order=><tr key={order.id}>
        <td>{order.bossId}<small>{displayNickname(order.nicknameSnapshot)}{order.isTestMode && <span className="test-mode-badge">测试</span>}</small></td><td className="nowrap">{compactTime(order.startedAt)}</td><td className="nowrap">{compactTime(order.endedAt!)}</td>
        <td>{formatDuration(order.accumulatedMs)}</td><td>{formatMoney(order.finalChargeCents??0)}{order.legacyUnbilled&&<small>阶段四未计费</small>}</td><td>{order.balanceAtEndCents===null?'未记录':formatMoney(order.balanceAtEndCents)}</td><td>{order.endReason}</td><td>已结束</td>
      </tr>)}</tbody>
    </table></div>}
    <HistoryToggle total={history.total} expanded={history.expanded} onClick={history.toggle}/>
  </section>
}

