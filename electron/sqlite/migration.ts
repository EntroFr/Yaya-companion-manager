import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync, linkSync, unlinkSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { SQLiteService } from './service.ts'
import { parseMigration, fingerprintPayload, normalizeStore, canonicalJSON, canonicalStore, summarize } from '../../src/features/migration/format.ts'
import type { MigrationFile, MigrationReport, StorageMode } from '../../src/features/migration/format'

export const MIGRATION_METHODS = ['migration.status', 'migration.exportData', 'migration.prepare', 'migration.activate', 'migration.discard'] as const
type Candidate = { path: string; file: MigrationFile; report: MigrationReport }

export function verifiedFile(text: string) {
  const file = parseMigration(text)
  const fingerprint = createHash('sha256').update(fingerprintPayload(file)).digest('hex')
  if (fingerprint !== file.fingerprint) throw new Error('迁移文件指纹不一致，文件可能被修改，已拒绝导入。')
  return file
}
export function reconcile(file: MigrationFile, service: SQLiteService): MigrationReport {
  const afterData = normalizeStore(service.snapshot(), file.capturedAt)
  const before = summarize(file.data, file.capturedAt), after = summarize(afterData, file.capturedAt)
  const differences: string[] = []
  for (const key of Object.keys(before) as (keyof typeof before)[]) if (canonicalJSON(before[key]) !== canonicalJSON(after[key])) differences.push(`对账项不一致：${key}`)
  if (canonicalJSON(canonicalStore(file.data)) !== canonicalJSON(canonicalStore(afterData))) differences.push('原始业务记录、ID、快照或时间不一致')
  if (service.database.prepare('SELECT count(*) AS n FROM boss_identities').get()!.n !== before.identities) differences.push('永久身份数量不一致')
  if (service.database.prepare('PRAGMA foreign_key_check').all().length || service.database.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok') differences.push('数据库完整性检查失败')
  return { token: '', fingerprint: file.fingerprint, comparedAt: file.capturedAt, passed: differences.length === 0, before, after, differences, warnings: file.data.orders.some(o => o.status !== 'completed') ? ['包含进行中或暂停订单。启用后 active 订单会按实际时间补齐新的结算点，暂停订单不会继续计时。建议没有进行中订单时迁移。'] : [] }
}
// 复制状态而非调用充值/扣费/打赏业务；全量导入只用于全新的空临时库。
export function importState(service: SQLiteService, file: MigrationFile, checkpoint: (stage: string) => void = () => {}) {
  const db = service.database
  db.exec('BEGIN IMMEDIATE')
  try {
    if (db.prepare('SELECT 1 FROM import_batches WHERE source_digest = ?').get(file.fingerprint)) throw new Error('同一个迁移文件已导入该数据库，不能重复导入。')
    if (['boss_identities','boss_profiles','orders','balance_entries','tips','import_batches'].some(table => db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())) throw new Error('目标库不是空临时库，已拒绝覆盖或合并。')
    const store = file.data, identities = new Map<string, { id: string; time: number }>()
    const identity = (profileId: string, id: string, time: number) => { const old = identities.get(profileId); if (!old || time < old.time) identities.set(profileId, { id, time }) }
    for (const b of store.bosses) identity(b.profileId!, b.id, Date.parse(b.createdAt))
    for (const o of store.orders) identity(o.profileId!, o.bossId, o.createdAt)
    for (const e of store.entries) identity(e.profileId!, e.bossId, Date.parse(e.createdAt))
    for (const t of store.tips) identity(t.profileId, t.bossIdSnapshot, Date.parse(t.createdAt))
    const insertIdentity = db.prepare('INSERT INTO boss_identities VALUES (?, ?, ?)')
    for (const [id, value] of identities) insertIdentity.run(id, value.id, value.time)
    const insertBoss = db.prepare('INSERT INTO boss_profiles VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const b of store.bosses) insertBoss.run(b.profileId!, b.id, b.nickname, b.hourlyRateCents, b.balanceCents, Date.parse(b.createdAt), b.notes)
    checkpoint('after-profiles')
    const insertOrder = db.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const insertPause = db.prepare('INSERT INTO order_pauses VALUES (?, ?, ?, ?)')
    for (const o of store.orders) {
      insertOrder.run(o.id, o.profileId!, o.bossId, o.nicknameSnapshot, o.hourlyRateCentsSnapshot, o.startedAt, o.endedAt, o.status, o.accumulatedMs, o.settledServiceSeconds, o.settledAmountCents, o.finalChargeCents, o.balanceAtEndCents, o.endReason, o.createdAt, o.legacyUnbilled ? 1 : 0, o.billingModel ?? 'legacy-periodic')
      o.pauses.forEach((p, sequence) => insertPause.run(o.id, sequence, p.startedAt, p.endedAt))
    }
    checkpoint('after-orders')
    const insertEntry = db.prepare('INSERT INTO balance_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const e of store.entries) insertEntry.run(e.id, e.profileId!, e.bossId, e.nicknameSnapshot!, e.orderId ?? null, e.type, e.deltaCents, e.beforeCents, e.afterCents, e.settledThroughSeconds ?? null, Date.parse(e.createdAt), e.notes)
    checkpoint('after-entries')
    const insertTip = db.prepare('INSERT INTO tips VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const t of store.tips) insertTip.run(t.id, t.profileId, t.bossIdSnapshot, t.nicknameSnapshot, t.amountCents, Date.parse(t.receivedAt), t.notes, Date.parse(t.createdAt), Date.parse(t.updatedAt))
    checkpoint('after-tips')
    db.prepare('INSERT INTO import_batches (batch_id,source_digest,source_version,imported_at,notes,source_document) VALUES (?,?,?,?,?,?)').run(randomUUID(), file.fingerprint, file.formatVersion, Date.now(), JSON.stringify({ verified: false }), JSON.stringify(file))
    checkpoint('before-import-commit')
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('导入外键校验失败。')
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
export function openFormalDatabase(file: string, create = false) {
  if (!existsSync(file) && create) {
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.${randomUUID()}.initial`
    const empty = new SQLiteService(temporary)
    try { empty.database.prepare('INSERT INTO app_metadata VALUES (?,?)').run('origin', 'native'); empty.database.exec('PRAGMA wal_checkpoint(TRUNCATE)') } finally { empty.close() }
    try { linkSync(temporary, file) } finally { unlinkSync(temporary) }
  }
  if (!existsSync(file)) throw new Error('正式数据库尚未启用，请先在 SQLite 测试模式导入并完成对账。')
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const rows = db.prepare('SELECT notes FROM import_batches').all()
    const native = db.prepare("SELECT 1 FROM sqlite_master WHERE name='app_metadata'").get() && db.prepare("SELECT 1 FROM app_metadata WHERE key='origin' AND value='native'").get()
    if ((!native && (rows.length !== 1 || JSON.parse(String(rows[0].notes)).verified !== true)) || db.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok') throw new Error('正式数据库没有通过迁移验收，已停止打开。')
  } finally { db.close() }
  return new SQLiteService(file)
}
export class MigrationManager {
  private readonly replaceEmpty?: (candidate: string) => void
  private readonly staging: string
  readonly formalFile: string
  private readonly mode: StorageMode
  private readonly candidates = new Map<string, Candidate>()
  private readonly checkpoint: (stage: string) => void
  constructor(userData: string, formalFile: string, mode: StorageMode, checkpoint: (stage: string) => void = () => {}, replaceEmpty?: (candidate: string) => void) {
    this.replaceEmpty = replaceEmpty
    this.staging = join(userData, 'migration-staging'); this.formalFile = formalFile; this.mode = mode; this.checkpoint = checkpoint
  }
  private duplicate(digest: string) {
    if (!existsSync(this.formalFile)) return false
    const db = new DatabaseSync(this.formalFile, { readOnly: true })
    try { return !!db.prepare('SELECT 1 FROM import_batches WHERE source_digest = ?').get(digest) } finally { db.close() }
  }
  private pristine() {
    if (!this.replaceEmpty || !existsSync(this.formalFile)) return false
    const db = new DatabaseSync(this.formalFile, { readOnly: true })
    try { return !!db.prepare("SELECT 1 FROM app_metadata WHERE key='origin' AND value='native'").get() && ['boss_identities','boss_profiles','orders','balance_entries','tips','import_batches'].every(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n === 0) } finally { db.close() }
  }
  status() { return { mode: this.mode, formalAvailable: existsSync(this.formalFile) && !this.pristine(), pending: [...this.candidates.values()][0]?.report } }
  prepare(text: string): MigrationReport {
    const file = verifiedFile(text)
    if (this.duplicate(file.fingerprint) || [...this.candidates.values()].some(c => c.file.fingerprint === file.fingerprint)) throw new Error('该迁移文件已经导入或待验收，请勿重复导入。')
    if (this.candidates.size) throw new Error('已有待验收迁移，请先取消或启用，再选择其他文件。')
    if (existsSync(this.formalFile) && !this.pristine()) throw new Error('已有正式数据库，不能通过迁移覆盖。请继续使用现有正式库。')
    mkdirSync(this.staging, { recursive: true })
    const token = randomUUID(), path = join(this.staging, `${token}.db`)
    let service: SQLiteService | undefined
    try {
      service = new SQLiteService(path); importState(service, file, this.checkpoint)
      const report = { ...reconcile(file, service), token }
      if (!report.passed) throw new Error(`迁移对账失败：${report.differences.join('；')}。不能启用正式库。`)
      service.database.prepare('UPDATE import_batches SET notes = ? WHERE source_digest = ?').run(JSON.stringify({ verified: true, report }), file.fingerprint)
      service.database.exec('PRAGMA wal_checkpoint(TRUNCATE)'); service.close(); service = undefined
      this.candidates.set(token, { path, file, report }); return report
    } catch (error) {
      service?.close(); this.removeCandidateFiles(path)
      throw new Error(`导入失败：${error instanceof Error ? error.message : '临时数据库保存失败'} 原 localStorage、测试库和正式库未改动。`)
    }
  }
  activate(token: string) {
    const candidate = this.candidates.get(token)
    if (!candidate) throw new Error('待验收迁移已失效，请重新导入。')
    if (existsSync(this.formalFile) && !this.pristine()) throw new Error(this.duplicate(candidate.file.fingerprint) ? '该文件已导入正式库，不能重复导入。' : '正式数据库已存在，禁止覆盖。')
    const service = new SQLiteService(candidate.path)
    try {
      const batch = service.database.prepare('SELECT source_digest, notes, source_document FROM import_batches').all()
      if (batch.length !== 1 || batch[0].source_digest !== candidate.file.fingerprint || JSON.parse(String(batch[0].notes)).verified !== true || verifiedFile(String(batch[0].source_document)).fingerprint !== candidate.file.fingerprint) throw new Error('临时库迁移批次记录不一致，禁止启用。')
      const report = reconcile(candidate.file, service)
      if (!report.passed) throw new Error('临时库对账已变化，禁止启用。')
      service.database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } finally { service.close() }
    // 关闭WAL连接后先刷盘；同卷硬链接原子发布，目标存在时失败，绝不覆盖。
    const handle = openSync(candidate.path, 'r+')
    try { fsyncSync(handle) } finally { closeSync(handle) }
    mkdirSync(dirname(this.formalFile), { recursive: true })
    this.checkpoint('before-activate')
    if (existsSync(this.formalFile)) this.replaceEmpty!(candidate.path)
    else linkSync(candidate.path, this.formalFile)
    this.candidates.delete(token)
    // 已成功发布的正式库独立保留，清理仅针对已拥有的临时路径。
    try { this.removeCandidateFiles(candidate.path) } catch (error) { console.warn('正式库已启用，临时文件清理未完成：', error) }
  }
  discard(token: string) {
    const candidate = this.candidates.get(token)
    if (!candidate) throw new Error('待验收迁移已不存在。')
    this.removeCandidateFiles(candidate.path); this.candidates.delete(token)
  }
  private removeCandidateFiles(path: string) { for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) unlinkSync(path + suffix) }
  dispose() { for (const token of [...this.candidates.keys()]) this.discard(token) }
}
export class DesktopDataService {
  service: SQLiteService
  readonly migration: MigrationManager
  lastChanged = false
  constructor(service: SQLiteService, migration: MigrationManager) { this.service = service; this.migration = migration }
  execute(method: string, args: unknown[]) {
    this.lastChanged = false
    if (method === 'development.clear' && this.migration.status().mode === 'sqlite') throw new Error('正式数据源不提供清除测试数据功能。')
    if (method === 'migration.status') return this.migration.status()
    if (method === 'migration.exportData') throw new Error('请从原 localStorage 模式导出迁移文件。')
    if (method === 'migration.prepare') return this.migration.prepare(args[0] as string)
    if (method === 'migration.activate') { const result = this.migration.activate(args[0] as string); this.lastChanged = true; return result }
    if (method === 'migration.discard') return this.migration.discard(args[0] as string)
    const result = this.service.execute(method as Parameters<SQLiteService['execute']>[0], args)
    this.lastChanged = this.service.lastChanged; return result
  }
}
