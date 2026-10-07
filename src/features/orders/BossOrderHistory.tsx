import { displayNickname } from '../bosses/bossPresentation'
import { useId } from 'react'
import { recordProfileKey } from '../bosses/bossIdentity'
import type { Order } from './types'
import { formatDuration } from './orderTime'
import { formatMoney } from '../../utils/money'
export function BossOrderHistory({ orders, bossId, profileId }: { orders: Order[]; bossId?: string; profileId?: string }) {
  const titleId = useId()
  const history = orders.filter(o => (!bossId || o.bossId === bossId) && (!profileId || recordProfileKey(o) === profileId) && o.status === 'completed')
  return <section className="balance-section" aria-labelledby={titleId}>
    <div className="section-heading"><h3 id={titleId}>订单历史</h3><span>最新订单在前 · 不可编辑或删除</span></div>
    {history.length === 0 ? <p className="empty-state">暂无已结束的订单。</p> : <div className="table-scroll"><table>
      <thead><tr><th scope="col">老板 ID / 昵称快照</th><th scope="col">订单 ID</th><th scope="col">开始时间</th><th scope="col">结束时间</th><th scope="col">有效服务时长</th><th scope="col">当时单价</th><th scope="col">最终消费</th><th scope="col">结束时余额</th><th scope="col">结束原因</th><th scope="col">状态</th></tr></thead>
      <tbody>{history.map(order => <tr key={order.id}>
        <td>{order.bossId}<small>{displayNickname(order.nicknameSnapshot)}</small></td><td className="id-cell">{order.id}</td><td>{new Date(order.startedAt).toLocaleString('zh-CN', { hour12: false })}</td><td>{new Date(order.endedAt!).toLocaleString('zh-CN', { hour12: false })}</td>
        <td className="nowrap">{formatDuration(order.accumulatedMs)}</td><td className="nowrap">{formatMoney(order.hourlyRateCentsSnapshot)} / 小时</td><td className="nowrap">{formatMoney(order.finalChargeCents ?? 0)}{order.legacyUnbilled && <small>阶段四未计费</small>}</td><td className="nowrap">{order.balanceAtEndCents === null ? '未记录' : formatMoney(order.balanceAtEndCents)}</td><td>{order.endReason}</td><td>已结束</td>
      </tr>)}</tbody>
    </table></div>}
  </section>
}

