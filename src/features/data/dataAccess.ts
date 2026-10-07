import type { DataAccess } from './contracts'
import { createLocalStorageDataAccess } from '../storage/localStorageDataAccess.ts'
import { createElectronDataAccess } from './electronDataAccess.ts'

// 唯一装配入口：以后在 React 挂载前换成 Electron IPC 实现。
const desktop = typeof window === 'undefined' ? undefined : window.yayaDesktop
export let dataAccess: DataAccess = desktop && ['sqlite-test','sqlite'].includes(desktop.mode) ? createElectronDataAccess(desktop) : createLocalStorageDataAccess()
export function configureDataAccess(adapter: DataAccess) { dataAccess = adapter }
