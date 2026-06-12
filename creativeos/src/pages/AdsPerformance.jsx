import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, FileSpreadsheet, RefreshCw, Search, Zap, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { AdsPerformanceDaily, AdStats, Settings as SettingsEntity } from '@/api/entities'
import { syncMetaAds } from '@/api/functions'
import { useEntityList } from '@/hooks/useData'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PerformanceLabel, FatigueIndicator } from '@/components/shared/badges'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import AdAnalysisDialog from '@/features/ads/AdAnalysisDialog'
import AdDetailDialog from '@/features/ads/AdDetailDialog'
import ColumnOrderEditor from '@/features/ads/ColumnOrderEditor'
import CsvImportDialog from '@/features/ads/CsvImportDialog'
import { aggregateDaily, labelFor, computeFatigue, DEFAULT_THRESHOLDS, marginThresholds } from '@/lib/perf'
import { parseCountry } from '@/lib/naming'
import { fmtEur, fmtEur2, fmtNum, fmtPct, fmtRoas, fmtSec } from '@/lib/format'
import { cn } from '@/lib/utils'

const METRIC_HELP = {
  roas: 'Conversion value / spend. Agregado del período (suma/suma, no media de medias).',
  ctr: 'Link clicks / impresiones. Mide si la creatividad empuja al click.',
  cpc: 'Coste por clic de enlace.',
  frequency: 'Impresiones medias por persona. >3.2 = riesgo de fatiga.',
  hook_rate: 'Video 3s / reproducciones. ¿Los 2 primeros segundos paran el scroll?',
  hold_rate: 'ThruPlay / video 3s. ¿El cuerpo retiene a quien se quedó?',
  ret: '% de reproducciones que llegan a ese punto del video.',
  avg_watch: 'Tiempo medio de visualización.',
  thruplay: 'Reproducciones completas o >15s.',
}

function MetricTooltip({ children, help }) {
  if (!help) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="cursor-help">{children}</span></TooltipTrigger>
      <TooltipContent>{help}</TooltipContent>
    </Tooltip>
  )
}

const roasCls = (v, t) => (v >= (t?.roas_winner ?? 2.5) ? 'text-emerald-600 font-semibold' : v >= (t?.roas_regular ?? 1.5) ? 'text-amber-600 font-medium' : 'text-red-500 font-medium')
const rateCls = (v, good, ok) => (v >= good ? 'text-emerald-600 font-semibold' : v >= ok ? 'text-amber-600' : 'text-red-500')

