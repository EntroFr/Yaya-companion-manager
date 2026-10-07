import { defineConfig, loadEnv } from 'vite'
import { defaultRepository, githubDeployment } from './deployment.js'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const repository = process.env.VITE_GITHUB_REPOSITORY || env.VITE_GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY || (mode === 'production' ? defaultRepository : '')
  return { base: githubDeployment(repository).base }
})
