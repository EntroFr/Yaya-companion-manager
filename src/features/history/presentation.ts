import type { BalanceType } from '../bosses/types'
export const balanceLabels: Record<BalanceType,string> = {recharge:'充值',manual_add:'手动调整（增加）',manual_deduct:'手动调整（扣除）',order_consumption:'订单消费',debt_clear:'欠费清零'}
export function historyDate(value: number|string = Date.now()) {
  const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
export function compactTime(value:number|string) {
  const d=new Date(value),p=(n:number)=>String(n).padStart(2,'0')
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
export function readableNotes(notes:string) {
  return notes.replace(/订单\s+[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}[，,：:\s]*/gi,'').replace(/结束订单.*一次性结算/,'结束订单，一次性结算') || '—'
}
export function recentRecords<T>(records:T[],expanded:boolean) {return expanded?records:records.slice(0,3)}
