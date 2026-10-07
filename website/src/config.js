import { defaultRepository, githubDeployment } from '../deployment.js'
// 网站展示与下载版本集中配置；不会修改 Electron 应用版本。
const version = '1.2.1'
const repository = import.meta.env.VITE_GITHUB_REPOSITORY || (import.meta.env.PROD ? defaultRepository : '')
const release = githubDeployment(repository, version)
// GitHub Pages 构建使用 Release；本地未指定仓库时保留原本下载。
export const site = {
  name: '丫丫的陪玩日记', version,
  download: { url: release.releaseUrl || `/downloads/YayaDiary-${version}-Portable.zip`, filename: `YayaDiary-${version}-Portable.zip`, available: true },
  brand: 'brand/avatar.webp', tutorialDirectory: 'tutorial/',
}
export const assetUrl = path => /^https:\/\//.test(path) ? path : `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
