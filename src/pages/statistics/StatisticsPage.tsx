import { useState } from 'react'
import { useStatistics } from '../../features/statistics/useStatistics'
import type { StatisticsPeriod } from '../../features/statistics/statistics'
import { StatisticsCards } from '../../features/statistics/StatisticsCards'

const periods: { value: StatisticsPeriod; label: string }[] = [{ value: 'today', label: '今日' }, { value: 'week', label: '本周' }, { value: 'month', label: '本月' }]
const date = (value: number) => new Date(value).toLocaleString('zh-CN', { hour12: false })
export function StatisticsPage() {
  const [period, setPeriod] = useState<StatisticsPeriod>('today')
  const { stats, range, error } = useStatistics(period)
  return <>
    <header className="page-header"><div><p className="eyebrow">YAYA’S DIARY</p><h1>收入统计</h1><p className="muted">区分服务收入与充值收款，记录有效工作时间。</p></div></header>
    <section className="panel">
      <div className="form-actions" role="group" aria-label="统计周期">{periods.map(item => <button key={item.value} className={`button ${period === item.value ? 'primary' : ''}`} aria-pressed={period === item.value} onClick={() => setPeriod(item.value)}>{item.label}</button>)}</div>
      <p className="storage-note">电脑本地时间：{date(range.start)} → {date(range.end)}（截至目前）</p>
      {error ? <p className="feedback error" role="alert">{error}</p> : stats ? <StatisticsCards stats={stats} /> : <p className="empty-state">正在读取统计…</p>}
    </section>
    <section className="panel statistics-explanation"><h2>统计口径</h2><p>服务收入按订单有效服务时间和开始时的单价计算，包含当前订单尚未结算的服务；暂停时间不计入。</p><p>充值收款仅包含「充值」流水。收款合计 = 充值收款 + 打赏；实际收入 = 服务收入 + 打赏。</p><p>打赏按发生时间统计。跨天订单按各日服务区间拆分，删除老板后历史仍参与统计。本周从周一零点开始，本月从1日零点开始。</p></section>
  </>
}
