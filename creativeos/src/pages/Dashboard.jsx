// Dashboard dirección: semáforo CMO + KPIs WoW + hallazgos + tendencia ROAS.
// Todo viene publicado por el pipeline (lunes) — aquí no se calcula nada.
import { useAuth } from '@/context/AuthContext'
import { useEntityList } from '@/hooks/useData'
import { WeeklyReports, MetricsSnapshots, CmoVerdicts, RunRequests, LearnedPatterns } from '@/api/entities'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/shared/misc'
import { LayoutDashboard, Play, Loader2, Brain, FileDown } from 'lucide-react'
import { supabase } from '@/api/supabaseClient'
import { fmtRoas } from '@/lib/format'
import { CMO_STATUS_STYLE } from '@/lib/constants'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { cn, timeAgo } from '@/lib/utils'
import { toast } from 'sonner'

// PDFs del run (los mismos que llegan a Telegram) — signed URLs por rol:
// el CMO solo lo puede firmar dirección (RLS de storage).
function PdfButtons({ report }) {
  const open = async (bucket, path) => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600)
    if (error) return toast.error(error.message)
    window.open(data.signedUrl, '_blank')
  }
  if (!report?.editor_pdf_path && !report?.cmo_pdf_path) return null
  return (
    <div className="flex gap-2">
      {report.editor_pdf_path && (
        <Button variant="outline" size="sm" onClick={() => open('reports', report.editor_pdf_path)}>
          <FileDown className="h-3.5 w-3.5" /> PDF editores
        </Button>
      )}
      {report.cmo_pdf_path && (
        <Button variant="outline" size="sm" onClick={() => open('reports-cmo', report.cmo_pdf_path)}>
          <FileDown className="h-3.5 w-3.5" /> PDF CMO 🔒
        </Button>
      )}
    </div>
  )
}

// Botón «Lanzar análisis ahora»: inserta en run_requests; el bot del Mac lo
// recoge (~1 min) y ejecuta el pipeline completo (últimos 7d). Estado en vivo.
function RunNowButton() {
  const { user, effectiveRole } = useAuth()
  const { data: reqs, refetch } = useEntityList(RunRequests, { sort: '-id', limit: 1, staleTime: 15_000 })
  const last = reqs?.[0]
  const busy = last && ['pending', 'running'].includes(last.status)
  if (effectiveRole !== 'ADMIN') return null

  const launch = async () => {
    if (busy) return
    try {
      await RunRequests.create({ requested_by: user.id })
      toast.success('Análisis solicitado — el sistema lo recoge en ~1 min')
      refetch()
    } catch (e) {
      toast.error(e.message)
    }
  }
  return (
    <div className="flex items-center gap-3">
      <Button onClick={launch} disabled={busy}
              className="bg-gradient-to-r from-indigo-500 to-purple-500">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {busy ? (last.status === 'pending' ? 'En cola…' : 'Analizando… (~1-2h)') : 'Lanzar análisis ahora'}
      </Button>
      {last && !busy && (
        <span className="text-xs text-slate-400">
          último: {last.status === 'done' ? '✓ completado' : `⚠ ${last.detail || last.status}`} · {timeAgo(last.finished_at || last.requested_at)}
        </span>
      )}
    </div>
  )
}

