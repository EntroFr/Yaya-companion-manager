export interface Tip {
  readonly id: string
  readonly profileId: string
  readonly bossIdSnapshot: string
  readonly nicknameSnapshot: string
  amountCents: number
  receivedAt: string
  notes: string
  readonly createdAt: string
  updatedAt: string
}
export type TipInput = Pick<Tip, 'amountCents' | 'receivedAt' | 'notes'>
