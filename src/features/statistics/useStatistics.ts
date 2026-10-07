import { useEffect, useState } from 'react'
import { dataAccess } from '../data/dataAccess'
import type { HistoryData } from '../data/contracts'
import { calculateStatistics, periodRange } from './statistics'
import type { StatisticsPeriod } from './statistics'

export function useStatistics(period: StatisticsPeriod) {
  const [data, setData] = useState<HistoryData | null>(null)
  const [now, setNow] = useState(Date.now)
  const [readError, setReadError] = useState('')
  useEffect(() => {
    let active = true
    const refresh = () => { dataAccess.statistics.read().then(snapshot => { if (active) { setData(snapshot); setReadError(''); setNow(Date.now()) } }).catch(err => { if (active) setReadError(err instanceof Error ? err.message : '读取统计失败。') }) }
    refresh()
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    const unsubscribe = dataAccess.changes.subscribe(refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; window.clearInterval(tick); unsubscribe(); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  const range = periodRange(period, now)
  try { return { stats: data ? calculateStatistics(data, range) : null, range, error: readError } }
  catch (err) { return { stats: null, range, error: err instanceof Error ? err.message : '统计计算失败。' } }
}
