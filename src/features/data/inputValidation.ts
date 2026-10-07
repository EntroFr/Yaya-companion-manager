import type { BossChanges } from '../bosses/types'
import type { TipInput } from '../tips/types'

export function validateBossFields(input: BossChanges): BossChanges {
  if (!input || typeof input.nickname !== 'string' || typeof input.notes !== 'string') throw new Error('请输入有效的昵称和备注。')
  if (!Number.isSafeInteger(input.hourlyRateCents) || input.hourlyRateCents < 0 || input.hourlyRateCents > 100000000) throw new Error('单价必须为 0 至 1,000,000 元之间的数字，最多保留两位小数。')
  return { nickname: input.nickname.trim(), hourlyRateCents: input.hourlyRateCents, notes: input.notes.trim() }
}
export function validateTipInput(input: TipInput): TipInput {
  if (!input || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error('打赏金额必须大于 ¥0.00，最多保留两位小数。')
  if (typeof input.receivedAt !== 'string' || !input.receivedAt.trim() || !Number.isFinite(Date.parse(input.receivedAt))) throw new Error('请输入有效的打赏发生时间。')
  if (typeof input.notes !== 'string') throw new Error('请输入有效的备注。')
  return { amountCents: input.amountCents, receivedAt: new Date(input.receivedAt).toISOString(), notes: input.notes.trim() }
}
