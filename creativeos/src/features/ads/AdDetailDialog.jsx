import { useEffect, useState } from 'react'
import { FileText, History, LayoutGrid, Gauge } from 'lucide-react'
import { AdScriptMapping, GeneratedScripts, ScriptLibrary } from '@/api/entities'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PerformanceLabel, FormatBadge, StatusBadge } from '@/components/shared/badges'
import { EmptyState } from '@/components/shared/misc'
import { fmtEur, fmtEur2, fmtNum, fmtPct, fmtRoas, fmtDate, fmtSec } from '@/lib/format'
import { metricGrade } from '@/lib/perf'

const GRADE_CLS = { A: 'bg-emerald-100 text-emerald-700', B: 'bg-amber-100 text-amber-700', C: 'bg-red-100 text-red-700' }

function Metric({ label, value, grade }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
        {grade && <span className={`rounded px-1.5 text-[10px] font-bold ${GRADE_CLS[grade]}`}>{grade}</span>}
      </div>
      <p className="mt-0.5 text-base font-semibold text-slate-800">{value}</p>
    </div>
  )
}

// ScriptTab: looks up the linked script via AdScriptMapping
export function ScriptTab({ adId }) {
  const [state, setState] = useState({ loading: true, script: null, mapping: null })
  useEffect(() => {
    let alive = true
    ;(async () => {
      const mappings = await AdScriptMapping.filter({ ad_id: adId })
      const mapping = mappings[0]
      if (!mapping) return alive && setState({ loading: false, script: null, mapping: null })
      const script = mapping.script_type === 'LIBRARY'
        ? await ScriptLibrary.get(mapping.script_id)
        : await GeneratedScripts.get(mapping.script_id)
      if (alive) setState({ loading: false, script, mapping })
    })()
    return () => { alive = false }
  }, [adId])

  if (state.loading) return <p className="py-6 text-center text-sm text-slate-400">Cargando…</p>
  if (!state.script) return <EmptyState icon={FileText} title="Sin script vinculado" description="Este ad no tiene mapping en AdScriptMapping." />
  const s = state.script
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 font-medium text-slate-800 min-w-[180px]">{s.title}</p>
        {s.format && <FormatBadge format={s.format} size="sm" />}
        {s.status && <StatusBadge status={s.status} />}
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">match: {state.mapping.match_method}</span>
      </div>
      {s.hook && <div className="rounded-lg bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 p-3 text-sm text-indigo-900">🪝 {s.hook}</div>}
      <pre className="max-h-72 overflow-y-auto scrollbar-thin whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">
        {s.full_script || s.texto_script_cached || 'Sin texto cacheado'}
      </pre>
    </div>
  )
}

