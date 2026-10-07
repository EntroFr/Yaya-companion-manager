import { displayNickname } from '../bosses/bossPresentation'
import { useEffect, useState } from 'react'
import type { OrderController } from './useOrders'
import { formatDuration, serviceDurationMs } from './orderTime'
import { formatMoney } from '../../utils/money'
import { liveBilling, overtimeMinutes } from './billing'
import { useBalanceAlert } from './useBalanceAlert'
import { formatRemainingServiceTime, remainingServiceSeconds } from './balanceAlert'
const orderStatusLabel = { active: '进行中', paused: '已暂停', completed: '已结束' }
export function CurrentOrder({ controller, showEmpty = false }: { controller: OrderController; showEmpty?: boolean }) {
  const [now, setNow] = useState(Date.now)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  useEffect(() => {
    // 仅刷新显示；真实时间始终来自持久化时间戳。
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const order = controller.orders.find(o => o.status !== 'completed')
  const boss = controller.bosses.find(b => b.id === order?.bossId)
  const live = order && boss ? liveBilling(order, boss.balanceCents, Math.max(now,order.startedAt)) : null
  const estimated = live?.consumptionCents ?? 0, available = live?.estimatedBalanceCents ?? 0
  const remainingSeconds = remainingServiceSeconds(available, order?.hourlyRateCentsSnapshot ?? 0)
  useBalanceAlert(order && boss ? order.id : null, available, order?.hourlyRateCentsSnapshot ?? 0, order?.status ?? 'completed')
  return <div id="order-area">
    {controller.error && <p className="feedback error" role="alert">{controller.error}</p>}
    {controller.notice && <p className="feedback success" role="status">{controller.notice}</p>}
    {!order && showEmpty && <section className="panel" aria-labelledby="empty-current-order-title"><h2 id="empty-current-order-title">当前订单</h2><p className="empty-state">{controller.loading ? '正在恢复订单…' : '当前没有进行中的订单'}</p></section>}
    {order && <>
      <section className="panel current-order" aria-labelledby="current-order-title">
        <div className="section-heading"><h2 id="current-order-title">当前订单</h2><span className="status-badge">{orderStatusLabel[order.status]}</span></div>
        <div className="order-summary">
          <div><p className="muted">正在服务</p><p className="order-boss">{displayNickname(order.nicknameSnapshot)}</p><small>老板 ID：{order.bossId}</small></div>
          <div><p className="muted">本单单价（开始时快照）</p><p>{formatMoney(order.hourlyRateCentsSnapshot)} / 小时</p><small>开始：{new Date(order.startedAt).toLocaleString('zh-CN', { hour12: false })}</small></div>
          <div><p className="muted">已服务时间</p><p className="order-timer" aria-label="已服务时间">{formatDuration(serviceDurationMs(order, Math.max(now, order.startedAt)))}</p></div>
        </div>
        {boss && <>
          <div className="billing-summary">
            <div><p className="muted">实时预计余额</p><p className={available <= 0 ? 'danger' : ''}>{formatMoney(available)}</p><small>正式余额：{formatMoney(boss.balanceCents)}</small></div>
            <div><p className="muted">本单实时消费</p><p>{formatMoney(estimated)}</p></div>
            {order.settledAmountCents > 0 && <div><p className="muted">旧订单已扣费用（不重复收取）</p><p>{formatMoney(order.settledAmountCents)}</p></div>}
            {available > 0 && <div><p className="muted">预计剩余服务时间</p><p>余额预计还可服务 {formatRemainingServiceTime(remainingSeconds)}</p></div>}
            {available <= 0 && <div><p className="muted">预计欠费金额 / 当前超时时间</p><p>{formatMoney(Math.abs(available))} · 约 {overtimeMinutes(available, order.hourlyRateCentsSnapshot)} 分钟</p></div>}
          </div>
          {available > 0 && remainingSeconds <= 300 && <p className="feedback error" role="status">余额即将不足。{order.status === 'paused' ? '订单已暂停，暂停期间不计费。' : '请及时充值，余额耗尽后订单仍会继续。'}</p>}
          {available <= 0 && <p className="feedback error" role="status">老板余额已用完，当前进入超时服务。{order.status === 'paused' ? '订单已暂停，暂停期间不计费。' : '订单继续计时，结束时结算。'}</p>}
        </>}
        <div className="form-actions">
          {order.status === 'active' ? <button className="button" disabled={controller.busy} onClick={() => void controller.pause(order.id)}>暂停订单</button> : <button className="button primary" disabled={controller.busy} onClick={() => void controller.resume(order.id)}>继续订单</button>}
          <button id="end-order-button" className="button" disabled={controller.busy} onClick={() => setConfirmId(order.id)}>结束订单</button>
        </div>
        <small>订单 ID：{order.id} · 暂停不计时 · 结束时一次性结算 · 余额耗尽不会自动结束</small>
      </section>
      {confirmId === order.id && <div className="modal-backdrop">
        <div className="confirm-dialog panel" role="alertdialog" aria-modal="true" aria-labelledby="end-confirm-title" aria-describedby="end-confirm-description" onKeyDown={event => {
          if (event.key === 'Escape' && !controller.busy) { setConfirmId(null); document.getElementById('end-order-button')?.focus() }
          if (event.key === 'Tab') {
            const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
            if (buttons.length === 0) { event.preventDefault(); return }
            if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus() }
            else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus() }
          }
        }}>
          <h2 id="end-confirm-title">确认结束订单？</h2>
          <p id="end-confirm-description">正在服务「{displayNickname(order.nicknameSnapshot)}」（老板 ID：{order.bossId}）。确认后结算尚未扣除的剩余费用并结束订单，余额允许变为负数。</p>
          <div className="form-actions">
            <button autoFocus className="button" disabled={controller.busy} onClick={() => { setConfirmId(null); document.getElementById('end-order-button')?.focus() }}>取消</button>
            <button className="button primary" disabled={controller.busy} onClick={async () => { await controller.complete(order.id); setConfirmId(null) }}>{controller.busy ? '正在保存…' : '确认结束'}</button>
          </div>
        </div>
      </div>}
    </>}
  </div>
}


