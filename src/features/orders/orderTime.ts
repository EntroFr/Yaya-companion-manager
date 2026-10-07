import type { Order } from './types'

export function serviceDurationMs(order: Order, now = Date.now()): number {
  const boundary = order.endedAt ?? (order.status === 'paused' ? order.pauses.at(-1)!.startedAt : now)
  const end = Math.max(order.startedAt, boundary)
  const pausedMs = order.pauses.reduce((total, pause) => total + Math.max(0, Math.min(end, pause.endedAt ?? end) - pause.startedAt), 0)
  return Math.max(0, end - order.startedAt - pausedMs)
}
export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(part => String(part).padStart(2, '0')).join(':')
}
