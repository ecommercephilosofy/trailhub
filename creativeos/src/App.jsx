import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useStoreSync } from '@/hooks/useData'
import { arrivedFromAuthLink } from '@/api/supabaseClient'
import Layout, { NAV_ITEMS } from '@/components/layout/Layout'
import { LoadingSpinner } from '@/components/shared/misc'

import Login from '@/pages/Login'
import SetPassword from '@/pages/SetPassword'
import Dashboard from '@/pages/Dashboard'
import Direccion from '@/pages/Direccion'
import Briefs from '@/pages/Briefs'
import VideoOps from '@/pages/VideoOps'
import Performance from '@/pages/Performance'
import Competencia from '@/pages/Competencia'
import Bonuses from '@/pages/Bonuses'
import Chat from '@/pages/Chat'
import Admin from '@/pages/Admin'

const PAGES = {
  '/': Dashboard, '/Direccion': Direccion, '/Briefs': Briefs, '/VideoOps': VideoOps, '/Performance': Performance,
  '/Competencia': Competencia, '/Bonuses': Bonuses, '/Chat': Chat, '/Admin': Admin,
}

function RequireRole({ roles, children }) {
  const { effectiveRole } = useAuth()
  if (!roles.includes(effectiveRole)) {
    const fallback = NAV_ITEMS.find((i) => i.roles.includes(effectiveRole))
    return <Navigate to={fallback?.path || '/Briefs'} replace />
  }
  return children
}

export default function App() {
  useStoreSync()
  const { loading, user, configured } = useAuth()
  const [needsPassword, setNeedsPassword] = useState(arrivedFromAuthLink)
  if (loading) return <div className="min-h-screen page-bg flex items-center justify-center"><LoadingSpinner size="lg" /></div>
  if (!configured || !user) return <Login />
  if (needsPassword) return <SetPassword onDone={() => setNeedsPassword(false)} />
  return (
    <Layout>
      <Routes>
        {NAV_ITEMS.map((item) => {
          const Page = PAGES[item.path]
          return (
            <Route
              key={item.path}
              path={item.path}
              element={<RequireRole roles={item.roles}><Page /></RequireRole>}
            />
          )
        })}
        <Route path="*" element={<Navigate to="/Briefs" replace />} />
      </Routes>
    </Layout>
  )
}
