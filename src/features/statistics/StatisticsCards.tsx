import type { Statistics } from './statistics'
import { formatMoney } from '../../utils/money'
import { formatDuration } from '../orders/orderTime'

export function StatisticsCards({ stats, compact = false }: { stats: Statistics; compact?: boolean }) {
  const metrics = compact ? [
    ['今日服务时长', formatDuration(stats.serviceMs)], ['今日实际收入', formatMoney(stats.incomeCents)], ['今日充值收款', formatMoney(stats.rechargeCents)], ['今日打赏', formatMoney(stats.tipCents)],
  ] : [
    ['有效服务时长', formatDuration(stats.serviceMs)], ['服务收入', formatMoney(stats.serviceIncomeCents)], ['充值收款', formatMoney(stats.rechargeCents)], ['打赏', formatMoney(stats.tipCents)], ['收款合计', formatMoney(stats.receiptsCents)], ['实际收入', formatMoney(stats.incomeCents)],
  ]
  return <dl className={`statistics-grid ${compact ? 'compact' : ''}`}>{metrics.map(([label, value]) => <div className="statistics-card" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}
