import { useEffect, useState } from 'react'
import { dataAccess } from '../../features/data/dataAccess'
import type { MigrationReport, MigrationStatus, MigrationSummary } from '../../features/migration/format'
import { formatMoney } from '../../utils/money'
import { formatDuration } from '../../features/orders/orderTime'

const labels: Record<string, string> = { bosses: '当前老板', identities: '永久身份（含已删除资料）', orders: '全部订单', active: '进行中订单', paused: '暂停订单', completed: '已完成订单', entries: '余额流水', tips: '打赏记录', rechargeCents: '总充值', consumptionCents: '总订单消费', tipCents: '总打赏', finalChargeCents: '已完成订单最终费用' }
const periods: Record<string, string> = { today: '今日', week: '本周', month: '本月' }
const metrics: Record<string, string> = { serviceMs: '有效服务时长', serviceIncomeCents: '服务收入', rechargeCents: '充值收款', tipCents: '打赏', receiptsCents: '收款合计', incomeCents: '实际收入' }
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function MigrationPage() {
  const packaged = window.yayaDesktop?.packaged
  const [status, setStatus] = useState<MigrationStatus | null>(null), [report, setReport] = useState<MigrationReport | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => { let alive = true; void dataAccess.migration.status().then(value => { if (alive) { setStatus(value); setReport(value.pending ?? null) } }).catch(err => { if (alive) setError(err.message) }); return () => { alive = false } }, [])
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await action(); setStatus(await dataAccess.migration.status()) }
    catch (err) { setError(err instanceof Error ? err.message : '迁移操作失败，原资料保留。') }
    finally { setBusy(false) }
  }
  return <>
    <header className="page-header"><div><p className="eyebrow">YAYA’S DIARY</p><h1>数据迁移</h1><p className="muted">导出原资料，临时库校验，对账通过后再启用正式库。</p></div></header>
    <section className="panel"><h2>当前数据源</h2><p>{status?.mode === 'sqlite' ? 'SQLite 正式数据源' : status?.mode === 'sqlite-test' ? 'SQLite 独立测试数据源' : status ? '原本地网页存储' : '正在读取…'}</p>
      <p className="muted">建议先结束进行中订单再迁移。启用正式库后，请持续使用正式模式，避免在两个独立数据源中分别记账。原资料不会自动删除；切回原模式可查看迁移前资料，但不会同步正式库的新记录。</p>
      {error && <p role="alert" className="feedback error">{error}</p>}{notice && <p role="status">{notice}</p>}
      {status?.mode === 'local-storage' ? <button className="button primary" disabled={busy} onClick={() => void run(async () => {
        const text = await dataAccess.migration.exportData(); download(text, `yaya-migration-v1-${Date.now()}.json`); setNotice('校验通过，迁移文件已生成。请保留文件，并在 SQLite 测试模式导入。')
      })}>导出迁移数据</button> : status && <>
        <p className="muted">文件只导入临时数据库，不改变当前测试库或正式库。已有正式库不会被覆盖。</p>
        <label className="field">导入迁移文件<input type="file" accept=".json,application/json" disabled={busy || !!report || status.formalAvailable} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''
          if (file) void run(async () => { if (file.size > 20 * 1024 * 1024) throw new Error('迁移文件不能超过20MB。'); setReport(await dataAccess.migration.prepare(await file.text())); setNotice('临时库导入及对账通过，尚未切换正式数据源。') })
        }} /></label>
        {status.formalAvailable && <p>{packaged ? '正式数据库已有资料，迁移不能覆盖当前资料。如需恢复已有备份，请进入数据管理。' : <>正式库已存在。关闭窗口后运行 <code>pnpm electron:local:formal</code> 使用正式数据源。</>}</p>}
      </>}
    </section>
    {report && <section className="panel migration-report"><h2>迁移对账结果：{report.passed ? '通过' : '未通过'}</h2>
      <p className="muted">对账时刻：{new Date(report.comparedAt).toLocaleString()}（使用导出时刻，避免进行中订单自然增长影响对比）</p>{!packaged && <p className="migration-fingerprint">SHA-256：{report.fingerprint}</p>}
      {report.warnings.map(w => <p role="status" key={w}>{w}</p>)}
      <div className="table-scroll"><table><thead><tr><th>项目</th><th>迁移前</th><th>临时库</th></tr></thead><tbody>
        {Object.entries(labels).map(([key,label]) => { const k = key as keyof MigrationSummary; const a = report.before[k] as number, b = report.after[k] as number; return <tr key={key}><td>{label}</td><td>{key.endsWith('Cents') ? formatMoney(a) : a}</td><td>{key.endsWith('Cents') ? formatMoney(b) : b}</td></tr> })}
        {report.before.balances.map((balance,i) => <tr key={balance.profileId}><td>老板 {balance.bossId} 当前余额</td><td>{formatMoney(balance.balanceCents)}</td><td>{formatMoney(report.after.balances[i].balanceCents)}</td></tr>)}
        {Object.entries(periods).flatMap(([period,title]) => Object.entries(metrics).map(([metric,label]) => { const k = metric as keyof typeof report.before.periods.today; const a = report.before.periods[period][k], b = report.after.periods[period][k]; return <tr key={`${period}-${metric}`}><td>{title}{label}</td><td>{metric === 'serviceMs' ? formatDuration(a) : formatMoney(a)}</td><td>{metric === 'serviceMs' ? formatDuration(b) : formatMoney(b)}</td></tr> }))}
      </tbody></table></div>
      <div className="form-actions"><button className="button primary" disabled={busy || !report.passed} onClick={() => {
        if (window.confirm('确认使用对账通过的资料启用正式数据库吗？原资料保留，已有正式记账资料不会被覆盖。')) void run(async () => { await dataAccess.migration.activate(report.token); setReport(null); setNotice(status?.mode === 'sqlite' ? '旧资料已导入，当前窗口已使用这些正式资料。' : '正式库已启用。请关闭窗口，运行 pnpm electron:local:formal。') })
      }}>确认启用正式库</button><button className="button" disabled={busy} onClick={() => void run(async () => { await dataAccess.migration.discard(report.token); setReport(null); setNotice('已取消待验收迁移，原资料保持不变。') })}>取消本次迁移</button><button className="text-button" onClick={() => download(JSON.stringify(report,null,2),'yaya-migration-reconciliation.json')}>保存对账结果</button></div>
    </section>}
  </>
}
