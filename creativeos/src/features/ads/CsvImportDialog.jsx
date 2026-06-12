// EXTRA TOP: importa el export CSV de Meta Ads Manager directamente,
// sin token de API. Mapea cabeceras ES/EN de forma tolerante.

import { useState } from 'react'
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { AdsPerformanceDaily, SyncRuns } from '@/api/entities'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'

const HEADER_MAP = [
  { key: 'date', match: ['día', 'dia', 'day', 'fecha', 'date', 'reporting starts', 'inicio del informe'] },
  { key: 'ad_id', match: ['identificador del anuncio', 'ad id'] },
  { key: 'ad_name', match: ['nombre del anuncio', 'ad name'] },
  { key: 'campaign_name', match: ['nombre de la campaña', 'campaign name'] },
  { key: 'spend', match: ['importe gastado', 'amount spent', 'gasto'] },
  { key: 'impressions', match: ['impresiones', 'impressions'] },
  { key: 'reach', match: ['alcance', 'reach'] },
  { key: 'frequency', match: ['frecuencia', 'frequency'] },
  { key: 'link_clicks', match: ['clics en el enlace', 'link clicks'] },
  { key: 'clicks', match: ['clics (todos)', 'clicks (all)'] },
  { key: 'conversions', match: ['compras', 'purchases', 'resultados', 'results'] },
  { key: 'conversion_value', match: ['valor de conversión de compras', 'purchases conversion value', 'valor de conversión'] },
  { key: 'video_plays', match: ['reproducciones de video', 'reproducciones de vídeo', 'video plays'] },
  { key: 'video_3s', match: ['reproducciones de video de 3 segundos', 'reproducciones de vídeo de 3 segundos', '3-second video plays'] },
  { key: 'thruplay', match: ['thruplay', 'thruplays'] },
  { key: 'video_p25', match: ['reproducciones de video hasta el 25', 'video plays at 25'] },
  { key: 'video_p50', match: ['reproducciones de video hasta el 50', 'video plays at 50'] },
  { key: 'video_p75', match: ['reproducciones de video hasta el 75', 'video plays at 75'] },
  { key: 'avg_watch_time', match: ['tiempo promedio de reproducción', 'average play time'] },
]

function detectDelimiter(line) {
  const counts = [
    [';', (line.match(/;/g) || []).length],
    [',', (line.match(/,/g) || []).length],
    ['\t', (line.match(/\t/g) || []).length],
  ]
  return counts.sort((a, b) => b[1] - a[1])[0][0]
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) throw new Error('CSV vacío o sin filas de datos')
  const delim = detectDelimiter(lines[0])
  const split = (line) => {
    const out = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') inQ = !inQ
      else if (ch === delim && !inQ) { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur)
    return out.map((s) => s.trim().replace(/^"|"$/g, ''))
  }
  const headers = split(lines[0]).map((h) => h.toLowerCase())
  const colIdx = {}
  HEADER_MAP.forEach(({ key, match }) => {
    const idx = headers.findIndex((h) => match.some((m) => h.startsWith(m)))
    if (idx !== -1) colIdx[key] = idx
  })
  if (colIdx.ad_name == null || colIdx.spend == null) throw new Error('Cabeceras no reconocidas: necesita al menos "Nombre del anuncio" e "Importe gastado"')
  const num = (v) => {
    if (!v) return 0
    return parseFloat(String(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')) || parseFloat(v) || 0
  }
  return lines.slice(1).map(split).map((cells) => {
    const get = (k) => (colIdx[k] != null ? cells[colIdx[k]] : '')
    return {
      date: get('date')?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      ad_id: get('ad_id') || `csv_${get('ad_name')?.slice(0, 24).replace(/\W+/g, '_')}`,
      ad_name: get('ad_name'), campaign_name: get('campaign_name'),
      creative_type: /video|v\d/i.test(get('ad_name')) ? 'VIDEO' : 'IMAGE',
      spend: num(get('spend')), impressions: Math.round(num(get('impressions'))), reach: Math.round(num(get('reach'))),
      frequency: num(get('frequency')), link_clicks: Math.round(num(get('link_clicks'))), clicks: Math.round(num(get('clicks'))),
      conversions: Math.round(num(get('conversions'))), conversion_value: num(get('conversion_value')),
      video_plays: Math.round(num(get('video_plays'))), video_3s: Math.round(num(get('video_3s'))),
      thruplay: Math.round(num(get('thruplay'))), video_p25: Math.round(num(get('video_p25'))),
      video_p50: Math.round(num(get('video_p50'))), video_p75: Math.round(num(get('video_p75'))),
      avg_watch_time: num(get('avg_watch_time')),
    }
  }).filter((r) => r.ad_name)
}

export default function CsvImportDialog({ open, onOpenChange, onImported }) {
  const [file, setFile] = useState(null)
  const [importing, setImporting] = useState(false)

  const doImport = async () => {
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      if (!rows.length) throw new Error('0 filas válidas')
      await AdsPerformanceDaily.bulkCreate(rows)
      await SyncRuns.create({ run_type: 'CSV_IMPORT', status: 'SUCCESS', detail: `${rows.length} filas de ${file.name}`, duration_ms: 500 })
      toast.success(`Importadas ${rows.length} filas de ${new Set(rows.map((r) => r.ad_id)).size} ads`)
      onImported?.()
      onOpenChange(false)
      setFile(null)
    } catch (e) {
      toast.error(`Error importando CSV: ${e.message}`)
    } finally { setImporting(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-emerald-500" /> Importar CSV de Meta</DialogTitle>
          <DialogDescription>
            Export de Ads Manager con desglose por día. Acepta cabeceras en español o inglés. Alternativa al sync por API — sin token.
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 py-10 hover:border-emerald-400 hover:bg-emerald-50/40">
          <Upload className="h-8 w-8 text-emerald-400" />
          <span className="text-sm font-medium text-slate-700">{file ? file.name : 'Selecciona el CSV exportado'}</span>
          <input type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <DialogFooter>
          <Button onClick={doImport} disabled={!file || importing}>
            {importing && <Loader2 className="animate-spin" />} Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
