import { useState } from 'react'
import { displayNickname, searchBosses } from './bossPresentation'
import type { Boss } from './types'
import { formatMoney } from '../../utils/money'
export function BossPicker({ bosses, onSelect, loading = false }: { bosses: Boss[]; onSelect: (boss: Boss) => void; loading?: boolean }) {
  const [query, setQuery] = useState('')
  const results = searchBosses(bosses, query)
  return <>
    <label className="boss-search">搜索老板<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="输入老板 ID 或昵称 / 备注名" /></label>
    {loading ? <p className="empty-state">正在读取老板资料…</p> : results.length === 0 ? <p className="empty-state">{bosses.length === 0 ? '还没有老板，请先新增老板。' : '没有找到匹配的老板，请尝试其他 ID 或昵称。'}</p> : <div className="boss-picker-results">
      {results.map(boss => <button type="button" className="boss-result" key={boss.id} onClick={() => onSelect(boss)} aria-label={`选择老板 ${boss.id}`}>
        <span><strong>{displayNickname(boss.nickname)}</strong><small>老板 ID：{boss.id}</small></span>
        <span><small>当前余额</small>{formatMoney(boss.balanceCents)}</span>
        <span><small>当前单价</small>{formatMoney(boss.hourlyRateCents)} / 小时</span>
      </button>)}
    </div>}
  </>
}