export default function AdsPerformance() {
  const { effectiveRole } = useAuth()
  const hideFinancial = effectiveRole === 'EDITOR'
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [appliedRange, setAppliedRange] = useState(null)
  const [labelFilter, setLabelFilter] = useState('all')
  const [creativeFilter, setCreativeFilter] = useState('all')
  const [countryFilter, setCountryFilter] = useState('all')
  const [mode, setMode] = useState('conversions')
  const [sort, setSort] = useState({ key: 'spend', dir: 'desc' })
  const [detailAd, setDetailAd] = useState(null)
  const [csvOpen, setCsvOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const { data: daily, isLoading } = useEntityList(AdsPerformanceDaily, { sort: '-date', limit: 5000, staleTime: 300_000 })
  const { data: adStats } = useEntityList(AdStats, { staleTime: 300_000 })
  const { data: settingsList } = useEntityList(SettingsEntity, { staleTime: 300_000 })
  const thresholds = marginThresholds(settingsList?.[0]?.margin_config, settingsList?.[0]?.metric_thresholds_manual || DEFAULT_THRESHOLDS)
  const statsById = useMemo(() => Object.fromEntries((adStats || []).map((s) => [s.ad_id, s])), [adStats])

  const rows = useMemo(() => {
    let d = daily || []
    if (appliedRange) d = d.filter((r) => r.date >= appliedRange.start && r.date <= appliedRange.end)
    else {
      const cutoff = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
      d = d.filter((r) => r.date >= cutoff)
    }
    const aggs = aggregateDaily(d)
    return aggs.map((a) => {
      const { label, action } = labelFor(a, thresholds)
      const fatigue = computeFatigue(a)
      const country = a.country || parseCountry(a.campaign_name, a.ad_name)
      return { ...a, label, action, fatigue, country }
    })
  }, [daily, appliedRange, thresholds])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    let out = rows.filter((r) => !q || r.ad_name?.toLowerCase().includes(q) || r.ad_id?.includes(q))
    if (labelFilter !== 'all') out = out.filter((r) => r.label === labelFilter.toUpperCase())
    if (creativeFilter === 'video') out = out.filter((r) => r.creative_type === 'VIDEO')
    if (creativeFilter === 'image') out = out.filter((r) => r.creative_type === 'IMAGE')
    if (countryFilter !== 'all') out = out.filter((r) => r.country === countryFilter)
    out.sort((a, b) => {
      const av = a[sort.key] ?? -Infinity, bv = b[sort.key] ?? -Infinity
      return sort.dir === 'asc' ? (av > bv ? 1 : -1) : av > bv ? -1 : 1
    })
    return out
  }, [rows, search, labelFilter, creativeFilter, countryFilter, sort])

  const COLUMNS = useMemo(() => {
    const conv = [
      { key: 'roas', label: 'ROAS', help: METRIC_HELP.roas, render: (r) => <span className={roasCls(r.roas, thresholds)}>{fmtRoas(r.roas)}</span> },
      { key: 'ctr', label: 'CTR', help: METRIC_HELP.ctr, render: (r) => fmtPct(r.ctr, 2) },
      ...(hideFinancial ? [] : [{ key: 'cpc', label: 'CPC enlace', help: METRIC_HELP.cpc, render: (r) => fmtEur2(r.cpc) }]),
      { key: 'frequency', label: 'Frecuencia', help: METRIC_HELP.frequency, render: (r) => (r.frequency || 0).toFixed(2) },
      ...(hideFinancial ? [] : [{ key: 'spend', label: 'Gasto', render: (r) => fmtEur(r.spend) }]),
    ]
    const video = [
      { key: 'roas', label: 'ROAS', help: METRIC_HELP.roas, render: (r) => <span className={roasCls(r.roas, thresholds)}>{fmtRoas(r.roas)}</span> },
      { key: 'hook_rate', label: 'Hook Rate', help: METRIC_HELP.hook_rate, render: (r) => (r.hook_rate ? <span className={rateCls(r.hook_rate, thresholds.hook_rate_good ?? 25, 18)}>{fmtPct(r.hook_rate)}</span> : '—') },
      { key: 'hold_rate', label: 'Hold Rate', help: METRIC_HELP.hold_rate, render: (r) => (r.hold_rate ? <span className={rateCls(r.hold_rate, thresholds.hold_rate_good ?? 12, 8)}>{fmtPct(r.hold_rate)}</span> : '—') },
      { key: 'ret_25', label: 'Ret. 25%', help: METRIC_HELP.ret, render: (r) => (r.ret_25 ? fmtPct(r.ret_25, 0) : '—') },
      { key: 'ret_50', label: 'Ret. 50%', help: METRIC_HELP.ret, render: (r) => (r.ret_50 ? fmtPct(r.ret_50, 0) : '—') },
      { key: 'ret_75', label: 'Ret. 75%', help: METRIC_HELP.ret, render: (r) => (r.ret_75 ? fmtPct(r.ret_75, 0) : '—') },
      { key: 'avg_watch_time', label: 'T. medio', help: METRIC_HELP.avg_watch, render: (r) => (r.avg_watch_time ? fmtSec(r.avg_watch_time) : '—') },
      { key: 'thruplay', label: 'ThruPlays', help: METRIC_HELP.thruplay, render: (r) => fmtNum(r.thruplay) },
    ]
    return mode === 'conversions' ? conv : video
  }, [mode, hideFinancial, thresholds])

  const defaultOrder = COLUMNS.map((c) => c.key)
  const [colOrder, setColOrder] = useState(null)
  const orderedColumns = (colOrder && mode === 'conversions' ? colOrder : defaultOrder)
    .map((k) => COLUMNS.find((c) => c.key === k))
    .filter(Boolean)
  const finalColumns = orderedColumns.length === COLUMNS.length ? orderedColumns : COLUMNS

  const toggleSort = (key) => {
    setSort((s) => {
      if (s.key !== key) return { key, dir: 'desc' }
      if (s.dir === 'desc') return { key, dir: 'asc' }
      return { key: 'spend', dir: 'desc' }
    })
  }

  const applyRange = () => {
    if (!dateStart || !dateEnd) return toast.error('Selecciona inicio y fin')
    const days = (new Date(dateEnd) - new Date(dateStart)) / 86400000
    if (days > 90) toast.warning('Rango >90 días: la query puede ser pesada y los labels menos comparables')
    setAppliedRange({ start: dateStart, end: dateEnd })
  }

  const doSync = async () => {
    setSyncing(true)
    try {
      const end = new Date().toISOString().slice(0, 10)
      const start = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
      const res = await syncMetaAds({ dateStart: start, dateEnd: end })
      toast.success(`Sync completado: ${res.ads} ads`)
    } finally { setSyncing(false) }
  }

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="AdsPerformance" />

      <div className="glass-card p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Nombre o ID del ad…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Input type="date" className="w-auto" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
          <Input type="date" className="w-auto" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
          <Button variant="outline" size="sm" onClick={applyRange}>Apply</Button>
          {appliedRange && <Button variant="ghost" size="sm" onClick={() => { setAppliedRange(null); setDateStart(''); setDateEnd('') }}>Clear</Button>}
          {!appliedRange && <span className="text-xs text-slate-400">últimos 7 días</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={labelFilter} onValueChange={setLabelFilter}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="winner">🏆 Winners</SelectItem>
              <SelectItem value="regular">➖ Regular</SelectItem>
              <SelectItem value="loser">❌ Losers</SelectItem>
              <SelectItem value="unscored">❓ Unscored</SelectItem>
            </SelectContent>
          </Select>
          <Select value={creativeFilter} onValueChange={setCreativeFilter}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo tipo</SelectItem>
              <SelectItem value="video">🎥 Vídeos</SelectItem>
              <SelectItem value="image">🖼️ Imágenes</SelectItem>
            </SelectContent>
          </Select>
          <Select value={countryFilter} onValueChange={setCountryFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">🌍 Todos países</SelectItem>
              <SelectItem value="ES">🇪🇸 España</SelectItem>
              <SelectItem value="MX">🇲🇽 México</SelectItem>
              <SelectItem value="US">🇺🇸 EE.UU.</SelectItem>
            </SelectContent>
          </Select>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="conversions">📊 Conversiones</SelectItem>
              <SelectItem value="video">🎥 Video Performance</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            {mode === 'conversions' && <ColumnOrderEditor columns={COLUMNS} order={colOrder || defaultOrder} onChange={setColOrder} />}
            <Button variant="outline" size="icon" title="Refresh" onClick={() => qc.invalidateQueries()}><RefreshCw /></Button>
            <Button variant="outline" onClick={() => setCsvOpen(true)}><FileSpreadsheet /> CSV</Button>
            {effectiveRole === 'ADMIN' && (
              <Button onClick={doSync} disabled={syncing}>{syncing ? <Loader2 className="animate-spin" /> : <Zap />} Sync Meta</Button>
            )}
          </div>
        </div>
      </div>

      <div className="glass-card overflow-x-auto scrollbar-thin">
        {filtered.length === 0 ? (
          <EmptyState icon={Search} title="Sin ads en este filtro" description="Ajusta filtros o sincroniza Meta." />
        ) : (
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-3 py-2.5 font-medium min-w-[220px]">Anuncio</th>
                <th className="px-3 py-2.5 font-medium">Label</th>
                {finalColumns.map((col) => (
                  <th key={col.key} className="px-3 py-2.5 font-medium whitespace-nowrap">
                    <MetricTooltip help={col.help}>
                      <button onClick={() => toggleSort(col.key)} className="inline-flex items-center gap-1 hover:text-slate-600">
                        {col.label}
                        {sort.key === col.key ? (sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-30" />}
                      </button>
                    </MetricTooltip>
                  </th>
                ))}
                <th className="px-3 py-2.5 font-medium">IA</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const st = statsById[r.ad_id]
                return (
                  <tr key={r.ad_id} className="border-b border-slate-50 hover:bg-indigo-50/30">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-slate-700 line-clamp-1 max-w-[320px]" title={r.ad_name}>{r.ad_name}</p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span title={{ ES: 'España', MX: 'México', US: 'Estados Unidos' }[r.country]}>{{ ES: '🇪🇸', MX: '🇲🇽', US: '🇺🇸' }[r.country] || ''}</span>
                        <span className="font-mono text-[10px] text-slate-400">{r.ad_id}</span>
                        {r.fatigue?.flag && <FatigueIndicator reasons={r.fatigue.reasons} severity={r.fatigue.severity} />}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span><PerformanceLabel label={r.label} action={r.action} /></span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="space-y-0.5">
                            <p>ROAS período: <b>{fmtRoas(r.roas)}</b></p>
                            {st?.best_roas_ever && <p>Best ROAS histórico: <b>{fmtRoas(st.best_roas_ever)}</b></p>}
                            <p>Thresholds: SCALE ≥{thresholds.roas_winner} · breakeven {thresholds.breakeven_roas ?? thresholds.roas_regular} · spend mín {thresholds.min_spend}€</p>
                            {thresholds.breakeven_roas && <p className="text-slate-300">Breakeven = 1/GM% (márgenes CashPilot, editable en Configuración)</p>}
                            {r.label === 'UNSCORED' && <p className="text-amber-300">Spend insuficiente para etiquetar</p>}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    {finalColumns.map((col) => (
                      <td key={col.key} className="whitespace-nowrap px-3 py-2.5 text-slate-600">{col.render(r)}</td>
                    ))}
                    <td className="px-3 py-2.5">
                      <AdAnalysisDialog ad={r} adStats={st} />
                    </td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => setDetailAd(r)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Ver detalle">
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-400">{filtered.length} ads · ratios agregados (suma/suma) — sin Breakdown Effect · financiero {hideFinancial ? 'oculto (rol EDITOR)' : 'visible'}</p>

      {detailAd && <AdDetailDialog ad={detailAd} daily={daily} hideFinancial={hideFinancial} onClose={() => setDetailAd(null)} />}
      <CsvImportDialog open={csvOpen} onOpenChange={setCsvOpen} />
    </div>
  )
}
