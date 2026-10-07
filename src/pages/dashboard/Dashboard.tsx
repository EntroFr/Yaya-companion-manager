import { useStatistics } from '../../features/statistics/useStatistics'
import { StatisticsCards } from '../../features/statistics/StatisticsCards'
import { TipForm } from '../../features/tips/TipForm'
import { useState } from 'react'
import type { OrderController } from '../../features/orders/useOrders'
import { BossPicker } from '../../features/bosses/BossPicker'
import { BossForm } from '../../features/bosses/BossForm'
import { RechargeForm } from '../../features/balance/RechargeForm'
import { Modal } from '../../components/dialog/Modal'
import { displayNickname } from '../../features/bosses/bossPresentation'
import { formatMoney } from '../../utils/money'
import { bossDetailHash } from '../../app/navigation'
import { SoundSetting } from '../../features/settings/SoundSetting'

type QuickAction = 'start' | 'recharge' | 'create' | 'tip'
export function Dashboard({ controller }: { controller: OrderController }) {
  const today = useStatistics('today')
  const [action, setAction] = useState<QuickAction | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const selected = controller.bosses.find(boss => boss.id === selectedId)
  const busy = saving || controller.busy
  function open(next: QuickAction) { setAction(next); setSelectedId(null); setNotice('') }
  function close() { if (!busy) { setAction(null); setSelectedId(null) } }
  return <>
    <header className="page-header"><div><p className="eyebrow">YAYA’S DIARY</p><h1>日常工作台</h1><p className="muted">开始陪玩、充值和查找老板，都从这里出发。</p></div><span className="status-badge">Yaya的陪玩日记</span></header>
    {notice && <p className="feedback success" role="status">{notice}</p>}
    <section className="panel" aria-labelledby="quick-actions-title">
      <div className="section-heading quick-actions-heading"><h2 id="quick-actions-title">快捷操作</h2><SoundSetting /></div>
      <div className="quick-actions">
        <button className="quick-action" disabled={controller.loading || busy} onClick={() => open('start')}><strong>开始订单</strong><span>选择老板，确认后开始计时</span></button>
        <button className="quick-action" disabled={controller.loading || busy} onClick={() => open('recharge')}><strong>老板充值</strong><span>充值余额，自动留下流水</span></button>
        <button className="quick-action" disabled={controller.loading || busy} onClick={() => open('create')}><strong>新增老板</strong><span>自定义唯一 ID，昵称可留空</span></button>
        <button className="quick-action" disabled={controller.loading || busy} onClick={() => open('tip')}><strong>记录打赏</strong><span>独立记录打赏，陪玩余额不变</span></button>
      </div>
    </section>
    <section className="panel" aria-labelledby="today-overview-title">
      <div className="section-heading"><h2 id="today-overview-title">今日概览</h2><a className="text-button" href="#statistics">查看收入统计 →</a></div>
      {today.error ? <p className="feedback error" role="alert">{today.error}</p> : today.stats ? <StatisticsCards stats={today.stats} compact /> : <p className="empty-state">正在读取统计…</p>}
    </section>
    <section className="panel" aria-labelledby="quick-search-title">
      <div className="section-heading"><h2 id="quick-search-title">老板快速搜索</h2><span>点击结果打开老板详情</span></div>
      <BossPicker bosses={controller.bosses} loading={controller.loading} onSelect={boss => { window.location.hash = bossDetailHash(boss.id) }} />
    </section>
    {action && <Modal title={action === 'start' ? '快捷开始订单' : action === 'recharge' ? '老板充值' : action === 'tip' ? '记录打赏' : '新增老板'} onClose={close} busy={busy}>
      {action === 'create' ? <BossForm onBusyChange={setSaving} onCancel={close} onSaved={async () => { await controller.refresh(); setAction(null); setNotice('老板已新增，可以搜索或开始充值。') }} /> : <>
        {selectedId === null ? <BossPicker bosses={controller.bosses} loading={controller.loading} onSelect={boss => setSelectedId(boss.id)} /> : selected ? <>
          <button className="text-button" disabled={busy} onClick={() => setSelectedId(null)}>← 重新选择老板</button>
          {action === 'start' ? <div className="quick-confirm">
            <h3>确认开始订单</h3><dl className="details-grid"><div><dt>老板 ID</dt><dd>{selected.id}</dd></div><div><dt>昵称 / 备注名</dt><dd>{displayNickname(selected.nickname)}</dd></div><div><dt>当前余额</dt><dd>{formatMoney(selected.balanceCents)}</dd></div><div><dt>本单单价</dt><dd>{formatMoney(selected.hourlyRateCents)} / 小时</dd></div></dl>
            <p className="muted">开始时保存单价快照；实时显示预计余额，结束时一次性结算，余额耗尽不会自动结束。</p>
            {controller.error && <p className="feedback error" role="alert">{controller.error}</p>}
            <div className="form-actions"><button className="button primary" disabled={busy} onClick={async () => { if (await controller.start(selected.id)) { setAction(null); setSelectedId(null) } }}>{controller.busy ? '正在开始…' : '确认开始订单'}</button><button className="button" disabled={busy} onClick={close}>取消</button></div>
          </div> : action === 'tip' ? <TipForm boss={selected} onBusyChange={setSaving} onCancel={close} onSaved={async () => { setAction(null); setSelectedId(null); setNotice('打赏已保存，陪玩余额不变。') }} /> : <RechargeForm boss={selected} onBusyChange={setSaving} onCancel={close} onSaved={async () => { await controller.refresh(); setAction(null); setSelectedId(null); setNotice('充值已保存，充值流水已生成。') }} />}
        </> : <p className="feedback error" role="alert">该老板已不存在，请重新选择。</p>}
      </>}
    </Modal>}
    <footer className="page-footer">Yaya的陪玩日记 <span>让工作有条理，让陪伴有记录。</span></footer>
  </>
}
