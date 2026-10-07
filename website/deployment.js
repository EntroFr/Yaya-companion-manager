export const defaultRepository = 'EntroFr/Yaya-companion-manager'

// 本地可通过 .env.local 设置；Actions 使用 GitHub 提供的真实 owner/repo。
export function githubDeployment(repository = '', version = '') {
  if (!repository) return { base: '/', releaseUrl: '' }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw Error('GitHub 仓库配置必须为 owner/repo。')
  if (version && !/^\d+\.\d+\.\d+$/.test(version)) throw Error('下载版本必须为 x.y.z 格式。')
  const [owner, repo] = repository.split('/')
  return {
    base: repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '/' : `/${repo}/`,
    releaseUrl: version ? `https://github.com/${repository}/releases/download/v${version}/YayaDiary-${version}-Portable.zip` : '',
  }
}
