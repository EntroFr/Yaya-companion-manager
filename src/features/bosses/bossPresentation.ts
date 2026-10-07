import type { Boss } from './types'
export function displayNickname(nickname: string): string { return nickname.trim() || '未填写昵称' }
export function searchBosses(bosses: Boss[], query: string): Boss[] {
  const keyword = query.trim().toLowerCase()
  return bosses.filter(boss => boss.id.toLowerCase().includes(keyword) || boss.nickname.toLowerCase().includes(keyword))
}
