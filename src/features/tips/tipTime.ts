// datetime-local 显示电脑本地时间；保存时转换为带时区的 ISO 时间。
export function localDateTime(value: string | Date = new Date()) {
  const date = typeof value === 'string' ? new Date(value) : value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
export function receivedAtIso(value: string) {
  const date = new Date(value)
  if (!value || !Number.isFinite(date.getTime())) throw new Error('请输入有效的打赏发生时间。')
  return date.toISOString()
}
