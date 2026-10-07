import { dataAccess } from '../data/dataAccess'
import { RechargeForm } from './RechargeForm'
import { displayNickname } from '../bosses/bossPresentation'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Boss, BalanceEntry, BalanceType } from '../bosses/types'
import { formatMoney, parseMoney, remainingServiceTime } from '../../utils/money'

const labels: Record<BalanceType, string> = { recharge: '充值', manual_add: '手动增加', manual_deduct: '手动扣除', order_consumption: '订单消费', debt_clear: '欠费清零' }
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'

export function BossBalance({ boss, onChanged }: { boss: Boss; onChanged: () => Promise<void> }) {
  const [entries, setEntries] = useState<BalanceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState<BalanceType | null>(null)
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [clearing, setClearing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let active = true
    dataAccess.balances.entries(boss.id).then(data => { if (active) setEntries(data) })
      .catch(err => { if (active) setError(errorText(err)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [boss])
  function open(nextType: BalanceType) {
    setType(nextType); setAmount(''); setNotes(''); setError(''); setNotice('')
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!type || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await dataAccess.balances.changeBalance(boss.id, { type, amountCents: parseMoney(amount), notes })
      await onChanged()
      setEntries(await dataAccess.balances.entries(boss.id))
      setType(null); setNotice('余额已更新，流水已保存。')
    } catch (err) { setError(errorText(err)) }
    finally { setBusy(false) }
  }
  async function clearDebt() {
    setBusy(true); setError(''); setNotice('')
    try { await dataAccess.balances.clearDebt(boss.id); await onChanged(); setEntries(await dataAccess.balances.entries(boss.id)); setNotice('负余额已清零，调整流水已保存。'); setClearing(false) }
    catch (err) { setError(errorText(err)) }
    finally { setBusy(false) }
  }
  return <div className="balance-section">
    <div className="balance-summary">
      <div><p className="muted">当前余额</p><p className="balance-value">{formatMoney(boss.balanceCents)}</p></div>
      <div><p className="muted">当前单价</p><p>{formatMoney(boss.hourlyRateCents)} / 小时</p></div>
      <div><p className="muted">剩余服务时间</p><p>{remainingServiceTime(boss.balanceCents, boss.hourlyRateCents)}</p></div>
    </div>
    <div className="form-actions">
      <button className="button primary" disabled={busy} onClick={() => open('recharge')}>充值</button>
      <button className="button" disabled={busy} onClick={() => open('manual_add')}>手动增加</button>
      <button className="button" disabled={busy} onClick={() => open('manual_deduct')}>手动扣除</button>
    </div>
    {boss.balanceCents < 0 && <div className="form-actions"><button className="button" disabled={busy} onClick={() => setClearing(true)}>清零负余额</button></div>}
    {clearing && <div className="modal-backdrop"><div className="confirm-dialog panel" role="alertdialog" aria-modal="true" aria-labelledby="clear-debt-title">
      <h2 id="clear-debt-title">确认清零负余额？</h2><p>当前欠费 {formatMoney(Math.max(0, -boss.balanceCents))}，确认将该老板余额调整为 ¥0.00 吗？会保留一条欠费清零流水；进行中的订单仍会继续计费。</p>
      <div className="form-actions"><button autoFocus className="button" disabled={busy} onClick={() => setClearing(false)}>取消</button><button className="button primary" disabled={busy || boss.balanceCents >= 0} onClick={() => void clearDebt()}>确认清零</button></div>
      {error && <p className="feedback error" role="alert">{error}</p>}
    </div></div>}
    {type === 'recharge' && <RechargeForm boss={boss} onBusyChange={setBusy} onCancel={() => setType(null)} onSaved={async () => {
      await onChanged(); setEntries(await dataAccess.balances.entries(boss.id)); setType(null); setNotice('充值已保存，流水已生成。')
    }} />}
    {type && type !== 'recharge' && <form className="balance-form" onSubmit={submit}>
      <h3>{labels[type]} · {displayNickname(boss.nickname)}</h3>
      <p className="muted">老板 ID：{boss.id}。每次保存会同时生成一条不可编辑的余额流水。</p>
      <div className="form-grid">
        <label>{labels[type]}金额（元） <span className="required">*</span><input autoFocus inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="例如：70.00" required disabled={busy} /><small>请输入大于 0 的金额，最多保留两位小数。</small></label>
        <label>流水备注（可选）<textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} disabled={busy} /></label>
      </div>
      <div className="form-actions"><button className="button primary" type="submit" disabled={busy}>{busy ? '正在保存…' : '确认保存'}</button><button className="button" type="button" disabled={busy} onClick={() => { setType(null); setError('') }}>取消</button></div>
    </form>}
    {error && <p className="feedback error" role="alert">{error}</p>}
    {notice && <p className="feedback success" role="status">{notice}</p>}
    <div className="section-heading ledger-heading"><h3>余额流水</h3><span>按时间倒序 · 历史记录不可编辑</span></div>
    {loading ? <p className="empty-state">正在读取流水…</p> : entries.length === 0 ? <p className="empty-state">暂无余额流水，充值或手动调整后会在这里留下记录。</p> : <div className="table-scroll"><table>
      <thead><tr><th scope="col">时间 / 流水 ID</th><th scope="col">类型 / 订单 ID</th><th scope="col">金额变化</th><th scope="col">变化前</th><th scope="col">变化后</th><th scope="col">备注</th></tr></thead>
      <tbody>{entries.map(entry => <tr key={entry.id}>
        <td>{new Date(entry.createdAt).toLocaleString('zh-CN', { hour12: false })}<small className="ledger-id">{entry.id}</small></td>
        <td className="nowrap">{labels[entry.type]}{entry.orderId && <small className="ledger-id">{entry.orderId}</small>}</td>
        <td className={`nowrap ${entry.deltaCents < 0 ? 'danger' : 'amount-positive'}`}>{entry.deltaCents < 0 ? '−' : '+'}{formatMoney(Math.abs(entry.deltaCents))}</td>
        <td className="nowrap">{formatMoney(entry.beforeCents)}</td><td className="nowrap">{formatMoney(entry.afterCents)}</td>
        <td className="notes">{entry.notes || '—'}</td>
      </tr>)}</tbody>
    </table></div>}
  </div>
}



