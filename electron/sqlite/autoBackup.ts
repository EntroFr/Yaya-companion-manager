import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BackupManager } from './maintenance.ts'

interface RecordEntry { name: string; createdAt: string }
interface State { lastDate: string | null; lastSuccessAt: string | null; files: RecordEntry[] }
export interface AutoBackupInfo { enabled: boolean; lastSuccessAt: string | null; directory: string; retention: number; error: string | null }
const ownedName = /^yaya-diary-auto-\d{4}-\d{2}-\d{2}-\d{6}-[\w-]+\.db$/
export function localBackupDate(now: Date) {
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
}
export class AutoBackupManager {
  private state: State = { lastDate:null, lastSuccessAt:null, files:[] }
  private error: string | null = null
  private readonly file: string
  private readonly directory: string
  private readonly mode: string
  private readonly backupManager: Pick<BackupManager,'backup'>
  private readonly clock: () => Date
  private readonly log: (message: string) => void
  constructor(manager: Pick<BackupManager,'backup'>, root: string, mode: string, clock: () => Date = () => new Date(), log: (message:string)=>void = console.warn) {
    this.backupManager=manager;this.directory=join(root,'backups','auto');this.file=join(this.directory,'auto-backup-state.json');this.mode=mode;this.clock=clock;this.log=log
  }
  info(): AutoBackupInfo { return {enabled:this.mode==='sqlite',lastSuccessAt:this.state.lastSuccessAt,directory:this.directory,retention:7,error:this.error} }
  private save() {
    const temporary=this.file+'.new'
    writeFileSync(temporary,JSON.stringify(this.state),'utf8');renameSync(temporary,this.file)
  }
  private load() {
    if(!existsSync(this.file))return
    const value=JSON.parse(readFileSync(this.file,'utf8')) as State
    if(!Array.isArray(value.files) || !value.files.every(e=>typeof e.name==='string' && ownedName.test(e.name) && Number.isFinite(Date.parse(e.createdAt))) || (value.lastDate!==null && !/^\d{4}-\d{2}-\d{2}$/.test(value.lastDate)) || (value.lastSuccessAt!==null && !Number.isFinite(Date.parse(value.lastSuccessAt)))) throw Error('自动备份配置无效，未删除任何备份。')
    this.state=value
  }
  private prune() {
    this.state.files=this.state.files.filter(e=>existsSync(join(this.directory,e.name))).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))
    // 仅删除本服务清单内登记的自动备份，不扫描或删除用户手动备份。
    while(this.state.files.length>7) {
      const old=this.state.files.at(-1)!
      unlinkSync(join(this.directory,old.name));this.state.files.pop()
    }
    this.save()
  }
  async run(): Promise<AutoBackupInfo> {
    if(this.mode!=='sqlite')return this.info()
    try {
      this.load()
      const now=this.clock(),date=localBackupDate(now)
      mkdirSync(this.directory,{recursive:true})
      if(this.state.lastDate!==date) {
        const time=[now.getHours(),now.getMinutes(),now.getSeconds()].map(n=>String(n).padStart(2,'0')).join('')
        const name=`yaya-diary-auto-${date}-${time}-${randomUUID()}.db`
        await this.backupManager.backup(join(this.directory,name))
        const previous=this.state
        this.state={lastDate:date,lastSuccessAt:now.toISOString(),files:[...this.state.files,{name,createdAt:now.toISOString()}]}
        try { this.save() } // 仅在在线备份完成并校验通过后记录成功日期。
        catch(error) {
          this.state=previous
          // 配置无法提交时，只清理本次刚生成的文件，避免留下未登记副本。
          try { unlinkSync(join(this.directory,name)) } catch { /* 保留文件优先于阻止启动。 */ }
          throw error
        }
      }
      this.prune();this.error=null
    } catch(error) {
      this.error=`每日自动备份失败：${error instanceof Error?error.message:'未知错误'}。应用仍可正常使用，下次启动将重试。`
      try { this.log(this.error) } catch { /* 日志失败也不能阻止启动。 */ }
    }
    return this.info()
  }
}
