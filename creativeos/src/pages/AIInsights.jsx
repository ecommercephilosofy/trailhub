import { useMemo } from 'react'
import { Brain, Lightbulb, TrendingUp } from 'lucide-react'
import { PatternFindings, AdsPerformanceAgg, AdStats, AdScriptMapping, GeneratedScripts, AvatarProfiles, AngleLibrary, DesireLibrary } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import { fmtRoas, fmtEur } from '@/lib/format'
import { cn } from '@/lib/utils'

const CONF_CLS = { HIGH: 'bg-emerald-100 text-emerald-700', MEDIUM: 'bg-amber-100 text-amber-700', LOW: 'bg-slate-100 text-slate-600' }

// EXTRA TOP: Hook × Format win matrix — qué combinación produce winners.
function HookFormatMatrix({ aggs, adStats }) {
  const matrix = useMemo(() => {
    const cells = {}
    const hooks = new Set(), formats = new Set()
    for (const a of aggs || []) {
      const st = (adStats || []).find((s) => s.ad_id === a.ad_id)
      const hook = st?.parsed_hook, format = st?.parsed_format
      if (!hook || !format) continue
      hooks.add(hook); formats.add(format)
      const key = `${hook}|${format}`
      const c = (cells[key] = cells[key] || { spend: 0, value: 0, n: 0, winners: 0 })
      c.spend += a.spend || 0; c.value += a.conversion_value || 0; c.n += 1
      if (a.label === 'WINNER') c.winners += 1
    }
    return { cells, hooks: [...hooks], formats: [...formats] }
  }, [aggs, adStats])

  if (!matrix.hooks.length) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-indigo-500" /> Matriz Hook × Formato (ROAS agregado 7d)</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[480px] text-xs">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left font-medium text-slate-400">Hook ↓ / Formato →</th>
              {matrix.formats.map((f) => <th key={f} className="px-2 py-1.5 text-center font-medium text-slate-400">{f.replace(/_/g, '-')}</th>)}
            </tr>
          </thead>
          <tbody>
            {matrix.hooks.map((h) => (
              <tr key={h}>
                <td className="px-2 py-1.5 font-medium text-slate-600">{h.replace(/_/g, ' ')}</td>
                {matrix.formats.map((f) => {
                  const c = matrix.cells[`${h}|${f}`]
                  if (!c) return <td key={f} className="px-2 py-1.5 text-center text-slate-200">·</td>
                  const roas = c.spend > 0 ? c.value / c.spend : 0
                  return (
                    <td key={f} className="px-1 py-1">
                      <div className={cn(
                        'rounded-lg px-2 py-1.5 text-center font-semibold',
                        roas >= 2.5 ? 'bg-emerald-100 text-emerald-700' : roas >= 1.5 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'
                      )}>
                        {fmtRoas(roas)}
                        <span className="block text-[9px] font-normal opacity-70">{c.n} ads{c.winners ? ` · ${c.winners}🏆` : ''}</span>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-slate-400">Tags extraídos del naming convention de los ads. ROAS = suma valor / suma gasto por celda.</p>
      </CardContent>
    </Card>
  )
}

function DimensionAnalysis({ aggs, mappings, scripts, avatars, angles, desires }) {
  const dims = useMemo(() => {
    const aggByAd = Object.fromEntries((aggs || []).map((a) => [a.ad_id, a]))
    const scriptById = Object.fromEntries((scripts || []).map((s) => [s.id, s]))
    const acc = { avatar: {}, angle: {}, desire: {} }
    for (const m of mappings || []) {
      const agg = aggByAd[m.ad_id], script = scriptById[m.script_id]
      if (!agg || !script) continue
      for (const [dim, key] of [['avatar', 'avatar_id'], ['angle', 'angle_id'], ['desire', 'desire_id']]) {
        const id = script[key]
        if (!id) continue
        const a = (acc[dim][id] = acc[dim][id] || { spend: 0, value: 0, n: 0 })
        a.spend += agg.spend || 0; a.value += agg.conversion_value || 0; a.n += 1
      }
    }
    const nameOf = { avatar: Object.fromEntries((avatars || []).map((x) => [x.id, x.nombre])), angle: Object.fromEntries((angles || []).map((x) => [x.id, x.nombre])), desire: Object.fromEntries((desires || []).map((x) => [x.id, x.nombre])) }
    const top = (dim) => Object.entries(acc[dim])
      .map(([id, a]) => ({ id, name: nameOf[dim][id] || id, roas: a.spend > 0 ? a.value / a.spend : 0, spend: a.spend, n: a.n }))
      .sort((x, y) => y.roas - x.roas)
    return { avatar: top('avatar'), angle: top('angle'), desire: top('desire') }
  }, [aggs, mappings, scripts, avatars, angles, desires])

  const SECTIONS = [['avatar', 'Avatar más performante', 'text-blue-600'], ['angle', 'Ángulo más performante', 'text-purple-600'], ['desire', 'Deseo más performante', 'text-pink-600']]

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {SECTIONS.map(([dim, title, cls]) => (
        <Card key={dim}>
          <CardHeader><CardTitle className={`text-sm ${cls}`}>{title}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {dims[dim].length === 0 && <p className="py-2 text-center text-sm text-slate-400">Sin datos mapeados</p>}
            {dims[dim].slice(0, 4).map((d, i) => (
              <div key={d.id} className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-300">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700">{d.name}</p>
                  <p className="text-[10px] text-slate-400">{fmtEur(d.spend)} · {d.n} ads</p>
                </div>
                <span className={`text-sm font-bold ${d.roas >= 2.5 ? 'text-emerald-600' : d.roas >= 1.5 ? 'text-amber-600' : 'text-red-500'}`}>{fmtRoas(d.roas)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function AIInsights() {
  const { data: findings, isLoading } = useEntityList(PatternFindings, { sort: '-created_date', limit: 50 })
  const { data: aggs } = useEntityList(AdsPerformanceAgg, { filter: { window: 'LAST_7D' }, staleTime: 300_000 })
  const { data: adStats } = useEntityList(AdStats, { staleTime: 300_000 })
  const { data: mappings } = useEntityList(AdScriptMapping, { staleTime: 300_000 })
  const { data: scripts } = useEntityList(GeneratedScripts, { staleTime: 300_000 })
  const { data: avatars } = useEntityList(AvatarProfiles, { staleTime: 300_000 })
  const { data: angles } = useEntityList(AngleLibrary, { staleTime: 300_000 })
  const { data: desires } = useEntityList(DesireLibrary, { staleTime: 300_000 })

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="AIInsights" />

      <HookFormatMatrix aggs={aggs} adStats={adStats} />
      <DimensionAnalysis aggs={aggs} mappings={mappings} scripts={scripts} avatars={avatars} angles={angles} desires={desires} />

      <h3 className="text-sm font-semibold text-slate-500 flex items-center gap-1.5"><Brain className="h-4 w-4" /> Patrones detectados</h3>
      {(findings || []).length === 0 ? (
        <EmptyState icon={Lightbulb} title="Sin patrones aún" description="Los insights de IA aparecerán tras varios syncs." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {(findings || []).map((f) => (
            <div key={f.id} className="glass-card p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-slate-800">{f.title}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${CONF_CLS[f.confidence] || CONF_CLS.LOW}`}>{f.confidence}</span>
              </div>
              <p className="mt-1.5 text-sm text-slate-600">{f.insight}</p>
              {f.recommendation && (
                <p className="mt-2 rounded-lg bg-indigo-50/70 border border-indigo-100 p-2.5 text-sm text-indigo-900">
                  💡 {f.recommendation}
                </p>
              )}
              {(f.supporting_ads || []).length > 0 && (
                <p className="mt-2 font-mono text-[10px] text-slate-400">Ads: {f.supporting_ads.join(', ')}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
