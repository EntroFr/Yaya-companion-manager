import type { Boss, BossInput, BossChanges, BalanceInput, BalanceEntry } from '../bosses/types'
import type { Order, OrderRepository, PauseRecord } from '../orders/types'
import type { Tip, TipInput } from '../tips/types'
import type { MigrationAccess } from '../migration/format'
export interface DatabaseInfo {
  dailyExport?: {enabled:boolean;directory:string;lastSuccessAt:string|null;error:string|null}
  autoBackup?: { enabled: boolean; lastSuccessAt: string | null; directory: string; retention: number; error: string | null }
  name: string; appVersion: string; schemaVersion: number; path: string; size: number
  bosses: number; orders: number; entries: number; tips: number; active: number; paused: number; packaged?: boolean
}
export interface BackupInfo extends DatabaseInfo { createdAt: string }
export interface RestorePreview extends BackupInfo { token: string; sourcePath: string }
export interface ManagementAccess {
  info(): Promise<DatabaseInfo>
  backup(): Promise<BackupInfo | null>
  inspectRestore(): Promise<RestorePreview | null>
  restore(token: string): Promise<DatabaseInfo & { protectedBackup: BackupInfo }>
  cancelRestore(): Promise<void>
  openFolder(): Promise<void>
  openExports(): Promise<void>
}

export interface BossProfileRepository {
  modeLocked(id: string): Promise<boolean>
  list(): Promise<Boss[]>
  create(input: BossInput): Promise<Boss>
  update(id: string, changes: BossChanges): Promise<Boss>
  remove(id: string): Promise<void>
}
export interface BalanceRepository {
  entries(bossId: string): Promise<BalanceEntry[]>
  changeBalance(bossId: string, input: BalanceInput): Promise<Boss>
  clearDebt(bossId: string, notes?: string): Promise<Boss>
}
export interface PauseRepository {
  list(orderId: string): Promise<PauseRecord[]>
  // 暂停与继续通过订单事务执行，不能单独改暂停记录。
  pause(orderId: string): Promise<Order>
  resume(orderId: string): Promise<Order>
}
export interface TipRepository {
  list(profileId?: string): Promise<Tip[]>
  create(profileId: string, input: TipInput): Promise<Tip>
  update(id: string, input: TipInput): Promise<Tip>
  remove(id: string): Promise<void>
}
export interface HistoryData { orders: Order[]; entries: BalanceEntry[]; tips: Tip[] }
export interface HistoryRepository { read(): Promise<HistoryData> }
export interface StatisticsDataRepository { read(): Promise<HistoryData> }
export interface DataChanges { subscribe(listener: () => void): () => void }
export interface DevelopmentDataService { clear(): Promise<void> }
export interface DataAccess {
  bosses: BossProfileRepository
  balances: BalanceRepository
  orders: OrderRepository
  pauses: PauseRepository
  tips: TipRepository
  history: HistoryRepository
  statistics: StatisticsDataRepository
  changes: DataChanges
  testing: { clear(): Promise<void> }
  development: DevelopmentDataService
  migration: MigrationAccess
  management: ManagementAccess
}
