import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { migrateSchema } from './schema.ts'
import { chargeCents } from '../../src/features/orders/billing.ts'
import { serviceDurationMs } from '../../src/features/orders/orderTime.ts'
import { displayNickname } from '../../src/features/bosses/bossPresentation.ts'
import { validateBossFields, validateTipInput } from '../../src/features/data/inputValidation.ts'
import type { Boss, BossInput, BossChanges, BalanceInput, BalanceEntry } from '../../src/features/bosses/types'
import type { Order, PauseRecord } from '../../src/features/orders/types'
import type { Tip, TipInput } from '../../src/features/tips/types'
import type { AppStore } from '../../src/features/storage/appStore'

type Row = Record<string, string | number | bigint | null | Uint8Array>
const iso = (value: unknown) => new Date(Number(value)).toISOString()
const nullableNumber = (value: unknown) => value === null ? null : Number(value)
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请输入有效的 ID。')
  return value
}
function safeInteger(value: number) {
  if (!Number.isSafeInteger(value)) throw new Error('金额或时间超出安全范围，未保存。')
  return value
}
export const BUSINESS_METHODS = [
  'bosses.list', 'bosses.create', 'bosses.update', 'bosses.remove',
  'balances.entries', 'balances.changeBalance', 'balances.clearDebt',
  'orders.list', 'orders.start', 'orders.settle', 'orders.pause', 'orders.resume', 'orders.complete',
  'pauses.list', 'pauses.pause', 'pauses.resume',
  'tips.list', 'tips.create', 'tips.update', 'tips.remove', 'history.read', 'statistics.read', 'development.clear',
] as const
export type BusinessMethod = typeof BUSINESS_METHODS[number]
const READ_METHODS = new Set(['bosses.list', 'balances.entries', 'orders.list', 'orders.settle', 'pauses.list', 'tips.list', 'history.read', 'statistics.read'])