// Memoria del sistema: firmas de creativo aprendidas semana a semana (patterns
// del pipeline). Tentativas hasta repetir ≥2 semanas.
function SystemMemory() {
  const { data: patterns } = useEntityList(LearnedPatterns, { limit: 100 })
  if (!patterns?.length) return null
  const sorted = [...patterns].sort((a, b) => (b.score || 0) - (a.score || 0))
  const winners = sorted.filter((p) => (p.score || 0) > 0).slice(0, 5)
  const losers = sorted.filter((p) => (p.score || 0) < 0).slice(-3)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-500" />
          Memoria del sistema — firmas aprendidas ({patterns.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 text-sm">
        <div>
          <p className="text-xs font-bold text-emerald-600 uppercase mb-1.5">Ganando</p>
          {winners.map((p) => (
            <p key={p.signature} className="text-xs text-slate-700 mb-1">
              <span className={cn('mr-1 rounded px-1 text-[9px] font-bold',
                p.confidence === 'confirmado' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500')}>
                {p.confidence === 'confirmado' ? '✓' : '?'}
              </span>
              {p.signature.split('|').join(' · ')}
            </p>
          ))}
          {!winners.length && <p className="text-xs text-slate-400">Aún acumulando señal.</p>}
        </div>
        <div>
          <p className="text-xs font-bold text-red-500 uppercase mb-1.5">Quemado</p>
          {losers.map((p) => (
            <p key={p.signature} className="text-xs text-slate-500 mb-1">{p.signature.split('|').join(' · ')}</p>
          ))}
          {!losers.length && <p className="text-xs text-slate-400">Nada confirmado como perdedor.</p>}
        </div>
        <p className="sm:col-span-2 text-[10px] text-slate-400">
          Firma = estructura · duración · fase · awareness · deseo · hook · geo. «?» = tentativa (1 semana);
          «✓» = confirmada (≥2 semanas repitiendo). Se afina cada lunes.
        </p>
      </CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const { data: reports, error } = useEntityList(WeeklyReports, { sort: '-week_date', limit: 1 })
  const { data: snapshots } = useEntityList(MetricsSnapshots, { sort: 'week_date', limit: 12 })
  const { data: verdicts } = useEntityList(CmoVerdicts, { sort: '-week_date', limit: 1 })
  const report = reports?.[0]
  const plan = verdicts?.[0]?.action_plan || {}

  if (error) return <ErrorState error={error} />
  if (!report) {
    return (
      <div className="space-y-4">
        <RunNowButton />
        <EmptyState icon={LayoutDashboard} title="Sin datos todavía"
          description="El pipeline publica cada lunes — o lánzalo ahora con el botón." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <RunNowButton />
        <PdfButtons report={report} />
      </div>
      <Card className={cn('border-2', CMO_STATUS_STYLE[report.status_cmo] || '')}>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <span className={cn('rounded-full px-3 py-1 text-xs font-bold uppercase border',
              CMO_STATUS_STYLE[report.status_cmo] || 'bg-slate-100')}>
              {report.status_cmo || 'sin estado'}
            </span>
            <span className="text-sm text-slate-500">{report.week_label}</span>
          </div>
          <p className="mt-3 text-lg font-semibold text-slate-900">{report.headline}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(report.kpis || []).slice(0, 8).map((k, i) => (
          <Card key={i}>
            <CardContent className="pt-5">
              <p className="text-xs text-slate-500">{k.label}</p>
              <p className="text-xl font-bold text-slate-900">{k.value}</p>
              {k.wow && <p className="text-xs text-slate-400 mt-0.5">{k.wow} WoW</p>}
              {k.note && <p className="text-[11px] text-slate-500 mt-1 leading-snug">{k.note}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">ROAS blended — tendencia</CardTitle></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={snapshots || []}>
                <XAxis dataKey="week_date" fontSize={11} />
                <YAxis fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => `${v}x`} />
                <Tooltip formatter={(v) => fmtRoas(v)} />
                <Line type="monotone" dataKey="blended_roas" stroke="#6366f1" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Hallazgos de la semana</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {(report.key_findings || []).map((f, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-700">
                  <span className="text-indigo-500 shrink-0">•</span>{f}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <SystemMemory />

      {(plan.next_7d?.length || plan.next_30d?.length) ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Plan de acción (CMO)</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {plan.next_7d?.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Próximos 7 días</p>
                <ul className="space-y-1.5">{plan.next_7d.map((a, i) =>
                  <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-emerald-500">→</span>{a}</li>)}
                </ul>
              </div>
            )}
            {plan.next_30d?.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Próximos 30 días</p>
                <ul className="space-y-1.5">{plan.next_30d.map((a, i) =>
                  <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-indigo-500">→</span>{a}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
