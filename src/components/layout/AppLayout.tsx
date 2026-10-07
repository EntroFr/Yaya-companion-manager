import type { ReactNode } from 'react'
export function AppLayout({ children, page }: { children: ReactNode; page: string }) {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="应用导航">
        <img className="brand-mark" src={`${import.meta.env.BASE_URL}brand/avatar.webp`} alt="Yaya的陪玩日记品牌头像" />
        <p className="brand-name">Yaya的陪玩日记</p>
        <nav>
          <a className="nav-link" href="#dashboard" aria-current={page === 'dashboard' ? 'page' : undefined}>首页概览 <span>01</span></a>
          <a className="nav-link" href="#bosses" aria-current={page === 'bosses' ? 'page' : undefined}>老板信息 <span>02</span></a>
          <a className="nav-link" href="#statistics" aria-current={page === 'statistics' ? 'page' : undefined}>收入统计 <span>03</span></a>
          <a className="nav-link" href="#migration" aria-current={page === 'migration' ? 'page' : undefined}>数据迁移 <span>04</span></a>
          <a className="nav-link" href="#data" aria-current={page === 'data' ? 'page' : undefined}>数据管理 <span>05</span></a>
          <a className="nav-link" href="#other" aria-current={page === 'other' ? 'page' : undefined}>其他 <span>06</span></a>
        </nav>
        <div className="sidebar-note">本地单用户应用<br />陪玩日记 · 1.2.1</div>
      </aside>
      <main id={page} className="main-content">{children}</main>
    </div>
  )
}



