export interface BalanceAlertState {
  orderId: string
  positive: boolean
  aboveFiveMinutes: boolean
  status: string
}
export function remainingServiceSeconds(balanceCents: number, rateCents: number) {
  return rateCents > 0 ? Math.max(0, balanceCents / rateCents * 3600) : 0
}
// 首次读取只建立基准；暂停时静默更新基准，恢复时不补播暂停期间的跨越。
export function updateBalanceAlert(previous: BalanceAlertState | null, orderId: string | null, balanceCents: number, rateCents = 3500, status = 'active', soundEnabled = true) {
  if (!orderId) return { state: null, alert: false, warning: false }
  const positive = balanceCents > 0
  const aboveFiveMinutes = remainingServiceSeconds(balanceCents, rateCents) > 300
  const canAlert = soundEnabled && previous?.orderId === orderId && previous.status === 'active' && status === 'active'
  return {
    state: { orderId, positive, aboveFiveMinutes, status },
    alert: Boolean(canAlert && previous.positive && !positive),
    warning: Boolean(canAlert && previous.aboveFiveMinutes && !aboveFiveMinutes && positive),
  }
}
export function formatRemainingServiceTime(seconds: number) {
  const total = Math.ceil(seconds)
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60)
  return `${hours ? `${hours}小时` : ''}${minutes}分${total % 60}秒`
}
