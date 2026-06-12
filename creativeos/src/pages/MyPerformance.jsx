import { useMemo } from 'react'
import { BarChart3, Coins, TrendingUp, Trophy, Video } from 'lucide-react'
import { EditorQueue, VideoAssets, AdScriptMapping, AdsPerformanceAgg, GeneratedScripts, BonusLedger } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/badges'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import { fmtEur, fmtRoas } from '@/lib/format'
import { timeAgo } from '@/lib/utils'

export default function MyPerformance() {
  const { currentUser } = useAuth()
  const uid = currentUser?.id
  const { data: queue, isLoading } = useEntityList(EditorQueue, { filter: { assigned_editor_user_id: uid }, enabled: !!uid })
  const { data: videos } = useEntityList(VideoAssets, { filter: { assigned_editor_user_id: uid }, enabled: !!uid })
  const { data: scripts } = useEntityList(GeneratedScripts, { filter: { assigned_editor_user_id: uid }, enabled: !!uid })
  const { data: mappings } = useEntityList(AdScriptMapping, { staleTime: 300_000 })
  const { data: aggs } = useEntityList(AdsPerformanceAgg, { filter: { window: 'LAST_7D' }, staleTime: 300_000 })
  const { data: ledger } = useEntityList(BonusLedger, { filter: { editor_user_id: uid }, sort: '-created_date', enabled: !!uid })

  const stats = useMemo(() => {
    const done = (queue || []).filter((q) => q.status === 'DONE').length
    const published = (videos || []).filter((v) => v.status === 'PUBLISHED').length
    const myScriptIds = new Set([...(scripts || []).map((s) => s.id), ...(queue || []).map((q) => q.generated_script_id).filter(Boolean)])
    const aggByAd = Object.fromEntries((aggs || []).map((a) => [a.ad_id, a]))
    let spend = 0, value = 0, ads = 0, winners = 0
    for (const m of mappings || []) {
      if (!myScriptIds.has(m.script_id)) continue
      const a = aggByAd[m.ad_id]
      if (!a) continue
      ads += 1; spend += a.spend || 0; value += a.conversion_value || 0
      if (a.label === 'WINNER') winners += 1
    }
    return { done, published, roas: spend > 0 ? value / spend : 0, winRate: ads > 0 ? (winners / ads) * 100 : 0, ads, spend, totalBonus: (ledger || []).reduce((s, l) => s + (l.amount_eur || 0), 0) }
  }, [queue, videos, scripts, mappings, aggs, ledger])

  if (isLoading) return <LoadingSpinner size="lg" />

  const CARDS = [
    { icon: BarChart3, label: 'Scripts completados', value: stats.done, accent: 'bg-indigo-100 text-indigo-600' },
    { icon: Video, label: 'Videos publicados', value: stats.published, accent: 'bg-purple-100 text-purple-600' },
    { icon: TrendingUp, label: 'ROAS de mis ads (7d)', value: fmtRoas(stats.roas), accent: stats.roas >= 2 ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600' },
    { icon: Trophy, label: 'Win rate', value: `${stats.winRate.toFixed(0)}%`, accent: 'bg-emerald-100 text-emerald-600' },
  ]

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="MyPerformance" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {CARDS.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-5 flex items-start gap-3">
              <div className={`rounded-xl p-2.5 ${c.accent}`}><c.icon className="h-5 w-5" /></div>
              <div><p className="text-xs text-slate-500">{c.label}</p><p className="text-2xl font-bold text-slate-900">{c.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-slate-400">{stats.ads} ads live atribuidos a tus scripts · {fmtEur(stats.spend)} de spend gestionado</p>

      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-1.5"><Coins className="h-4 w-4 text-amber-500" /> Historial de bonos · total {fmtEur(stats.totalBonus)}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(ledger || []).length === 0 && <EmptyState icon={Coins} title="Sin bonos aún" description="Los bonos por winners aparecerán aquí." />}
          {(ledger || []).map((l) => (
            <div key={l.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-white/60 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{l.rule_name}</p>
                <p className="text-xs text-slate-400">{l.detail} · {timeAgo(l.created_date)}</p>
              </div>
              <span className="font-bold text-emerald-600">{fmtEur(l.amount_eur)}</span>
              <StatusBadge status={l.status} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
