// 从输入文本直接转换为整数分，不使用浮点乘法处理用户输入。
export function parseMoney(text: string): number {
  const value = text.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('金额必须为非负数字，最多保留两位小数。')
  const [whole, fraction = ''] = value.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) throw new Error('金额过大，请输入较小的金额。')
  return cents
}
export function moneyInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}
export function formatMoney(cents: number): string {
  return `${cents < 0 ? '-' : ''}¥${moneyInput(Math.abs(cents))}`
}
export function remainingServiceTime(balanceCents: number, hourlyRateCents: number): string {
  if (hourlyRateCents === 0) return '单价为零，无法换算'
  if (balanceCents <= 0) return '余额已耗尽'
  return `约 ${(balanceCents / hourlyRateCents).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 小时`
}

