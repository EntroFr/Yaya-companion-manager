import { dataAccess } from '../data/dataAccess'
import { useEffect, useState } from 'react'
import type { Boss } from '../bosses/types'
import type { Tip } from './types'
import { profileKey } from '../bosses/bossIdentity'
import { totalTipCents } from './tipMetrics'
import { displayNickname } from '../bosses/bossPresentation'
import { Modal } from '../../components/dialog/Modal'
import { TipForm } from './TipForm'
import { formatMoney } from '../../utils/money'

export function TipRecords({ boss }: { boss?: Boss }) {
  const [tips, setTips] = useState<Tip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<Tip | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Tip | null>(null)
  const [busy, setBusy] = useState(false)
  const profileId = boss ? profileKey(boss) : undefined
  useEffect(() => {
    let active = true
    const refresh = () => { dataAccess.tips.list(profileId).then(data => { if (active) { setTips(data); setError('') } }).catch(err => { if (active) setError(err instanceof Error ? err.message : '读取打赏失败。') }).finally(() => { if (active) setLoading(false) }) }
    refresh(); const unsubscribe = dataAccess.changes.subscribe(refresh)
    return () => { active = false; unsubscribe() }
  }, [profileId])
  let total = ''
  try { total = formatMoney(totalTipCents(tips)) } catch { total = '累计金额超出安全范围' }
  return <section className="balance-section tip-section">
    <div className="section-heading"><h3>{boss ? '老板打赏记录' : '全部打赏历史'}</h3>{boss && <button className="button primary" disabled={busy || loading} onClick={() => { setEditing('new'); setNotice('') }}>记录打赏</button>}</div>
    {boss ? <p>累计打赏金额：<strong className="amount-positive">{total}</strong></p> : <p className="muted">打赏与陪玩余额独立，已删除老板的记录仍保留。可修改金额、发生时间和备注。</p>}
    {error && <p className="feedback error" role="alert">{error}</p>}{notice && <p className="feedback success" role="status">{notice}</p>}
    {loading ? <p className="empty-state">正在读取打赏…</p> : !tips.length ? <p className="empty-state">暂无打赏记录。</p> : <div className="table-scroll"><table>
      <thead><tr><th scope="col">老板 ID / 昵称快照</th><th scope="col">金额</th><th scope="col">发生时间 / 打赏 ID</th><th scope="col">备注</th><th scope="col">操作</th></tr></thead>
      <tbody>{tips.map(tip => <tr key={tip.id}><td>{tip.bossIdSnapshot}<small>{displayNickname(tip.nicknameSnapshot)}</small></td><td className="nowrap">{formatMoney(tip.amountCents)}</td><td>{new Date(tip.receivedAt).toLocaleString('zh-CN', { hour12: false })}<small className="ledger-id">{tip.id}</small></td><td className="notes">{tip.notes || '—'}</td><td><div className="row-actions"><button className="text-button" disabled={busy} aria-label={`修改打赏 ${tip.id}`} onClick={() => { setEditing(tip); setNotice('') }}>修改</button><button className="text-button danger" disabled={busy} aria-label={`删除打赏 ${tip.id}`} onClick={() => { setDeleting(tip); setError('') }}>删除</button></div></td></tr>)}</tbody>
    </table></div>}
    {editing && <Modal title={editing === 'new' ? '记录打赏' : '修改打赏'} busy={busy} onClose={() => setEditing(null)}><TipForm boss={editing === 'new' ? boss : undefined} tip={editing === 'new' ? undefined : editing} onBusyChange={setBusy} onCancel={() => setEditing(null)} onSaved={async () => { setTips(await dataAccess.tips.list(profileId)); setEditing(null); setNotice('打赏已保存，陪玩余额不变。') }} /></Modal>}
    {deleting && <Modal title="确认删除打赏" busy={busy} onClose={() => setDeleting(null)}><p>确认删除老板 {deleting.bossIdSnapshot} 的 {formatMoney(deleting.amountCents)} 打赏？删除后无法恢复，陪玩余额不变。</p><div className="form-actions"><button className="button" disabled={busy} onClick={() => setDeleting(null)}>取消</button><button className="button primary" disabled={busy} onClick={async () => {
      setBusy(true); setError('')
      try { await dataAccess.tips.remove(deleting.id); setTips(await dataAccess.tips.list(profileId)); setDeleting(null); setNotice('打赏已删除，陪玩余额不变。') }
      catch (err) { setError(err instanceof Error ? err.message : '删除打赏失败。') }
      finally { setBusy(false) }
    }}>确认删除打赏</button></div>{error && <p className="feedback error" role="alert">{error}</p>}</Modal>}
  </section>
}
