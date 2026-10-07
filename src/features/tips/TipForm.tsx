import { dataAccess } from '../data/dataAccess'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Boss } from '../bosses/types'
import type { Tip } from './types'
import { displayNickname } from '../bosses/bossPresentation'
import { profileKey } from '../bosses/bossIdentity'
import { localDateTime, receivedAtIso } from './tipTime'
import { formatMoney, parseMoney } from '../../utils/money'

export function TipForm({ boss, tip, onSaved, onCancel, onBusyChange }: { boss?: Boss; tip?: Tip; onSaved: () => Promise<void>; onCancel: () => void; onBusyChange?: (busy: boolean) => void }) {
  const [amount, setAmount] = useState(tip ? (tip.amountCents / 100).toFixed(2) : '')
  const [receivedAt, setReceivedAt] = useState(() => localDateTime(tip?.receivedAt ?? new Date()))
  const [notes, setNotes] = useState(tip?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return
    setSaving(true); onBusyChange?.(true); setError('')
    try {
      const input = { amountCents: parseMoney(amount), receivedAt: receivedAtIso(receivedAt), notes }
      if (tip) await dataAccess.tips.update(tip.id, input)
      else if (boss) await dataAccess.tips.create(profileKey(boss), input)
      else throw new Error('请先选择老板。')
      await onSaved()
    } catch (err) { setError(err instanceof Error ? err.message : '打赏保存失败，请重试。') }
    finally { setSaving(false); onBusyChange?.(false) }
  }
  return <form onSubmit={submit}>
    <p><strong>{displayNickname(tip?.nicknameSnapshot ?? boss?.nickname ?? '')}</strong> · 老板 ID：{tip?.bossIdSnapshot ?? boss?.id}</p>
    <p className="muted">打赏独立记录，不改变陪玩余额。{boss && `当前余额：${formatMoney(boss.balanceCents)}`}</p>
    <div className="form-grid">
      <label>打赏金额（元） <span className="required">*</span><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required disabled={saving} placeholder="例如：20.00" /><small>金额必须大于零，最多保留两位小数。</small></label>
      <label>打赏发生时间 <span className="required">*</span><input type="datetime-local" step="1" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} required disabled={saving} /><small>默认电脑当前时间，可修改以补录历史打赏。</small></label>
      <label className="full-width">打赏备注（可选）<textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} disabled={saving} /></label>
    </div>
    {error && <p className="feedback error" role="alert">{error}</p>}
    <div className="form-actions"><button type="submit" className="button primary" disabled={saving}>{saving ? '正在保存…' : tip ? '保存修改' : '确认记录打赏'}</button><button type="button" className="button" disabled={saving} onClick={onCancel}>取消</button></div>
  </form>
}
