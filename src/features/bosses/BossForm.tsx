import { dataAccess } from '../data/dataAccess'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Boss } from './types'
import { moneyInput, parseMoney } from '../../utils/money'
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'
export function BossForm({ boss, onSaved, onCancel, onBusyChange }: { boss?: Boss; onSaved: (boss: Boss) => Promise<void>; onCancel: () => void; onBusyChange?: (busy: boolean) => void }) {
  const [id, setId] = useState(boss?.id ?? '')
  const [nickname, setNickname] = useState(boss?.nickname ?? '')
  const [rate, setRate] = useState(moneyInput(boss?.hourlyRateCents ?? 3500))
  const [notes, setNotes] = useState(boss?.notes ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    if (!rate.trim()) { setError('请填写当前单价。'); return }
    setSaving(true); onBusyChange?.(true)
    try {
      const fields = { nickname, hourlyRateCents: parseMoney(rate), notes }
      const saved = boss ? await dataAccess.bosses.update(boss.id, fields) : await dataAccess.bosses.create({ id, ...fields })
      await onSaved(saved)
    } catch (err) { setError(message(err)) }
    finally { setSaving(false); onBusyChange?.(false) }
  }
  return <section className="panel" aria-labelledby="boss-form-title">
    <h2 id="boss-form-title">{boss ? '编辑老板' : '新增老板'}</h2>
    <form onSubmit={submit} className="boss-form">
      <div className="form-grid">
        <label>老板 ID <span className="required">*</span><input autoFocus={!boss} value={id} onChange={e => setId(e.target.value)} readOnly={!!boss} required aria-describedby="id-help" /><small id="id-help">{boss ? 'ID 已锁定，创建后不可修改。' : '手动输入唯一 ID，区分大小写；创建后不可修改。'}</small></label>
        <label>昵称 / 备注名（选填）<input autoFocus={!!boss} value={nickname} onChange={e => setNickname(e.target.value)} /></label>
        <label>当前单价（元 / 小时） <span className="required">*</span><input type="number" value={rate} onChange={e => setRate(e.target.value)} min="0" max="1000000" step="0.01" required /><small>默认 35 元 / 小时，可保留两位小数。</small></label>
        <label className="full-width">备注（可选）<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} /></label>
      </div>
      {error && <p className="feedback error" role="alert">{error}</p>}
      <div className="form-actions"><button className="button primary" type="submit" disabled={saving}>{saving ? '正在保存…' : '保存资料'}</button><button className="button" type="button" disabled={saving} onClick={onCancel}>取消</button></div>
    </form>
  </section>
}






