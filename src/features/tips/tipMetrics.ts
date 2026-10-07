import type { Tip } from './types'
export function totalTipCents(tips: Tip[]) {
  const total = tips.reduce((sum, tip) => sum + BigInt(tip.amountCents), 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('累计打赏金额超出安全范围。')
  return Number(total)
}
