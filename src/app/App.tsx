import { StatisticsPage } from '../pages/statistics/StatisticsPage'
import { useEffect, useState } from 'react'
import { AppLayout } from '../components/layout/AppLayout'
import { Dashboard } from '../pages/dashboard/Dashboard'
import { BossesPage } from '../pages/bosses/BossesPage'
import { useOrders } from '../features/orders/useOrders'
import { CurrentOrder } from '../features/orders/CurrentOrder'
import { parseRoute } from './navigation'
import { MigrationPage } from '../pages/migration/MigrationPage'
import { DataManagementPage } from '../pages/data/DataManagementPage'
export default function App() {
  const orders = useOrders()
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const navigate = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])
  return <AppLayout page={route.page}><CurrentOrder controller={orders} showEmpty={route.page === 'dashboard'} />{route.page === 'data' ? <DataManagementPage /> : route.page === 'migration' ? <MigrationPage /> : route.page === 'bosses' ? <BossesPage key={route.bossId ?? 'list'} orders={orders} initialBossId={route.bossId} /> : route.page === 'statistics' ? <StatisticsPage /> : <Dashboard controller={orders} />}</AppLayout>
}
