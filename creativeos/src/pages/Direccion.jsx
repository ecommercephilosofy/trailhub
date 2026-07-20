// Página DIRECCIÓN — reproduce las 6 secciones del informe CMO (solo ADMIN/MANAGER).
// Es la versión viva del PDF quies_cmo_*: media-buying completo, industria, plan.
// Todo viene de cmo_verdicts + weekly_reports + metrics_snapshots (publicado por el pipeline).
import { useEntityList } from '@/hooks/useData'
import { CmoVerdicts, WeeklyReports, MetricsSnapshots } from '@/api/entities'
import { supabase } from '@/api/supabaseClient'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/shared/misc'
import { Briefcase, FileDown, TrendingUp, Target, Zap, Swords } from 'lucide-react'
import { fmtRoas } from '@/lib/format'
import { CMO_STATUS_STYLE } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

function Section({ icon: Icon, title, children }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-indigo-500" />}{title}
      </CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function DecisionTable({ rows, cols }) {
  if (!rows?.length) return <p className="text-sm text-slate-400">Sin señal esta semana.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500 text-left">
            {cols.map((c) => <th key={c.key} className="px-2 py-1.5 font-medium">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-50 align-top">
              {cols.map((c) => (
                <td key={c.key} className={cn('px-2 py-1.5', c.cls?.(r))}>
                  {c.render ? c.render(r) : (r[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VoteList({ title, items, color }) {
  if (!items?.length) return null
  return (
    <div>
      <p className={cn('text-xs font-bold uppercase mb-1', color)}>{title}</p>
      <ul className="space-y-1">
        {items.map((v, i) => (
          <li key={i} className="text-xs text-slate-600">
            {typeof v === 'string' ? v : (v.ad ? `${v.ad} — ${v.reason || v.why || ''}` : JSON.stringify(v))}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Direccion() {
  const { data: verdicts, error } = useEntityList(CmoVerdicts, { sort: '-week_date', limit: 1 })
  const { data: reports } = useEntityList(WeeklyReports, { sort: '-week_date', limit: 6 })
  const v = verdicts?.[0]
  // El PDF debe ser el de la MISMA semana que el verdict mostrado. Si esa semana
  // aún no tiene su PDF CMO, cae al más reciente que lo tenga, pero avisando.
  const sameWeek = (reports || []).find((r) => r.week_date === v?.week_date)
  const pdfSrc = sameWeek?.cmo_pdf_path ? sameWeek : (reports || []).find((r) => r.cmo_pdf_path)
  const pdfStaleWeek = pdfSrc && v && pdfSrc.week_date !== v.week_date ? pdfSrc.week_label : null

  if (error) return <ErrorState error={error} />
  if (!v) {
    return <EmptyState icon={Briefcase} title="Sin informe de dirección"
      description="El pipeline publica el reporte CMO cada lunes. Aún no hay datos." />
  }

  const dash = v.dashboard || {}
  const ap = v.account_performance || {}
  const mb = v.media_buying || {}
  const ind = v.industry || {}
  const cr = v.creative_report || {}
  const plan = v.action_plan || {}
  const exec = v.executive_summary || {}

  const openPdf = async () => {
    if (!pdfSrc?.cmo_pdf_path) return toast.error('PDF no disponible aún')
    const { data, error } = await supabase.storage.from('reports-cmo').createSignedUrl(pdfSrc.cmo_pdf_path, 3600)
    if (error) return toast.error(error.message)
    window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="space-y-6">
      {/* Cabecera: semáforo + verdict + PDF */}
      <Card className={cn('border-2', CMO_STATUS_STYLE[dash.status] || '')}>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={cn('rounded-full px-3 py-1 text-xs font-bold uppercase border',
              CMO_STATUS_STYLE[dash.status] || 'bg-slate-100')}>{dash.status || '—'}</span>
            <span className="text-sm text-slate-500">{v.week_date}</span>
            {pdfStaleWeek && <span className="text-[11px] text-amber-600">PDF de {pdfStaleWeek}</span>}
            <Button variant="outline" size="sm" className="ml-auto" onClick={openPdf}>
              <FileDown className="h-3.5 w-3.5" /> PDF completo 🔒
            </Button>
          </div>
          {exec.verdict && <p className="mt-3 text-lg font-semibold text-slate-900">{exec.verdict}</p>}
          <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(dash.kpis || []).slice(0, 8).map((k, i) => (
              <div key={i} className="rounded-lg border border-slate-100 p-2">
                <p className="text-[10px] text-slate-500">{k.label}</p>
                <p className="text-base font-bold text-slate-900">{k.value}</p>
                {k.wow && <p className="text-[10px] text-slate-400">{k.wow}</p>}
                {k.note && <p className="text-[10px] text-slate-500 mt-1 leading-snug">{k.note}</p>}
              </div>
            ))}
          </div>
          {exec.key_findings?.length > 0 && (
            <ul className="mt-3 space-y-1">
              {exec.key_findings.map((f, i) => (
                <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-indigo-500">•</span>{f}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Performance de cuenta: tendencia + por geo */}
      <Section icon={TrendingUp} title="Performance de cuenta">
        {ap.trend_note && <p className="text-sm text-slate-600 mb-3">{ap.trend_note}</p>}
        {ap.trend_points?.length > 0 && (
          <DecisionTable rows={ap.trend_points} cols={[
            { key: 'label', label: 'Semana' },
            { key: 'spend', label: 'Gasto', render: (r) => `${r.spend}` },
            { key: 'roas', label: 'ROAS' },
            { key: 'purchases', label: 'Compras' },
            { key: 'cac', label: 'CAC' },
            { key: 'top_winner', label: 'Top winner' },
          ]} />
        )}
        {ap.by_geo?.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {ap.by_geo.map((g, i) => (
              <div key={i} className="rounded-lg border border-slate-100 p-3">
                <p className="font-semibold text-slate-800">{g.geo} · ROAS {fmtRoas(g.roas)} · CAC {g.cac}</p>
                <p className="text-[11px] text-slate-400">
                  Gasto {g.spend} · {g.purchases} compras{g.cpm_median ? ` · CPM mediana ${g.cpm_median}` : ''}
                </p>
                <p className="text-xs text-slate-500 mt-1">{g.read}</p>
              </div>
            ))}
          </div>
        )}
        {ap.efficiency_note && <p className="text-xs text-slate-500 mt-3 italic">{ap.efficiency_note}</p>}
      </Section>

      {/* Sala de máquinas: escalar / matar / fatiga / contribución */}
      <Section icon={Zap} title="Sala de máquinas — Media-buying">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-bold text-emerald-600 uppercase mb-1.5">🚀 Escalar (winners maduros)</p>
            <DecisionTable rows={mb.scale} cols={[
              { key: 'ad', label: 'Ad' }, { key: 'segment', label: 'Segmento' },
              { key: 'roas', label: 'ROAS', cls: () => 'text-emerald-600 font-semibold' },
              { key: 'vs_blended', label: 'vs blended' },
              { key: 'spend', label: 'Gasto' }, { key: 'action', label: 'Acción' },
              { key: 'why', label: 'Por qué' },
            ]} />
          </div>
          <div>
            <p className="text-xs font-bold text-red-500 uppercase mb-1.5">⛔ Matar / Reasignar</p>
            <DecisionTable rows={mb.kill_reallocate || mb.kill} cols={[
              { key: 'ad', label: 'Ad' }, { key: 'segment', label: 'Segmento' },
              { key: 'roas', label: 'ROAS', cls: () => 'text-red-600 font-semibold' },
              { key: 'wasted_per_week_est', label: '$/sem fuga', cls: () => 'text-red-500' },
              { key: 'action', label: 'Acción' }, { key: 'why', label: 'Por qué' },
            ]} />
          </div>
          {mb.fatigue?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-amber-600 uppercase mb-1.5">🔥 Fatiga (refrescar)</p>
              <DecisionTable rows={mb.fatigue} cols={[
                { key: 'ad', label: 'Ad' }, { key: 'frequency', label: 'Freq' },
                { key: 'roas', label: 'ROAS' }, { key: 'action', label: 'Acción' },
              ]} />
            </div>
          )}
          {mb.contribution?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase mb-1.5">⚖️ Contribución (carga / lastre)</p>
              <DecisionTable rows={mb.contribution} cols={[
                { key: 'ad', label: 'Ad' }, { key: 'segment', label: 'Segmento' },
                { key: 'role', label: 'Rol', cls: (r) => r.role === 'carga' ? 'text-emerald-600' : r.role === 'lastre' ? 'text-red-600' : '' },
                { key: 'roas_vs_segment', label: 'vs grupo' }, { key: 'read', label: 'Lectura' },
              ]} />
            </div>
          )}
          {mb.funnel_allocation && (
            <p className="text-xs text-slate-500">
              <b>Funnel:</b> TOF {mb.funnel_allocation.tof_pct}% · MOF {mb.funnel_allocation.mof_pct}% · BOF {mb.funnel_allocation.bof_pct}% — {mb.funnel_allocation.read}
            </p>
          )}
        </div>
      </Section>

      {/* Voto de Meta */}
      {mb.meta_vote && (
        <Section icon={Target} title="El voto de Meta (gasto = confianza)">
          <div className="grid gap-4 sm:grid-cols-2">
            <VoteList title="Iterar/escalar ya" items={mb.meta_vote.iterate_now} color="text-emerald-600" />
            <VoteList title="No se recupera" items={mb.meta_vote.wont_recover} color="text-red-500" />
            <VoteList title="Emergentes" items={mb.meta_vote.emerging} color="text-indigo-500" />
            <VoteList title="Vigilar" items={mb.meta_vote.watch} color="text-amber-500" />
          </div>
        </Section>
      )}

      {/* Informe de anuncios (creative_report) */}
      {(cr.winning_angles?.length || cr.burn_these?.length) ? (
        <Section title="Informe de anuncios — dónde invertir el creativo">
          <div className="grid gap-4 sm:grid-cols-2 text-sm">
            {cr.winning_angles?.length > 0 && (
              <div><p className="text-xs font-bold text-emerald-600 uppercase mb-1">Ángulos que producen dinero</p>
                <ul className="space-y-1">{cr.winning_angles.map((a, i) => <li key={i} className="text-slate-700">• {a}</li>)}</ul></div>
            )}
            {cr.burn_these?.length > 0 && (
              <div><p className="text-xs font-bold text-red-500 uppercase mb-1">Quemar (dejar de financiar)</p>
                <ul className="space-y-1">{cr.burn_these.map((a, i) => <li key={i} className="text-slate-700">• {a}</li>)}</ul></div>
            )}
            {cr.winning_structures?.length > 0 && (
              <div><p className="text-xs font-bold text-slate-500 uppercase mb-1">Estructuras ganadoras</p>
                <p className="text-slate-700">{cr.winning_structures.join(', ')}</p></div>
            )}
            <div className="text-xs text-slate-500">
              {cr.winning_duration_band && <p><b>Duración:</b> {cr.winning_duration_band}</p>}
              {cr.format_split && <p><b>Vídeo vs imagen:</b> {cr.format_split}</p>}
              {cr.brief_roi && <p className="mt-1">{cr.brief_roi}</p>}
            </div>
          </div>
        </Section>
      ) : null}

      {/* Industria */}
      {(ind.competitors_winning?.length || ind.opportunities?.length) ? (
        <Section icon={Swords} title="Panorama de industria / nicho">
          {ind.category_movement && <p className="text-sm text-slate-600 mb-3">{ind.category_movement}</p>}
          {ind.competitors_winning?.length > 0 && (
            <DecisionTable rows={ind.competitors_winning} cols={[
              { key: 'brand', label: 'Marca' },
              { key: 'days_running', label: 'Días', render: (r) => r.days_running ?? r.days ?? '—' },
              { key: 'structure', label: 'Estructura' },
              { key: 'what_works', label: 'Qué funciona', render: (r) => r.what_works || r.hook || '—' },
            ]} />
          )}
          <div className="grid gap-4 sm:grid-cols-2 mt-4 text-sm">
            {ind.threats?.length > 0 && (
              <div><p className="text-xs font-bold text-red-500 uppercase mb-1">Amenazas</p>
                <ul className="space-y-1">{ind.threats.map((t, i) => <li key={i} className="text-slate-700">• {t}</li>)}</ul></div>
            )}
            {ind.opportunities?.length > 0 && (
              <div><p className="text-xs font-bold text-emerald-600 uppercase mb-1">Oportunidades / huecos</p>
                <ul className="space-y-1">{ind.opportunities.map((o, i) => <li key={i} className="text-slate-700">• {o}</li>)}</ul></div>
            )}
          </div>
        </Section>
      ) : null}

      {/* Plan de la semana (schema del LLM muy variable: now/watch/bet, arrays u
          objetos, items string u objeto con action+detalle). Normalizamos todo. */}
      {(() => {
        const toArr = (x) => (Array.isArray(x) ? x : x ? [x] : [])
        const ahora = toArr(plan.now || plan.ahora || plan.next_7d)
        const vigilar = toArr(plan.watch || plan.vigilar)
        const apuesta = toArr(plan.bet || plan.apuesta || plan.next_30d)
        if (!ahora.length && !vigilar.length && !apuesta.length) return null
        const Item = ({ x, color }) => {
          if (typeof x === 'string') return <li className="text-slate-700 flex gap-1.5"><span className={color}>→</span>{x}</li>
          const detail = x.expected_impact || x.rationale || x.context || x.justified_by
          return (
            <li className="text-slate-700">
              <div className="flex gap-1.5"><span className={color}>→</span><span className="font-medium">{x.action}</span></div>
              {x.spend_at_stake && <p className="ml-4 text-[11px] text-slate-400">💰 {x.spend_at_stake}</p>}
              {detail && <p className="ml-4 text-[11px] text-slate-500">{detail}</p>}
              {x.decide_when && <p className="ml-4 text-[11px] text-amber-600">⏱ {x.decide_when}</p>}
            </li>
          )
        }
        return (
          <Section title="Plan de la semana">
            <div className="grid gap-4 lg:grid-cols-3 text-sm">
              <div><p className="text-xs font-bold text-red-600 uppercase mb-1.5">Ahora</p>
                <ul className="space-y-2">{ahora.map((a, i) => <Item key={i} x={a} color="text-red-500" />)}</ul></div>
              <div><p className="text-xs font-bold text-amber-600 uppercase mb-1.5">Vigilar</p>
                <ul className="space-y-2">{vigilar.map((a, i) => <Item key={i} x={a} color="text-amber-500" />)}</ul></div>
              <div><p className="text-xs font-bold text-indigo-600 uppercase mb-1.5">Apuesta</p>
                <ul className="space-y-2">{apuesta.map((a, i) => <Item key={i} x={a} color="text-indigo-500" />)}</ul></div>
            </div>
          </Section>
        )
      })()}

      {/* Caveats de datos */}
      {v.data_caveats?.length > 0 && (
        <p className="text-[11px] text-slate-400">
          ⚠ {v.data_caveats.map((c) => (typeof c === 'string' ? c : c.caveat)).join(' · ')}
        </p>
      )}
    </div>
  )
}
