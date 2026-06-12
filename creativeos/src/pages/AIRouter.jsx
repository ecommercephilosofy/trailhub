import { useEffect, useState } from 'react'
import { Route, Save, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Settings as SettingsEntity, getSettings } from '@/api/entities'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoadingSpinner } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'

const MODELS = [
  { id: 'claude-fable-5', tier: 'Frontier', note: 'Máxima calidad creativa — scripts finales' },
  { id: 'claude-opus-4-8', tier: 'Frontier', note: 'Razonamiento profundo — research' },
  { id: 'claude-sonnet-4-6', tier: 'Balanced', note: 'Calidad/coste — análisis recurrente' },
  { id: 'claude-haiku-4-5', tier: 'Fast', note: 'Barato y rápido — extracción, briefs' },
  { id: 'gpt-4o', tier: 'Balanced', note: 'Alternativa multimodal' },
  { id: 'gemini-2.0-pro', tier: 'Balanced', note: 'Contexto largo' },
  { id: 'perplexity-sonar', tier: 'Search', note: 'Research con web en vivo' },
]

const TASKS = [
  { key: 'script_generation', label: 'Generación de scripts', desc: 'Creatividad máxima. El output va directo a producción.' },
  { key: 'ad_analysis', label: 'Análisis de ads', desc: 'Diagnóstico de métricas + recomendaciones. Corre en cada análisis manual.' },
  { key: 'market_research', label: 'Investigación de mercado', desc: 'Razonamiento largo sobre fuentes. Baja frecuencia, alto valor.' },
  { key: 'pdf_extraction', label: 'Extracción de PDFs', desc: 'Estructurar research. Tarea mecánica — modelo rápido.' },
  { key: 'pattern_mining', label: 'Minería de patrones', desc: 'Cruza ads + scripts buscando señales. Corre tras cada sync.' },
  { key: 'brief_writing', label: 'Redacción de briefs', desc: 'Brief para editores desde script aprobado.' },
]

const TIER_CLS = { Frontier: 'bg-indigo-100 text-indigo-700', Balanced: 'bg-emerald-100 text-emerald-700', Fast: 'bg-amber-100 text-amber-700', Search: 'bg-cyan-100 text-cyan-700' }

export default function AIRouter() {
  const [settings, setSettings] = useState(null)
  const [config, setConfig] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { getSettings().then((s) => { setSettings(s); setConfig(s?.ai_router_config || {}) }) }, [])
  if (!config) return <LoadingSpinner size="lg" />

  const save = async () => {
    setSaving(true)
    try {
      await SettingsEntity.update(settings.id, { ai_router_config: config })
      toast.success('Router actualizado')
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4 animate-fade-in max-w-3xl">
      <PageGuide pageName="AIRouter" />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Route className="h-4 w-4 text-indigo-500" /> Modelo por tarea</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {TASKS.map((t) => {
            const model = MODELS.find((m) => m.id === (config[t.key] || MODELS[0].id))
            return (
              <div key={t.key} className="rounded-xl border border-slate-100 bg-white/60 p-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[180px] flex-1">
                    <p className="text-sm font-medium text-slate-800">{t.label}</p>
                    <p className="text-xs text-slate-400">{t.desc}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${TIER_CLS[model?.tier] || 'bg-slate-100'}`}>{model?.tier}</span>
                  <Select value={config[t.key] || MODELS[0].id} onValueChange={(v) => setConfig({ ...config, [t.key]: v })}>
                    <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODELS.map((m) => <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {model?.note && <p className="mt-1.5 text-[11px] text-slate-400">→ {model.note}</p>}
              </div>
            )
          })}
        </CardContent>
      </Card>
      <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Save />} Guardar router</Button>
    </div>
  )
}
