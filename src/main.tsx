import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './app/App'
createRoot(document.getElementById('root')!).render(<StrictMode>{window.yayaDesktop?.mode === 'sqlite-test' && <div className="storage-mode-banner">SQLite 测试模式 · 独立测试数据库，与正式资料隔离</div>}{window.yayaDesktop?.mode === 'sqlite' && <div className="storage-mode-banner">SQLite 正式数据源 · 资料已安全保存在本机数据库中，可通过“数据管理”进行备份与恢复。</div>}<App /></StrictMode>)
