import { dataAccess } from '../../features/data/dataAccess'
import { TipRecords } from '../../features/tips/TipRecords'
import { Modal } from '../../components/dialog/Modal'
import { ArchivedHistory } from '../../features/bosses/ArchivedHistory'
import { ENABLE_TEST_DATA_MANAGEMENT } from '../../features/data/development'
import { profileKey } from '../../features/bosses/bossIdentity'
import { useEffect, useState } from 'react'
import { BossForm } from '../../features/bosses/BossForm'
import { displayNickname, searchBosses } from '../../features/bosses/bossPresentation'
import type { Boss } from '../../features/bosses/types'

import { formatMoney } from '../../utils/money'
import { BossBalance } from '../../features/balance/BossBalance'
import { BossOrderHistory } from '../../features/orders/BossOrderHistory'
import type { OrderController } from '../../features/orders/useOrders'
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'

export function BossesPage({ orders, initialBossId = null }: { orders: OrderController; initialBossId?: string | null }) {
  const [bosses, setBosses] = useState<Boss[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(initialBossId)
  const [form, setForm] = useState<{ boss?: Boss } | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<Boss | null>(null)
  const [clearing, setClearing] = useState(false)
  const visibleBosses = searchBosses(bosses, query)
  const selected = bosses.find(boss => boss.id === selectedId)

  useEffect(() => {
    let active = true
    dataAccess.bosses.list().then(data => { if (active) setBosses(data) })
      .catch(err => { if (active) setError(message(err)) })
      .finally(() => { if (active) setLoading(false) })
    const refreshBosses = () => { dataAccess.bosses.list().then(data => { if (active) setBosses(data) }).catch(err => { if (active) setError(message(err)) }) }
    const unsubscribe = dataAccess.changes.subscribe(refreshBosses)
    return () => { active = false; unsubscribe() }
  }, [])

  useEffect(() => {
    if (initialBossId && !loading) document.getElementById('boss-detail-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [initialBossId, loading])

  async function remove(boss: Boss) {
    setBusy(true); setError(''); setNotice('')
    try {
      await dataAccess.bosses.remove(boss.id)
      setBosses(await dataAccess.bosses.list())
      if (selectedId === boss.id) setSelectedId(null)
      if (form?.boss?.id === boss.id) setForm(null)
      setDeleting(null); setNotice('老板资料已删除，历史订单、流水和打赏已保留。')
    } catch (err) { setError(message(err)) }
    finally { setBusy(false) }
  }

  return <>
    <header className="page-header">
      <div><p className="eyebrow">YAYA’S DIARY</p><h1>老板信息</h1><p className="muted">记录昵称、当前单价与备注，让每份资料清楚有序。</p></div>
      <button className="button primary" disabled={loading || busy} onClick={() => { setForm({}); setNotice('') }}>＋ 新增老板</button>
    </header>
    <p className="storage-note">资料已安全保存在本机数据库中，可通过“数据管理”进行备份与恢复。</p>
    {initialBossId && !loading && !bosses.some(boss => boss.id === initialBossId) && <p className="feedback error" role="alert">该老板不存在或已删除，请从列表重新选择。</p>}
    {error && <p className="feedback error" role="alert">{error}</p>}
    {notice && <p className="feedback success" role="status">{notice}</p>}
    {form && <BossForm key={form.boss?.id ?? 'new'} boss={form.boss} onCancel={() => setForm(null)} onSaved={async boss => {
      setBosses(await dataAccess.bosses.list()); setSelectedId(boss.id); setForm(null); setError(''); setNotice('老板资料已保存。')
    }} />}
    <section className="panel" aria-labelledby="boss-list-title">
      <div className="section-heading"><h2 id="boss-list-title">老板列表</h2><span>{query.trim() ? `找到 ${visibleBosses.length} 位 / 共 ${bosses.length} 位` : `共 ${bosses.length} 位`}</span></div>
      <label className="boss-search">搜索老板<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="输入老板 ID 或昵称 / 备注名" /></label>
      {loading ? <p className="empty-state">正在读取资料…</p> : bosses.length === 0 ? <p className="empty-state">还没有老板资料，点击「新增老板」开始记录。</p> : visibleBosses.length === 0 ? <p className="empty-state">没有找到匹配的老板，请尝试其他 ID 或昵称。</p> : <div className="table-scroll"><table>
        <thead><tr><th scope="col">老板 ID</th><th scope="col">昵称 / 备注名</th><th scope="col">当前余额</th><th scope="col">当前单价</th><th scope="col">创建时间</th><th scope="col">操作</th></tr></thead>
        <tbody>{visibleBosses.map(boss => <tr key={boss.id}>
          <td className="id-cell">{boss.id}</td><td>{displayNickname(boss.nickname)}{boss.isTestMode && <span className="test-mode-badge">测试</span>}</td><td className="nowrap">{formatMoney(boss.balanceCents)}</td><td className="nowrap">{formatMoney(boss.hourlyRateCents)} / 小时</td><td>{date(boss.createdAt)}</td>
          <td><div className="row-actions">
            <button className="text-button" disabled={busy} onClick={() => setSelectedId(boss.id)} aria-label={`查看 ${displayNickname(boss.nickname)}（${boss.id}） 的详情`}>详情</button>
            <button className="text-button" disabled={busy} onClick={() => { setForm({ boss }); setNotice('') }} aria-label={`编辑 ${displayNickname(boss.nickname)}（${boss.id}）`}>编辑</button>
            <button className="text-button danger" disabled={busy} onClick={() => { setError(''); setDeleting(boss) }} aria-label={`删除 ${displayNickname(boss.nickname)}（${boss.id}）`}>删除</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    {selected && <section className="panel" aria-labelledby="boss-detail-title">
      <div className="section-heading"><h2 id="boss-detail-title">老板详情</h2><button className="text-button" onClick={() => setSelectedId(null)}>收起详情</button></div>
      <dl className="details-grid">
        <div><dt>自定义唯一 ID</dt><dd>{selected.id}</dd></div>
        <div><dt>昵称 / 备注名</dt><dd>{displayNickname(selected.nickname)}{selected.isTestMode && <span className="test-mode-badge">测试</span>}</dd></div>
        <div><dt>当前单价</dt><dd>{formatMoney(selected.hourlyRateCents)} / 小时</dd></div>
        <div><dt>创建时间</dt><dd>{date(selected.createdAt)}</dd></div>
        <div className="full-width"><dt>备注</dt><dd className="notes">{selected.notes || '暂无备注'}</dd></div>
      </dl>
      <div className="form-actions"><button className="button primary" disabled={orders.loading || orders.busy} onClick={async () => { await orders.start(selected.id); window.requestAnimationFrame(() => document.getElementById('order-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }}>开始订单</button></div>
      <small>余额和单价必须大于零；全系统只能有一个未结束的订单。</small>
      <BossBalance key={selected.id} boss={selected} onChanged={async () => setBosses(await dataAccess.bosses.list())} />
      <TipRecords key={profileKey(selected)} boss={selected} />
      <BossOrderHistory orders={orders.orders} bossId={selected.id} profileId={profileKey(selected)} />
    </section>}
    <ArchivedHistory />
    {ENABLE_TEST_DATA_MANAGEMENT && <section className="panel"><h2>开发/测试数据管理</h2><p className="muted">仅用于开发测试阶段。清理后所有资料和账目都无法恢复。</p><button className="button danger" disabled={busy} onClick={() => { setError(''); setClearing(true) }}>清除所有测试数据</button></section>}
    {deleting && <Modal title="确认删除老板资料" busy={busy} onClose={() => setDeleting(null)}><p>确认删除「{displayNickname(deleting.nickname)}」（ID：{deleting.id}）的当前资料？资料无法恢复，历史订单、余额流水和打赏记录将保留。</p><div className="form-actions"><button className="button" disabled={busy} onClick={() => setDeleting(null)}>取消</button><button className="button primary" disabled={busy} onClick={() => void remove(deleting)}>确认删除</button></div>{error && <p className="feedback error" role="alert">{error}</p>}</Modal>}
    {clearing && <Modal title="清除所有测试数据" busy={busy} onClose={() => setClearing(false)}><p>此操作将删除所有老板、订单、余额流水、打赏记录和本地测试数据，且无法恢复。是否继续？</p><div className="form-actions"><button className="button" disabled={busy} onClick={() => setClearing(false)}>取消</button><button className="button primary" disabled={busy} onClick={async () => {
      setBusy(true); setError('')
      try { await dataAccess.development.clear(); setBosses([]); setSelectedId(null); setForm(null); setQuery(''); await orders.refresh(); setClearing(false); setNotice('所有测试数据已清除。'); window.location.hash = '#bosses' }
      catch (err) { setError(message(err)) }
      finally { setBusy(false) }
    }}>确认清除</button></div>{error && <p className="feedback error" role="alert">{error}</p>}</Modal>}
  </>
}


