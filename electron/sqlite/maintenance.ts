import { DatabaseSync, backup } from 'node:sqlite'
import { mkdirSync, existsSync, statSync, renameSync, unlinkSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync, copyFileSync, constants } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { SQLiteService } from './service.ts'
import { migrations } from './schema.ts'
import { normalizeStore } from '../../src/features/migration/format.ts'

export const MANAGEMENT_METHODS = ['management.info', 'management.backup', 'management.inspectRestore', 'management.restore', 'management.cancelRestore', 'management.openFolder', 'management.openExports']
export interface DatabaseInfo {
  name: string; appVersion: string; schemaVersion: number; path: string; size: number
  bosses: number; orders: number; entries: number; tips: number; active: number; paused: number
}
export interface BackupInfo extends DatabaseInfo { createdAt: string }
export interface RestorePreview extends BackupInfo { token: string; sourcePath: string }
type Session = { service: SQLiteService }
function flush(path: string) { const fd = openSync(path, 'r+'); try { fsyncSync(fd) } finally { closeSync(fd) } }
function removeOwned(path: string) { for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) unlinkSync(path + suffix) }
export function backupName(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `yaya-backup-${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.db`
}
function validateDatabase(db: DatabaseSync, strict = false) {
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON')
  if (db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok')) throw new Error('数据库完整性检查失败，文件可能已损坏。')
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('数据库外键检查失败。')
  const versions = db.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all()
  if (!versions.length || versions.some((r,i) => r.version !== i+1 || migrations[i]?.version !== r.version || migrations[i]?.name !== r.name)) throw new Error('数据库 schema 版本不兼容，请使用匹配版本的应用。')
  // 备份仅接受本应用正式库，不接受任意结构相似的测试数据库。
  const native = db.prepare("SELECT 1 FROM sqlite_master WHERE name='app_metadata'").get() && db.prepare("SELECT 1 FROM app_metadata WHERE key='origin' AND value='native'").get()
  const batches = db.prepare('SELECT notes FROM import_batches').all()
  if (!native && !(batches.length === 1 && JSON.parse(String(batches[0].notes)).verified === true)) throw new Error('该文件不是经过验收的正式数据库。')
  if(strict) {
    const baseline=new SQLiteService(':memory:')
    const sql="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
    try { if(JSON.stringify(db.prepare(sql).all())!==JSON.stringify(baseline.database.prepare(sql).all()))throw new Error('数据库结构与本应用不一致，拒绝恢复未知表或触发器。') } finally { baseline.close() }
  }
}
export class BackupManager {
  private readonly session: Session
  readonly file: string
  private readonly directory: string
  private readonly version: string
  private readonly checkpoint: (stage: string) => void
  private pending?: { path: string; digest: string; preview: RestorePreview }
  constructor(session: Session, file: string, directory: string, version: string, checkpoint: (stage: string) => void = () => {}) {
    this.session = session; this.file = resolve(file); this.directory = resolve(directory); this.version = version; this.checkpoint = checkpoint
  }
  info(path = this.file, service = this.session.service): DatabaseInfo {
    const store = normalizeStore(service.snapshot(), Date.now())
    return { name: 'Yaya的陪玩日记', appVersion: this.version, schemaVersion: migrations.at(-1)!.version, path, size: statSync(path).size,
      bosses: store.bosses.length, orders: store.orders.length, entries: store.entries.length, tips: store.tips.length,
      active: store.orders.filter(o=>o.status==='active').length, paused: store.orders.filter(o=>o.status==='paused').length }
  }
  private assertIdle() {
    if (this.session.service.snapshot().orders.some(o=>o.status!=='completed')) throw new Error('当前存在进行中的订单，请先结束或处理订单后再恢复备份。')
  }
  async backup(destination: string): Promise<BackupInfo> {
    const target = resolve(destination)
    if (target === this.file || target === this.file+'-wal' || target === this.file+'-shm' || existsSync(target)) throw new Error('备份目标已存在或正在使用，请选择新的文件名。')
    const temporary = join(dirname(target), `.${randomUUID()}.backup`)
    try {
      await backup(this.session.service.database, temporary)
      const copy = new DatabaseSync(temporary, { readOnly: true })
      try { validateDatabase(copy,true) } finally { copy.close() }
      flush(temporary)
      // 独占发布，不会覆盖任何现有文件。
      // 复制的是已完成的独立快照，兼容 USB / exFAT；从不复制正在写入的主库。
      copyFileSync(temporary, target, constants.COPYFILE_EXCL); flush(target)
      return { ...this.info(target), size: statSync(target).size, createdAt: new Date().toISOString() }
    } finally { removeOwned(temporary) }
  }
  async inspect(source: string): Promise<RestorePreview> {
    this.assertIdle(); this.cancel()
    mkdirSync(join(this.directory,'restore-staging'), { recursive: true })
    const path = join(this.directory,'restore-staging',`${randomUUID()}.db`)
    let original: DatabaseSync | undefined, service: SQLiteService | undefined
    try {
      if (readFileSync(source).subarray(0,16).toString('binary') !== 'SQLite format 3\0') throw new Error('所选文件不是有效 SQLite 数据库。')
      original = new DatabaseSync(source, { readOnly: true }); validateDatabase(original)
      await backup(original,path); original.close(); original=undefined
      // 旧版本只能在临时副本上升级，源备份完全不变。
      service = new SQLiteService(path); validateDatabase(service.database,true)
      const preview = { ...this.info(path,service), token: randomUUID(), sourcePath: source, createdAt: new Date().toISOString() }
      service.database.exec('PRAGMA wal_checkpoint(TRUNCATE)'); service.close(); service=undefined
      this.pending = { path, digest: createHash('sha256').update(readFileSync(path)).digest('hex'), preview }
      return preview
    } catch (error) { service?.close(); original?.close(); removeOwned(path); throw new Error(`恢复校验失败：${error instanceof Error ? error.message : '无法读取文件'} 当前资料未改变。`) }
  }
  async restore(token: string) {
    this.assertIdle()
    const candidate = this.pending
    if (!candidate || candidate.preview.token !== token) throw new Error('恢复预览已失效，请重新选择备份。')
    if (createHash('sha256').update(readFileSync(candidate.path)).digest('hex') !== candidate.digest) throw new Error('临时备份发生变化，已拒绝恢复。')
    mkdirSync(join(this.directory,'backups'), { recursive: true })
    const protectedBackup = await this.backup(join(this.directory,'backups',`before-restore-${Date.now()}-${randomUUID()}.db`))
    this.checkpoint('after-backup')
    const result = this.replace(candidate.path)
    this.pending=undefined
    return { ...result, protectedBackup }
  }
  // 只接收 Main 内部校验过的副本；也用于首次旧数据迁移替换空正式库。
  replace(candidate: string) {
    const journal = join(this.directory,'restore-journal.json')
    const rollback = join(this.directory,'backups',`rollback-${randomUUID()}.db`)
    mkdirSync(dirname(rollback), { recursive: true })
    this.session.service.database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    this.session.service.close()
    let replacement: SQLiteService | undefined
    try {
      writeFileSync(journal+'.new',JSON.stringify({ target:this.file, original:rollback }),'utf8'); flush(journal+'.new'); renameSync(journal+'.new',journal)
      this.checkpoint('after-close')
      renameSync(this.file,rollback); this.checkpoint('after-old-move')
      renameSync(candidate,this.file); this.checkpoint('after-new-move')
      replacement = new SQLiteService(this.file); validateDatabase(replacement.database,true)
      normalizeStore(replacement.snapshot(), Date.now()); this.checkpoint('after-open')
      this.session.service = replacement; replacement=undefined
      unlinkSync(journal)
      return this.info()
    } catch(error) {
      replacement?.close()
      if (existsSync(rollback)) { removeOwned(this.file); renameSync(rollback,this.file) }
      this.session.service = new SQLiteService(this.file)
      if (existsSync(journal)) unlinkSync(journal)
      throw new Error(`恢复失败，已恢复原数据库：${error instanceof Error ? error.message : '文件切换失败'}`)
    }
  }
  cancel() { if(this.pending) { removeOwned(this.pending.path); this.pending=undefined } }
  dispose() { this.cancel() }
}
// 断电发生在文件切换途中时，下一次启动优先恢复已关闭、已刷盘的原库。
export function recoverInterruptedRestore(file: string, directory: string) {
  const journal = join(directory,'restore-journal.json')
  if (!existsSync(journal)) return
  const record = JSON.parse(readFileSync(journal,'utf8')) as { target:string; original:string }
  if (resolve(record.target)!==resolve(file) || dirname(resolve(record.original))!==resolve(directory,'backups') || !/^rollback-[\w-]+\.db$/.test(record.original.split(/[\\/]/).at(-1)!)) throw new Error('恢复保护记录不合法，已停止启动。')
  if(existsSync(record.original)) { removeOwned(file); renameSync(record.original,file) }
  if(!existsSync(file)) throw new Error('恢复保护未找到原数据库，请保留数据目录并联系维护人员。')
  unlinkSync(journal)
}