export default function AdDetailDialog({ ad, daily, hideFinancial, analysisText, onClose }) {
  const last30 = (daily || []).filter((r) => r.ad_id === ad.ad_id).slice(0, 30)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-8 text-base leading-snug">{ad.ad_name}</DialogTitle>
          <DialogDescription>ID: {ad.ad_id}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="overview">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview"><Gauge className="h-3.5 w-3.5" /> Overview</TabsTrigger>
            <TabsTrigger value="metrics"><LayoutGrid className="h-3.5 w-3.5" /> Metrics</TabsTrigger>
            <TabsTrigger value="script"><FileText className="h-3.5 w-3.5" /> Script</TabsTrigger>
            <TabsTrigger value="history"><History className="h-3.5 w-3.5" /> History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <PerformanceLabel label={ad.label} action={ad.action} />
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {!hideFinancial && <Metric label="Gasto" value={fmtEur(ad.spend)} />}
              <Metric label="ROAS" value={fmtRoas(ad.roas)} grade={metricGrade(ad.roas, 2.5, 1.5)} />
              <Metric label="Conversiones" value={fmtNum(ad.conversions)} />
              {!hideFinancial && <Metric label="Ingresos" value={fmtEur(ad.conversion_value)} />}
              {ad.hook_rate > 0 && <Metric label="Hook Rate" value={fmtPct(ad.hook_rate)} grade={metricGrade(ad.hook_rate, 25, 18)} />}
              {ad.hold_rate > 0 && <Metric label="Hold Rate" value={fmtPct(ad.hold_rate)} grade={metricGrade(ad.hold_rate, 12, 8)} />}
              <Metric label="CTR" value={fmtPct(ad.ctr, 2)} grade={metricGrade(ad.ctr, 1.5, 1)} />
              <Metric label="Frecuencia" value={(ad.frequency || 0).toFixed(2)} grade={metricGrade(ad.frequency, 2.5, 3.2, true)} />
            </div>
            {analysisText && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                <p className="mb-1 text-[10px] font-bold uppercase text-indigo-500">AI Analysis</p>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{analysisText}</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="metrics">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {!hideFinancial && <Metric label="Gasto" value={fmtEur2(ad.spend)} />}
              {!hideFinancial && <Metric label="Ingresos" value={fmtEur2(ad.conversion_value)} />}
              <Metric label="ROAS" value={fmtRoas(ad.roas)} />
              {!hideFinancial && <Metric label="CPA" value={ad.conversions ? fmtEur2(ad.spend / ad.conversions) : '—'} />}
              <Metric label="Impresiones" value={fmtNum(ad.impressions)} />
              <Metric label="Link Clicks" value={fmtNum(ad.link_clicks)} />
              <Metric label="CTR" value={fmtPct(ad.ctr, 2)} />
              {!hideFinancial && <Metric label="CPC enlace" value={fmtEur2(ad.cpc)} />}
              {!hideFinancial && <Metric label="CPM" value={fmtEur2(ad.cpm)} />}
              <Metric label="Frecuencia" value={(ad.frequency || 0).toFixed(2)} />
              <Metric label="Hook Rate" value={ad.hook_rate ? fmtPct(ad.hook_rate) : '—'} />
              <Metric label="Hold Rate" value={ad.hold_rate ? fmtPct(ad.hold_rate) : '—'} />
              <Metric label="Ret. 25%" value={ad.ret_25 ? fmtPct(ad.ret_25) : '—'} />
              <Metric label="Ret. 50%" value={ad.ret_50 ? fmtPct(ad.ret_50) : '—'} />
              <Metric label="Ret. 75%" value={ad.ret_75 ? fmtPct(ad.ret_75) : '—'} />
              <Metric label="T. medio" value={ad.avg_watch_time ? fmtSec(ad.avg_watch_time) : '—'} />
            </div>
          </TabsContent>

          <TabsContent value="script"><ScriptTab adId={ad.ad_id} /></TabsContent>

          <TabsContent value="history">
            <div className="max-h-80 overflow-y-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-100 text-left text-slate-400">
                    <th className="px-2 py-1.5 font-medium">Fecha</th>
                    {!hideFinancial && <th className="px-2 py-1.5 font-medium text-right">Gasto</th>}
                    <th className="px-2 py-1.5 font-medium text-right">ROAS</th>
                    <th className="px-2 py-1.5 font-medium text-right">CTR</th>
                    <th className="px-2 py-1.5 font-medium text-right">Conv.</th>
                    <th className="px-2 py-1.5 font-medium text-right">Freq.</th>
                  </tr>
                </thead>
                <tbody>
                  {last30.map((r) => {
                    const roas = r.spend > 0 ? r.conversion_value / r.spend : 0
                    const ctr = r.impressions > 0 ? (r.link_clicks / r.impressions) * 100 : 0
                    return (
                      <tr key={r.id} className="border-b border-slate-50">
                        <td className="px-2 py-1.5 text-slate-600">{fmtDate(r.date)}</td>
                        {!hideFinancial && <td className="px-2 py-1.5 text-right text-slate-600">{fmtEur2(r.spend)}</td>}
                        <td className={`px-2 py-1.5 text-right font-medium ${roas >= 2.5 ? 'text-emerald-600' : roas >= 1.5 ? 'text-amber-600' : 'text-red-500'}`}>{fmtRoas(roas)}</td>
                        <td className="px-2 py-1.5 text-right text-slate-600">{fmtPct(ctr, 2)}</td>
                        <td className="px-2 py-1.5 text-right text-slate-600">{r.conversions}</td>
                        <td className="px-2 py-1.5 text-right text-slate-600">{(r.frequency || 0).toFixed(1)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
