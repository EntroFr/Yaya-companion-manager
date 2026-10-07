// 下载地址只在这里配置。可改为完整的 GitHub Releases HTTPS 地址。
export const site = {
  name: '丫丫的陪玩日记', version: '1.2.0',
  download: { url: '/downloads/YayaDiary-1.2.0-Portable.zip', filename: 'YayaDiary-1.2.0-Portable.zip', available: true },
  brand: 'brand/avatar.webp', tutorialDirectory: 'tutorial/',
}
export const assetUrl = path => /^https:\/\//.test(path) ? path : `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
