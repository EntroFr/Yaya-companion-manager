export interface BalanceAlertState { orderId: string; positive: boolean }
// 首次恢复负余额仅显示提示；不把恢复本身当作新的余额跨越。
export function updateBalanceAlert(previous: BalanceAlertState | null, orderId: string | null, balanceCents: number) {
  if (!orderId) return { state: null, alert: false }
  return { state: { orderId, positive: balanceCents > 0 }, alert: previous?.orderId === orderId && previous.positive && balanceCents <= 0 }
}
