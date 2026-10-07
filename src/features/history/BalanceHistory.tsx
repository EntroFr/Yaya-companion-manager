import { useHistoryWindow } from './useHistoryWindow'
import type { BalanceEntry } from '../bosses/types'
import { displayNickname } from '../bosses/bossPresentation'
import { formatMoney } from '../../utils/money'
import { balanceLabels,compactTime,readableNotes } from './presentation'
import { HistoryDateControl,HistoryToggle } from './HistoryControls'
export function BalanceHistory({entries,title='全部余额流水'}:{entries:BalanceEntry[];title?:string}) {
  const history=useHistoryWindow(entries.slice().reverse().sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)),e=>e.createdAt)
  return <section className="balance-section"><div className="section-heading"><h3>{title}</h3><span>显示最近 3 条 · 历史记录不可编辑</span></div>
    <HistoryDateControl value={history.date} onChange={history.setDate}/>
    {!history.total?<p className="empty-state">该日期暂无余额流水。</p>:<div className="table-scroll"><table className="history-table"><thead><tr>{['老板 ID / 昵称快照','类型','金额变化','变化前','变化后','时间','备注'].map(label=><th key={label}>{label}</th>)}</tr></thead>
    <tbody>{history.visible.map(e=><tr key={e.id}><td>{e.bossId}<small>{displayNickname(e.nicknameSnapshot??'')}{e.isTestMode && <span className="test-mode-badge">测试</span>}</small></td><td>{balanceLabels[e.type]}</td><td>{e.deltaCents>=0?'+':''}{formatMoney(e.deltaCents)}</td><td>{formatMoney(e.beforeCents)}</td><td>{formatMoney(e.afterCents)}</td><td>{compactTime(e.createdAt)}</td><td className="notes">{readableNotes(e.notes)}</td></tr>)}</tbody></table></div>}
    <HistoryToggle total={history.total} expanded={history.expanded} onClick={history.toggle}/>
  </section>
}
