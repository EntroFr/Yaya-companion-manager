export type OrderStatus = 'active' | 'paused' | 'completed'
export interface PauseRecord { startedAt: number; endedAt: number | null }
export interface Order {
  isTestMode?: boolean
  readonly id: string
  readonly profileId?: string
  readonly bossId: string
  readonly nicknameSnapshot: string
  readonly hourlyRateCentsSnapshot: number
  readonly startedAt: number
  endedAt: number | null
  status: OrderStatus
  // 最近一次暂停、继续或结束时的有效时长快照；活动时长由时间戳实时计算。
  accumulatedMs: number
  pauses: PauseRecord[]
  settledServiceSeconds: number
  settledAmountCents: number
  finalChargeCents: number | null
  balanceAtEndCents: number | null
  endReason: string | null
  legacyUnbilled?: boolean
  // 缺省表示 1.0.0 的旧订单；保留已结算进度，只补收差额。
  readonly billingModel?: 'on-completion'
  readonly createdAt: number
}
export interface OrderRepository {
  list(): Promise<Order[]>
  settle(): Promise<Order[]>
  start(bossId: string): Promise<Order>
  pause(id: string): Promise<Order>
  resume(id: string): Promise<Order>
  complete(id: string): Promise<Order>
}

