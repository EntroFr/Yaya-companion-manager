import { useEffect, useRef } from 'react'
import { updateBalanceAlert } from './balanceAlert'
import type { BalanceAlertState } from './balanceAlert'
import { playLocalAlert } from './localAlertAudio'
export function useBalanceAlert(orderId: string | null, balanceCents: number, rateCents: number, status: string) {
  const state = useRef<BalanceAlertState | null>(null)
  useEffect(() => {
    const result = updateBalanceAlert(state.current, orderId, balanceCents, rateCents, status)
    // 先推进状态；播放失败不会每秒重试，也不会影响业务。
    state.current = result.state
    if (result.warning) void playLocalAlert(`${import.meta.env.BASE_URL}sounds/balance-warning-5min.m4a`)
    if (result.alert) void playLocalAlert(`${import.meta.env.BASE_URL}sounds/balance-depleted.m4a`)
  }, [orderId, balanceCents, rateCents, status])
}
