import type { HistoryData } from './contracts'
export function formalData(data: HistoryData): HistoryData {
  return { orders: data.orders.filter(r => !r.isTestMode), entries: data.entries.filter(r => !r.isTestMode), tips: data.tips.filter(r => !r.isTestMode) }
}
