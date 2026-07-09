// Performance real (dirección): ads de la última semana + memoria lifecycle
// (semanas ganando, récord, despertados) + por geo. Publicado por el pipeline.
import { useEffect, useMemo, useState } from 'react'
import { useEntityList } from '@/hooks/useData'
import { AdsWeekly, AdLifecycle, Cards, Profiles, CreativeReviews } from '@/api/entities'
import { supabase } from '@/api/supabaseClient'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/shared/misc'
import { TrendingUp, Table2, LayoutGrid, ChevronDown } from 'lucide-react'
import { fmtRoas, fmtNum } from '@/lib/format'
import { ACCOUNT_NAMES, ACCOUNT_BADGE } from '@/lib/constants'
import { cn } from '@/lib/utils'

// Tarjeta de creativo con thumbnail + review (la galería del viejo Informe_Quies).
function CreativeCard({ review }) {
  const [url, setUrl] = useState(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!review.thumb_path) return
    supabase.storage.from('creatives').createSignedUrl(review.thumb_path, 3600)
      .then(({ data }) => data && setUrl(data.signedUrl))
  }, [review.thumb_path])
  const isWinner = /winner/i.test(review.role || '')
  return (
    <Card className="overflow-hidden">
      <div className="aspect-square bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
        {url ? <img src={url} alt={review.ad_name} className="h-full w-full object-cover" />
             : <span className="text-slate-400 text-xs">sin thumbnail</span>}
      </div>
      <CardContent className="pt-3 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-slate-800 text-sm">{review.ad_code || review.ad_name}</span>
          {review.role && (
            <Badge className={cn('text-[9px]', isWinner ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700')}>
              {review.role}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {review.structure && <span className="rounded bg-indigo-100 text-indigo-700 px-1.5 py-0.5 text-[10px]">{review.structure}</span>}
          {review.framing && <span className="rounded bg-purple-100 text-purple-700 px-1.5 py-0.5 text-[10px]">{review.framing}</span>}
          {review.awareness && <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 text-[10px]">{review.awareness}</span>}
          {review.duration_s && <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 text-[10px]">{review.duration_s}s</span>}
        </div>
        {review.metric_story && <p className="text-xs text-slate-600 line-clamp-2">{review.metric_story}</p>}
        <button onClick={() => setOpen((o) => !o)} className="text-[11px] text-indigo-600 flex items-center gap-1">
          {open ? 'Ocultar' : 'Ver review completo'} <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="space-y-2 text-xs border-t border-slate-100 pt-2">
            {review.script_review && <div><p className="font-bold text-slate-500">📝 Script</p><p className="text-slate-600">{review.script_review}</p></div>}
            {review.visual_review && <div><p className="font-bold text-slate-500">🎬 Visual</p><p className="text-slate-600">{review.visual_review}</p></div>}
            {review.fix && <div className="rounded bg-amber-50 border border-amber-100 px-2 py-1"><p className="font-bold text-amber-700">🔧 Fix</p><p className="text-amber-800">{review.fix}</p></div>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const STATUS_BADGE = {
  winner: 'bg-emerald-100 text-emerald-800',
  awakened: 'bg-teal-100 text-teal-800',
  active: 'bg-blue-100 text-blue-700',
  immature: 'bg-slate-100 text-slate-500',
  neutral: 'bg-slate-100 text-slate-600',
  dead: 'bg-red-100 text-red-700',
  sleeping: 'bg-slate-100 text-slate-400',
}

export default function Performance() {
  const { data: ads, error } = useEntityList(AdsWeekly, { sort: '-week_date', limit: 1000 })
  const { data: lifecycle } = useEntityList(AdLifecycle, { limit: 1000 })
  const { data: cards } = useEntityList(Cards, { limit: 500 })
  const { data: profiles } = useEntityList(Profiles)
  const { data: reviews } = useEntityList(CreativeReviews, { sort: '-week_date', limit: 200 })
  const [sortKey, setSortKey] = useState('spend')
  const [view, setView] = useState('table')

  const lastWeek = ads?.[0]?.week_date
  const lcByCode = useMemo(() => Object.fromEntries((lifecycle || []).map((l) => [l.code, l])), [lifecycle])
  // Producción vinculada: ad_code → {tarjeta, editor} (sync al aprobar en Video Ops)
  const prodByCode = useMemo(() => {
    const nameOf = (uid) => (profiles || []).find((p) => p.user_id === uid)?.name
    const m = {}
    for (const c of cards || []) {
      if (c.matched_ad_code && !m[c.matched_ad_code]) {
        m[c.matched_ad_code] = { title: c.title, editor: nameOf(c.assigned_editor), status: c.status }
      }
    }
    return m
  }, [cards, profiles])
  const rows = useMemo(() => (ads || [])
    .filter((a) => a.week_date === lastWeek)
    .sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0)), [ads, lastWeek, sortKey])

  if (error) return <ErrorState error={error} />
  if (!rows.length) {
    return <EmptyState icon={TrendingUp} title="Sin datos de performance"
      description="El pipeline publica cada lunes los ads de la semana con su memoria lifecycle." />
  }

  const header = (label, key) => (
    <th className={cn('px-3 py-2 text-right cursor-pointer select-none hover:text-indigo-600',
      sortKey === key && 'text-indigo-700 font-bold')}
        onClick={() => setSortKey(key)}>{label}{sortKey === key ? ' ↓' : ''}</th>
  )

  const galleryReviews = (reviews || []).filter((r) => r.week_date === (reviews?.[0]?.week_date))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant={view === 'table' ? 'default' : 'outline'} size="sm" onClick={() => setView('table')}>
          <Table2 className="h-4 w-4" /> Tabla
        </Button>
        <Button variant={view === 'gallery' ? 'default' : 'outline'} size="sm" onClick={() => setView('gallery')}>
          <LayoutGrid className="h-4 w-4" /> Galería de creativos
        </Button>
      </div>

      {view === 'gallery' ? (
        galleryReviews.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {galleryReviews.map((r) => <CreativeCard key={r.ad_name} review={r} />)}
          </div>
        ) : (
          <EmptyState icon={LayoutGrid} title="Sin creativos analizados"
            description="El pipeline rubrica los top/bottom ads cada lunes con su thumbnail y review." />
        )
      ) : (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Semana {lastWeek} — {rows.length} creativos</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="px-3 py-2 text-left">Código</th>
                <th className="px-3 py-2 text-left">Cuenta</th>
                <th className="px-3 py-2 text-left">Lifecycle</th>
                <th className="px-3 py-2 text-left">Geo</th>
                {header('Gasto 7d', 'spend')}
                {header('ROAS', 'roas')}
                {header('Compras', 'purchases')}
                {header('Freq', 'frequency')}
                <th className="px-3 py-2 text-right">Récord</th>
                <th className="px-3 py-2 text-right" title="Gasto acumulado desde jul-2026 (cuando arrancó la memoria lifetime) — no incluye historia anterior">Lifetime*</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const lc = lcByCode[a.ad_code] || {}
                return (
                  <tr key={`${a.ad_code}-${a.account_id}`} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{a.ad_code}</p>
                      {a.qb_code_detected && <code className="text-[9px] text-indigo-500">{a.qb_code_detected}</code>}
                      {prodByCode[a.ad_code] && (
                        <p className="text-[9px] text-slate-400" title={prodByCode[a.ad_code].title}>
                          🎬 {prodByCode[a.ad_code].editor || 'producción'} · {prodByCode[a.ad_code].status}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium',
                        ACCOUNT_BADGE[a.account_id] || 'bg-slate-100 text-slate-600')}>
                        {ACCOUNT_NAMES[a.account_id] || a.account_id || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={cn('text-[10px]', STATUS_BADGE[lc.status] || 'bg-slate-100')}>
                        {lc.status || '—'}{lc.weeks_as_winner > 0 && ` · ${lc.weeks_as_winner} sem`}
                      </Badge>
                      {lc.stale && <Badge variant="outline" className="ml-1 text-[9px] text-amber-600">STALE</Badge>}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{a.geo || '—'}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(a.spend)} {a.currency === 'USD' ? '$' : '€'}</td>
                    <td className={cn('px-3 py-2 text-right font-semibold',
                      a.roas >= 2 ? 'text-emerald-600' : a.roas < 0.8 ? 'text-red-600' : 'text-slate-700')}>
                      {a.roas != null ? fmtRoas(a.roas) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">{a.purchases ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{a.frequency ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{lc.best_roas ? fmtRoas(lc.best_roas) : '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-500">
                      {lc.lifetime_spend ? `${fmtNum(lc.lifetime_spend)}${lc.currency === 'USD' ? '$' : '€'}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-slate-400">
            * Lifetime = gasto acumulado por el sistema desde jul-2026 (arranque de la memoria por creativo).
            Un ad con historia anterior puede mostrar lifetime menor que su gasto semanal hasta que la memoria acumule.
          </p>
        </CardContent>
      </Card>
      )}
    </div>
  )
}