// SQL 仅在 Main 中执行。事务内无 await，读取结算状态至提交期间不会交错。
export class SQLiteService {
  readonly database: DatabaseSync
  lastChanged = false
  private readonly clock: () => number
  private readonly checkpoint: (stage: string) => void
  constructor(file: string, options: { clock?: () => number; checkpoint?: (stage: string) => void } = {}) {
    this.clock = options.clock ?? Date.now
    this.checkpoint = options.checkpoint ?? (() => {}) // 测试注入失败；不通过 IPC 暴露。
    this.database = new DatabaseSync(file, { enableForeignKeyConstraints: true, allowExtension: false })
    try { migrateSchema(this.database) } catch (error) { this.database.close(); throw error }
  }
  close() { this.database.close() }
  snapshot(): AppStore {
    this.database.exec('BEGIN')
    try {
      const data: AppStore = { version: 3, bosses: this.all('SELECT * FROM boss_profiles ORDER BY rowid').map(row => this.mapBoss(row)), orders: this.listOrders(), entries: this.entries(undefined, true), tips: this.tips() }
      this.database.exec('COMMIT'); return data
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
  private all(sql: string, ...args: (string | number)[]) { return this.database.prepare(sql).all(...args) as Row[] }
  private get(sql: string, ...args: (string | number)[]) { return this.database.prepare(sql).get(...args) as Row | undefined }
  private run(sql: string, ...args: (string | number | null)[]) { this.database.prepare(sql).run(...args) }
  private now() { return safeInteger(this.clock()) }
  execute(method: BusinessMethod, args: unknown[] = []): unknown {
    if (!BUSINESS_METHODS.includes(method) || !Array.isArray(args)) throw new Error('不支持的数据操作。')
    this.lastChanged = false
    const before = this.get('SELECT total_changes() AS n')!.n
    this.database.exec(READ_METHODS.has(method) ? 'BEGIN' : 'BEGIN IMMEDIATE')
    try {
      const result = this.dispatch(method, args)
      this.checkpoint('before-commit')
      this.database.exec('COMMIT')
      this.lastChanged = this.get('SELECT total_changes() AS n')!.n !== before
      return result
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
  private mapBoss(row: Row): Boss {
    return { profileId: String(row.profile_id), id: String(row.boss_id), nickname: String(row.nickname), hourlyRateCents: Number(row.hourly_rate_cents), balanceCents: Number(row.balance_cents), createdAt: iso(row.created_at), notes: String(row.notes) }
  }
  private boss(id: string): Boss {
    const row = this.get('SELECT * FROM boss_profiles WHERE boss_id = ?', id)
    if (!row) throw new Error('该老板已不存在，请刷新列表。')
    return this.mapBoss(row)
  }
  private pauses(id: string): PauseRecord[] {
    return this.all('SELECT * FROM order_pauses WHERE order_id = ? ORDER BY sequence', id).map(p => ({ startedAt: Number(p.started_at), endedAt: nullableNumber(p.ended_at) }))
  }
  private mapOrder(row: Row): Order {
    return { id: String(row.order_id), profileId: String(row.profile_id), bossId: String(row.boss_id_snapshot), nicknameSnapshot: String(row.nickname_snapshot), hourlyRateCentsSnapshot: Number(row.hourly_rate_cents_snapshot), startedAt: Number(row.started_at), endedAt: nullableNumber(row.ended_at), status: row.status as Order['status'], accumulatedMs: Number(row.accumulated_ms), pauses: this.pauses(String(row.order_id)), settledServiceSeconds: Number(row.settled_service_seconds), settledAmountCents: Number(row.settled_amount_cents), finalChargeCents: nullableNumber(row.final_charge_cents), balanceAtEndCents: nullableNumber(row.balance_at_end_cents), endReason: row.end_reason === null ? null : String(row.end_reason), createdAt: Number(row.created_at), ...(row.billing_model === 'on-completion' ? { billingModel: 'on-completion' as const } : {}), ...(row.legacy_unbilled === 1 ? { legacyUnbilled: true } : {}) }
  }
  private order(id: string): Order {
    const row = this.get('SELECT * FROM orders WHERE order_id = ?', id)
    if (!row) throw new Error('订单不存在，请刷新页面。')
    return this.mapOrder(row)
  }
  private listOrders() { return this.all('SELECT * FROM orders ORDER BY started_at DESC, rowid DESC').map(row => this.mapOrder(row)) }
  private entries(profileId?: string, insertionOrder = false): BalanceEntry[] {
    return this.all(`SELECT * FROM balance_entries ${profileId ? 'WHERE profile_id = ?' : ''} ORDER BY ${insertionOrder ? 'rowid' : 'created_at DESC, rowid DESC'}`, ...(profileId ? [profileId] : [])).map(row => ({ id: String(row.entry_id), profileId: String(row.profile_id), bossId: String(row.boss_id_snapshot), nicknameSnapshot: String(row.nickname_snapshot), ...(row.order_id === null ? {} : { orderId: String(row.order_id), settledThroughSeconds: Number(row.settled_through_seconds) }), type: row.type as BalanceEntry['type'], deltaCents: Number(row.delta_cents), beforeCents: Number(row.before_cents), afterCents: Number(row.after_cents), createdAt: iso(row.created_at), notes: String(row.notes) }))
  }
  private mapTip(row: Row): Tip {
    return { id: String(row.tip_id), profileId: String(row.profile_id), bossIdSnapshot: String(row.boss_id_snapshot), nicknameSnapshot: String(row.nickname_snapshot), amountCents: Number(row.amount_cents), receivedAt: iso(row.received_at), notes: String(row.notes), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
  }
  private tips(profileId?: string) { return this.all(`SELECT * FROM tips ${profileId ? 'WHERE profile_id = ?' : ''} ORDER BY received_at DESC, rowid DESC`, ...(profileId ? [profileId] : [])).map(row => this.mapTip(row)) }
  private post(boss: Boss, type: BalanceEntry['type'], delta: number, notes: string, now: number, order?: Order, through?: number) {
    const after = safeInteger(boss.balanceCents + delta)
    this.run('INSERT INTO balance_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), boss.profileId!, boss.id, order?.nicknameSnapshot ?? boss.nickname, order?.id ?? null, type, delta, boss.balanceCents, after, through ?? null, now, notes)
    this.checkpoint('after-entry')
    this.run('UPDATE boss_profiles SET balance_cents = ? WHERE profile_id = ?', after, boss.profileId!)
    this.checkpoint('after-balance')
    return { ...boss, balanceCents: after }
  }
  private settleThrough(order: Order, seconds: number, now: number, final: boolean) {
    const row = this.get('SELECT * FROM boss_profiles WHERE profile_id = ?', order.profileId!)
    if (!row) throw new Error('订单关联的老板不存在，未执行扣费。')
    let boss = this.mapBoss(row)
    if (seconds < order.settledServiceSeconds) throw new Error('系统时间异常，服务时长早于已结算时长，未重复扣费。')
    const post = (through: number, note: string) => {
      const cumulative = chargeCents(order.hourlyRateCentsSnapshot, through)
      boss = this.post(boss, 'order_consumption', -(cumulative - order.settledAmountCents), `订单 ${order.id}，${note}`, now, order, through)
      this.run('UPDATE orders SET settled_service_seconds = ?, settled_amount_cents = ? WHERE order_id = ?', through, cumulative, order.id)
      this.checkpoint('after-settlement-progress')
      order.settledServiceSeconds = through; order.settledAmountCents = cumulative
    }
    if (final && (order.billingModel === 'on-completion' || seconds > order.settledServiceSeconds)) post(seconds, order.billingModel === 'on-completion' ? '结束订单一次性结算' : '旧订单结束补结算（抵扣已扣费用）')
    return boss.balanceCents
  }
  private start(bossId: string) {
    const boss = this.boss(bossId)
    const current = this.get("SELECT * FROM orders WHERE status <> 'completed'")
    if (current) throw new Error(`当前正在服务「${displayNickname(String(current.nickname_snapshot))}」（老板 ID：${current.boss_id_snapshot}），请先结束该订单。暂停中的订单也不能另开新单。`)
    if (boss.balanceCents <= 0) throw new Error('老板当前余额必须大于 0，请先充值。')
    if (boss.hourlyRateCents <= 0) throw new Error('老板当前单价必须大于 0，请先修改单价。')
    const id = randomUUID(), now = this.now()
    this.run("INSERT INTO orders (order_id, profile_id, boss_id_snapshot, nickname_snapshot, hourly_rate_cents_snapshot, started_at, ended_at, status, accumulated_ms, settled_service_seconds, settled_amount_cents, final_charge_cents, balance_at_end_cents, end_reason, created_at, billing_model) VALUES (?, ?, ?, ?, ?, ?, NULL, 'active', 0, 0, 0, NULL, NULL, NULL, ?, 'on-completion')", id, boss.profileId!, boss.id, boss.nickname, boss.hourlyRateCents, now, now)
    return this.order(id)
  }
  private transition(id: string, action: 'pause' | 'resume' | 'complete') {
    const order = this.order(id)
    if (order.status === 'completed') throw new Error('订单已结束，不能再修改。')
    if (action === 'pause' && order.status !== 'active') throw new Error('只有进行中的订单可以暂停。')
    if (action === 'resume' && order.status !== 'paused') throw new Error('只有暂停中的订单可以继续。')
    const now = this.now(), last = order.pauses.at(-1)
    if (now < (last?.endedAt ?? last?.startedAt ?? order.startedAt)) throw new Error('系统时间早于订单最近操作时间，请校正系统时间后重试。')
    const ms = safeInteger(serviceDurationMs(order, now))
    const balance = this.settleThrough(order, Math.floor(ms / 1000), now, action === 'complete')
    if (action === 'pause') this.run('INSERT INTO order_pauses VALUES (?, ?, ?, NULL)', id, order.pauses.length, now)
    else if (order.status === 'paused') this.run('UPDATE order_pauses SET ended_at = ? WHERE order_id = ? AND ended_at IS NULL', now, id)
    const status = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'completed'
    this.run('UPDATE orders SET status = ?, accumulated_ms = ?, ended_at = ?, final_charge_cents = ?, balance_at_end_cents = ?, end_reason = ? WHERE order_id = ?', status, ms, action === 'complete' ? now : null, action === 'complete' ? order.settledAmountCents : null, action === 'complete' ? balance : null, action === 'complete' ? '用户手动结束' : null, id)
    this.checkpoint('after-order-result')
    return this.order(id)
  }
  private dispatch(method: BusinessMethod, args: unknown[]): unknown {
    switch (method) {
      case 'bosses.list': return this.all('SELECT * FROM boss_profiles ORDER BY rowid').map(row => this.mapBoss(row))
      case 'bosses.create': {
        const input = args[0] as BossInput
        if (!input || typeof input.id !== 'string' || !input.id.trim()) throw new Error('老板 ID 不能为空，请输入自定义 ID。')
        const id = input.id.trim(), fields = validateBossFields(input)
        if (this.get('SELECT 1 FROM boss_profiles WHERE boss_id = ?', id)) throw new Error(`老板 ID「${id}」已存在，请使用其他 ID。`)
        const profileId = randomUUID(), now = this.now()
        this.run('INSERT INTO boss_identities VALUES (?, ?, ?)', profileId, id, now)
        this.run('INSERT INTO boss_profiles VALUES (?, ?, ?, ?, 0, ?, ?)', profileId, id, fields.nickname, fields.hourlyRateCents, now, fields.notes)
        return this.boss(id)
      }
      case 'bosses.update': {
        const boss = this.boss(identifier(args[0])), fields = validateBossFields(args[1] as BossChanges)
        this.run('UPDATE boss_profiles SET nickname = ?, hourly_rate_cents = ?, notes = ? WHERE profile_id = ?', fields.nickname, fields.hourlyRateCents, fields.notes, boss.profileId!)
        return this.boss(boss.id)
      }
      case 'bosses.remove': {
        const boss = this.boss(identifier(args[0]))
        if (this.get("SELECT 1 FROM orders WHERE profile_id = ? AND status <> 'completed'", boss.profileId!)) throw new Error('该老板当前存在进行中的订单，请先结束订单后再删除。')
        this.run('DELETE FROM boss_profiles WHERE profile_id = ?', boss.profileId!); return
      }
      case 'balances.entries': {
        const id = identifier(args[0]), row = this.get('SELECT profile_id FROM boss_profiles WHERE boss_id = ?', id)
        return row ? this.entries(String(row.profile_id)) : this.entries().filter(e => e.bossId === id)
      }
      case 'balances.changeBalance': {
        const boss = this.boss(identifier(args[0])), input = args[1] as BalanceInput
        if (!input || !['recharge', 'manual_add', 'manual_deduct'].includes(input.type)) throw new Error('请选择正确的余额流水类型。')
        if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error('金额必须大于 0，最多保留两位小数。')
        if (typeof input.notes !== 'string') throw new Error('请输入有效的备注。')
        const delta = input.type === 'manual_deduct' ? -input.amountCents : input.amountCents
        if (input.type === 'manual_deduct' && boss.balanceCents + delta < 0) throw new Error('余额不足，手动扣除金额不能超过当前余额。')
        return this.post(boss, input.type, delta, input.notes.trim(), this.now())
      }
      case 'balances.clearDebt': {
        const boss = this.boss(identifier(args[0]))
        if (boss.balanceCents >= 0) throw new Error('当前余额不为负数，无需清零。')
        const notes = args[1] ?? '用户确认清零负余额'
        if (typeof notes !== 'string') throw new Error('请输入有效的备注。')
        return this.post(boss, 'debt_clear', -boss.balanceCents, notes, this.now())
      }
      case 'orders.list': return this.listOrders()
      case 'orders.start': return this.start(identifier(args[0]))
      case 'orders.settle': return this.listOrders()
      case 'orders.pause': case 'pauses.pause': return this.transition(identifier(args[0]), 'pause')
      case 'orders.resume': case 'pauses.resume': return this.transition(identifier(args[0]), 'resume')
      case 'orders.complete': return this.transition(identifier(args[0]), 'complete')
      case 'pauses.list': return this.order(identifier(args[0])).pauses
      case 'tips.list': return this.tips(args[0] === undefined ? undefined : identifier(args[0]))
      case 'tips.create': {
        const profileId = identifier(args[0]), input = validateTipInput(args[1] as TipInput)
        const row = this.get('SELECT * FROM boss_profiles WHERE profile_id = ?', profileId)
        if (!row) throw new Error('该老板资料已删除或已变更，不能新增打赏，请重新选择老板。')
        const boss = this.mapBoss(row), id = randomUUID(), now = this.now()
        this.run('INSERT INTO tips VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, profileId, boss.id, boss.nickname, input.amountCents, Date.parse(input.receivedAt), input.notes, now, now)
        return this.mapTip(this.get('SELECT * FROM tips WHERE tip_id = ?', id)!)
      }
      case 'tips.update': {
        const id = identifier(args[0]), input = validateTipInput(args[1] as TipInput)
        if (!this.get('SELECT 1 FROM tips WHERE tip_id = ?', id)) throw new Error('该打赏记录已不存在，请刷新后重试。')
        this.run('UPDATE tips SET amount_cents = ?, received_at = ?, notes = ?, updated_at = ? WHERE tip_id = ?', input.amountCents, Date.parse(input.receivedAt), input.notes, this.now(), id)
        return this.mapTip(this.get('SELECT * FROM tips WHERE tip_id = ?', id)!)
      }
      case 'tips.remove': {
        const id = identifier(args[0])
        if (!this.get('SELECT 1 FROM tips WHERE tip_id = ?', id)) throw new Error('该打赏记录已不存在，请刷新后重试。')
        this.run('DELETE FROM tips WHERE tip_id = ?', id); return
      }
      case 'history.read': case 'statistics.read': return { orders: this.listOrders(), entries: this.entries(), tips: this.tips() }
      case 'development.clear': {
        // 保留 schema，不删除数据库文件，不触碰 localStorage。
        this.database.exec('DELETE FROM balance_entries; DELETE FROM tips; DELETE FROM order_pauses; DELETE FROM orders; DELETE FROM boss_profiles; DELETE FROM boss_identities; DELETE FROM import_batches;')
        return
      }
    }
  }
}
