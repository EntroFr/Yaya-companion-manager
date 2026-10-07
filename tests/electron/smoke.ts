import '../../src/main'
import { dataAccess } from '../../src/features/data/dataAccess'
import { profileKey } from '../../src/features/bosses/bossIdentity'
import { calculateStatistics, periodRange } from '../../src/features/statistics/statistics'

function check(condition: unknown, message: string) { if (!condition) throw new Error(message) }
async function run() {
  // 直接测试 Renderer 中的现有业务接口；不模拟用户鼠标或键盘，不访问正常用户目录。
  if (window.yayaDesktop?.mode !== 'local-storage') check(localStorage.length === 0, 'SQLite 模式写入了 localStorage')
  if (window.location.hash === '#restored') {
    check((await dataAccess.bosses.list()).length === 1, '刷新后老板资料丢失')
    const history = await dataAccess.history.read()
    check(history.orders[0]?.status === 'completed' && history.tips[0]?.amountCents === 2000, '刷新后订单或打赏丢失')
    check((await dataAccess.bosses.list())[0].balanceCents === 7000 - (history.orders[0].finalChargeCents ?? 0), '刷新后余额丢失')
    return ['刷新后持久化正常']
  }
  check(typeof (window as unknown as { require?: unknown }).require === 'undefined', 'Renderer 获得了 Node 权限')
  check(typeof (window as unknown as { process?: unknown }).process === 'undefined', 'Renderer 获得了 process 权限')
  let notifications = 0
  const unsubscribe = dataAccess.changes.subscribe(() => { notifications++ })
  const boss = await dataAccess.bosses.create({ id: 'ELECTRON-SMOKE', nickname: '桌面测试', hourlyRateCents: 3500, notes: '' })
  try {
    await dataAccess.bosses.create({ id: 'ELECTRON-SMOKE', nickname: '', hourlyRateCents: 3500, notes: '' })
    throw new Error('重复 ID 未被阻止')
  } catch (error) { check(error instanceof Error && error.message.includes('已存在'), '重复 ID 的中文错误未正确传回 Renderer') }
  await dataAccess.bosses.update(boss.id, { nickname: '修改昵称', hourlyRateCents: 3500, notes: '测试' })
  const disposable = await dataAccess.bosses.create({ id: 'DISPOSABLE', nickname: '', hourlyRateCents: 3500, notes: '' })
  await dataAccess.bosses.remove(disposable.id)
  check((await dataAccess.bosses.list()).length === 1, '老板 CRUD 异常')
  await dataAccess.balances.changeBalance(boss.id, { type: 'recharge', amountCents: 7000, notes: '' })
  for (let attempt = 0; notifications === 0 && attempt < 20; attempt++) await new Promise(resolve => setTimeout(resolve, 25))
  check(notifications > 0, '成功提交后的变更通知未送达')
  unsubscribe()
  const order = await dataAccess.orders.start(boss.id)
  check((await dataAccess.pauses.pause(order.id)).status === 'paused', '暂停异常')
  check((await dataAccess.pauses.resume(order.id)).status === 'active', '继续异常')
  check((await dataAccess.orders.complete(order.id)).status === 'completed', '结束异常')
  const tip = await dataAccess.tips.create(profileKey(boss), { amountCents: 2000, receivedAt: new Date().toISOString(), notes: '' })
  await dataAccess.tips.update(tip.id, { amountCents: 2500, receivedAt: tip.receivedAt, notes: '已修改' })
  await dataAccess.tips.remove(tip.id)
  await dataAccess.tips.create(profileKey(boss), { amountCents: 2000, receivedAt: new Date().toISOString(), notes: '' })
  const metrics = calculateStatistics(await dataAccess.statistics.read(), periodRange('today'))
  check(metrics.rechargeCents === 7000 && metrics.tipCents === 2000 && metrics.receiptsCents === 9000, '收入统计异常')
  if (window.yayaDesktop?.mode === 'local-storage') {
    const output = document.createElement('output'); output.id = 'migration-export'; output.hidden = true; output.textContent = await dataAccess.migration.exportData(); document.body.append(output)
  }
  return ['Node 隔离正常', '老板 CRUD 正常', '充值正常', '订单生命周期正常', '打赏 CRUD 正常', '收入统计正常']
}
run().then(checks => {
  const result = document.createElement('output'); result.id = 'electron-smoke-result'; result.textContent = JSON.stringify({ ok: true, checks }); document.body.append(result)
}).catch(error => {
  const result = document.createElement('output'); result.id = 'electron-smoke-result'; result.textContent = JSON.stringify({ ok: false, error: error.message }); document.body.append(result)
})
