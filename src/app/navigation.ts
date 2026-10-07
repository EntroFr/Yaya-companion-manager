export interface AppRoute { page: 'dashboard' | 'bosses' | 'statistics' | 'migration' | 'data' | 'other'; bossId: string | null }
export function parseRoute(hash: string): AppRoute {
  if (hash === '#other') return { page: 'other', bossId: null }
  if (hash === '#data') return { page: 'data', bossId: null }
  if (hash === '#migration') return { page: 'migration', bossId: null }
  if (hash === '#statistics') return { page: 'statistics', bossId: null }
  if (hash === '#bosses') return { page: 'bosses', bossId: null }
  if (hash.startsWith('#bosses/')) {
    try { return { page: 'bosses', bossId: decodeURIComponent(hash.slice(8)) || null } }
    catch { return { page: 'bosses', bossId: null } }
  }
  return { page: 'dashboard', bossId: null }
}
export function bossDetailHash(id: string): string { return `#bosses/${encodeURIComponent(id)}` }
