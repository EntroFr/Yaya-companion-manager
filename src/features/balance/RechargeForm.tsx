import { dataAccess } from '../data/dataAccess'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Boss } from '../bosses/types'
import { displayNickname } from '../bosses/bossPresentation'
import { formatMoney, parseMoney } from '../../utils/money'
export function RechargeForm({ boss, onSaved, onCancel, onBusyChange }: { boss: Boss; onSaved: () => Promise<void>; onCancel: () => void; onBusyChange?: (busy: boolean) => void }) {
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true); onBusyChange?.(true); setError('')
    try { await dataAccess.balances.changeBalance(boss.id, { type: 'recharge', amountCents: parseMoney(amount), notes }); await onSaved() }
    catch (err) { setError(err instanceof Error ? err.message : '充值失败，请重试。') }
    finally { setSaving(false); onBusyChange?.(false) }
  }
  return <form onSubmit={submit}>
    <p><strong>{displayNickname(boss.nickname)}</strong> · 老板 ID：{boss.id}</p><p className="muted">当前余额：{formatMoney(boss.balanceCents)}</p>
    <div className="form-grid"><label>充值金额（元） <span className="required">*</span><input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="例如：70.00" required disabled={saving} /><small>请输入大于 0 的金额，最多保留两位小数。</small></label><label>流水备注（可选）<textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} disabled={saving} /></label></div>
    {error && <p className="feedback error" role="alert">{error}</p>}
    <div className="form-actions"><button className="button primary" type="submit" disabled={saving}>{saving ? '正在保存…' : '确认充值'}</button><button className="button" type="button" disabled={saving} onClick={onCancel}>取消</button></div>
  </form>
}
