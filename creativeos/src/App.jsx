import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useStoreSync } from '@/hooks/useData'
import Layout, { NAV_ITEMS } from '@/components/layout/Layout'
import { LoadingSpinner } from '@/components/shared/misc'

import Dashboard from '@/pages/Dashboard'
import MyWork from '@/pages/MyWork'
import AIInsights from '@/pages/AIInsights'
import MarketResearch from '@/pages/MarketResearch'
import AdsPerformance from '@/pages/AdsPerformance'
import ScriptLibrary from '@/pages/ScriptLibrary'
import Inspiration from '@/pages/Inspiration'
import ContextLibrary from '@/pages/ContextLibrary'
import ResearchHub from '@/pages/ResearchHub'
import ScriptBuilder from '@/pages/ScriptBuilder'
import VideoOps from '@/pages/VideoOps'
import EditorQueue from '@/pages/EditorQueue'
import Tasks from '@/pages/Tasks'
import Training from '@/pages/Training'
import MyPerformance from '@/pages/MyPerformance'
import AIRouter from '@/pages/AIRouter'
import BonusManagement from '@/pages/BonusManagement'
import OwnershipReview from '@/pages/OwnershipReview'
import Users from '@/pages/Users'
import Settings from '@/pages/Settings'

const PAGES = {
  '/': Dashboard, '/MyWork': MyWork, '/AIInsights': AIInsights, '/MarketResearch': MarketResearch,
  '/AdsPerformance': AdsPerformance, '/ScriptLibrary': ScriptLibrary, '/Inspiration': Inspiration,
  '/ContextLibrary': ContextLibrary, '/ResearchHub': ResearchHub, '/ScriptBuilder': ScriptBuilder,
  '/VideoOps': VideoOps, '/EditorQueue': EditorQueue, '/Tasks': Tasks, '/Training': Training,
  '/MyPerformance': MyPerformance, '/AIRouter': AIRouter, '/BonusManagement': BonusManagement,
  '/OwnershipReview': OwnershipReview, '/Users': Users, '/Settings': Settings,
}

function RequireRole({ roles, children }) {
  const { effectiveRole } = useAuth()
  if (!roles.includes(effectiveRole)) {
    const fallback = NAV_ITEMS.find((i) => i.roles.includes(effectiveRole))
    return <Navigate to={fallback?.path || '/VideoOps'} replace />
  }
  return children
}

export default function App() {
  useStoreSync()
  const { loading } = useAuth()
  if (loading) return <div className="min-h-screen page-bg flex items-center justify-center"><LoadingSpinner size="lg" /></div>
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
        <Route path="*" element={<Navigate to="/VideoOps" replace />} />
      </Routes>
    </Layout>
  )
}
