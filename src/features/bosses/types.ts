export interface Boss {
  isTestMode?: boolean
  readonly profileId?: string
  readonly id: string
  nickname: string
  hourlyRateCents: number
  readonly balanceCents: number
  readonly createdAt: string
  notes: string
}
export type BossInput = Pick<Boss, 'id' | 'nickname' | 'hourlyRateCents' | 'notes' | 'isTestMode'>
export type BossChanges = Omit<BossInput, 'id'>
export type BalanceType = 'recharge' | 'manual_add' | 'manual_deduct' | 'order_consumption' | 'debt_clear'
export interface BalanceEntry {
  isTestMode?: boolean
  readonly id: string
  readonly profileId?: string
  readonly nicknameSnapshot?: string
  readonly bossId: string
  readonly orderId?: string
  readonly settledThroughSeconds?: number
  readonly type: BalanceType
  readonly deltaCents: number
  readonly beforeCents: number
  readonly afterCents: number
  readonly createdAt: string
  readonly notes: string
}
export interface BalanceInput {
  type: BalanceType
  amountCents: number
  notes: string
}
export interface BossRepository {
  modeLocked(id: string): Promise<boolean>
  list(): Promise<Boss[]>
  create(input: BossInput): Promise<Boss>
  update(id: string, changes: BossChanges): Promise<Boss>
  remove(id: string): Promise<void>
  entries(bossId: string): Promise<BalanceEntry[]>
  clearDebt(bossId: string, notes?: string): Promise<Boss>
  changeBalance(bossId: string, input: BalanceInput): Promise<Boss>
}

