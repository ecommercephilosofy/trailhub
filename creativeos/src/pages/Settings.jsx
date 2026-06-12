import { useEffect, useState } from 'react'
import { Bot, Cloud, KeyRound, MessageCircle, Mic2, Save, SlidersHorizontal, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Settings as SettingsEntity, getSettings } from '@/api/entities'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoadingSpinner } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'

const MODELS = ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'gpt-4o', 'gemini-2.0-pro', 'perplexity-sonar']
const AI_TASKS = [
  ['script_generation', 'Generación de scripts'],
  ['ad_analysis', 'Análisis de ads'],
  ['market_research', 'Investigación de mercado'],
  ['pdf_extraction', 'Extracción de PDFs'],
  ['pattern_mining', 'Minería de patrones'],
  ['brief_writing', 'Redacción de briefs'],
]

function Field({ label, children }) {
  return <div><Label className="text-xs">{label}</Label><div className="mt-1">{children}</div></div>
}

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { getSettings().then((s) => { setSettings(s); setForm(s) }) }, [])
  if (!form) return <LoadingSpinner size="lg" />

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setT = (k, v) => setForm((f) => ({ ...f, metric_thresholds_manual: { ...f.metric_thresholds_manual, [k]: v === '' ? '' : Number(v) } }))
  const setRouter = (task, model) => setForm((f) => ({ ...f, ai_router_config: { ...f.ai_router_config, [task]: model } }))

  const save = async () => {
    setSaving(true)
    try {
      const { id, ...payload } = form
      await SettingsEntity.update(settings.id, payload)
      toast.success('Configuración guardada')
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4 animate-fade-in max-w-4xl">
      <PageGuide pageName="Settings" />
      <Tabs defaultValue="meta">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="meta"><Cloud className="h-3.5 w-3.5" /> Meta API</TabsTrigger>
          <TabsTrigger value="ai"><Bot className="h-3.5 w-3.5" /> AI Models</TabsTrigger>
          <TabsTrigger value="generation"><Wand2 className="h-3.5 w-3.5" /> Generación</TabsTrigger>
          <TabsTrigger value="thresholds"><SlidersHorizontal className="h-3.5 w-3.5" /> Thresholds</TabsTrigger>
          <TabsTrigger value="brand"><Mic2 className="h-3.5 w-3.5" /> Brand Voice</TabsTrigger>
          <TabsTrigger value="discord"><MessageCircle className="h-3.5 w-3.5" /> Discord</TabsTrigger>
          <TabsTrigger value="drive"><KeyRound className="h-3.5 w-3.5" /> Drive</TabsTrigger>
        </TabsList>

        <TabsContent value="meta" className="glass-card p-5 space-y-3">
          <Field label="Ad Account ID"><Input value={form.meta_ad_account_id || ''} onChange={(e) => set('meta_ad_account_id', e.target.value)} placeholder="act_…" /></Field>
          <Field label="Access Token"><Input type="password" value={form.meta_access_token || ''} onChange={(e) => set('meta_access_token', e.target.value)} placeholder="EAAB…" /></Field>
          <Field label="API Version"><Input value={form.meta_api_version || ''} onChange={(e) => set('meta_api_version', e.target.value)} placeholder="v21.0" /></Field>
          <p className="text-xs text-slate-400">Scopes necesarios: ads_read, business_management. Sin token también puedes importar CSV desde Ads Performance.</p>
        </TabsContent>

        <TabsContent value="ai" className="glass-card p-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Claude API Key"><Input type="password" value={form.claude_api_key || ''} onChange={(e) => set('claude_api_key', e.target.value)} /></Field>
            <Field label="OpenAI API Key"><Input type="password" value={form.openai_api_key || ''} onChange={(e) => set('openai_api_key', e.target.value)} /></Field>
            <Field label="Perplexity API Key"><Input type="password" value={form.perplexity_api_key || ''} onChange={(e) => set('perplexity_api_key', e.target.value)} /></Field>
            <Field label="Gemini API Key"><Input type="password" value={form.gemini_api_key || ''} onChange={(e) => set('gemini_api_key', e.target.value)} /></Field>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2">Modelo por tarea (AI Router)</p>
            <div className="space-y-2">
              {AI_TASKS.map(([task, label]) => (
                <div key={task} className="flex items-center gap-3">
                  <span className="w-48 text-sm text-slate-600">{label}</span>
                  <Select value={form.ai_router_config?.[task] || MODELS[0]} onValueChange={(v) => setRouter(task, v)}>
                    <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="generation" className="glass-card p-5 grid gap-3 sm:grid-cols-2">
          <Field label="Límite diario de scripts"><Input type="number" value={form.daily_script_limit ?? 10} onChange={(e) => set('daily_script_limit', Number(e.target.value))} /></Field>
          <Field label="Idioma por defecto"><Input value={form.language_default || 'es'} onChange={(e) => set('language_default', e.target.value)} /></Field>
          <Field label="Frecuencia de generación">
            <Select value={form.generation_frequency || 'DAILY'} onValueChange={(v) => set('generation_frequency', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="DAILY">Diaria</SelectItem><SelectItem value="WEEKLY">Semanal</SelectItem><SelectItem value="MANUAL">Manual</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Hora local de ejecución"><Input type="time" value={form.run_time_local || '07:30'} onChange={(e) => set('run_time_local', e.target.value)} /></Field>
        </TabsContent>

        <TabsContent value="thresholds" className="glass-card p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Label className="text-xs">Modo de scoring</Label>
            <Select value={form.scoring_mode || 'MANUAL'} onValueChange={(v) => set('scoring_mode', v)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MANUAL">MANUAL (fijo)</SelectItem>
                <SelectItem value="PERCENTILE">PERCENTILE (relativo)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="ROAS Winner ≥"><Input type="number" step="0.1" value={form.metric_thresholds_manual?.roas_winner ?? 2.5} onChange={(e) => setT('roas_winner', e.target.value)} /></Field>
            <Field label="ROAS Regular ≥"><Input type="number" step="0.1" value={form.metric_thresholds_manual?.roas_regular ?? 1.5} onChange={(e) => setT('roas_regular', e.target.value)} /></Field>
            <Field label="Spend mínimo (€)"><Input type="number" value={form.metric_thresholds_manual?.min_spend ?? 50} onChange={(e) => setT('min_spend', e.target.value)} /></Field>
            <Field label="Hook rate bueno (%)"><Input type="number" value={form.metric_thresholds_manual?.hook_rate_good ?? 25} onChange={(e) => setT('hook_rate_good', e.target.value)} /></Field>
            <Field label="Hold rate bueno (%)"><Input type="number" value={form.metric_thresholds_manual?.hold_rate_good ?? 12} onChange={(e) => setT('hold_rate_good', e.target.value)} /></Field>
            <Field label="CPA máximo (€)"><Input type="number" value={form.metric_thresholds_manual?.cpa_max ?? 15} onChange={(e) => setT('cpa_max', e.target.value)} /></Field>
          </div>

          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-3">
            <p className="text-sm font-medium text-slate-700">Márgenes (unit economics CashPilot)</p>
            <p className="text-xs text-slate-500">SCALE / ITERATE / KILL se calculan desde el breakeven ROAS = 1 / (1 − COGS% − fees%). Los campos "ROAS Winner/Regular" de arriba quedan anulados mientras esto esté configurado.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="COGS (%)"><Input type="number" step="0.5" value={form.margin_config?.cogs_pct ?? 16} onChange={(e) => set('margin_config', { ...form.margin_config, cogs_pct: Number(e.target.value) })} /></Field>
              <Field label="Fees + reserva (%)"><Input type="number" step="0.5" value={form.margin_config?.fees_pct ?? 6} onChange={(e) => set('margin_config', { ...form.margin_config, fees_pct: Number(e.target.value) })} /></Field>
              <Field label="Multiplicador SCALE"><Input type="number" step="0.1" value={form.margin_config?.scale_mult ?? 1.4} onChange={(e) => set('margin_config', { ...form.margin_config, scale_mult: Number(e.target.value) })} /></Field>
            </div>
            {(() => {
              const gm = 1 - ((form.margin_config?.cogs_pct ?? 16) + (form.margin_config?.fees_pct ?? 6)) / 100
              const be = gm > 0 ? 1 / gm : null
              return be ? (
                <p className="text-xs text-slate-600">
                  GM <b>{(gm * 100).toFixed(0)}%</b> → breakeven ROAS <b>{be.toFixed(2)}x</b> · KILL &lt; {be.toFixed(2)} · ITERATE {be.toFixed(2)}–{(be * (form.margin_config?.scale_mult ?? 1.4)).toFixed(2)} · SCALE ≥ <b>{(be * (form.margin_config?.scale_mult ?? 1.4)).toFixed(2)}x</b>
                </p>
              ) : <p className="text-xs text-red-500">Margen ≤ 0: ningún ROAS es rentable</p>
            })()}
          </div>
        </TabsContent>

        <TabsContent value="brand" className="glass-card p-5 space-y-3">
          <Field label="Claims prohibidos (uno por línea)">
            <Textarea rows={3} value={(form.banned_claims || []).join('\n')} onChange={(e) => set('banned_claims', e.target.value.split('\n').filter(Boolean))} />
          </Field>
          <Field label="Reglas de brand voice">
            <Textarea rows={4} value={form.brand_voice_rules || ''} onChange={(e) => set('brand_voice_rules', e.target.value)} />
          </Field>
          <Field label="Reglas por producto (JSON)">
            <Textarea rows={4} className="font-mono text-xs" value={JSON.stringify(form.product_rules || {}, null, 2)} onChange={(e) => { try { set('product_rules', JSON.parse(e.target.value)) } catch {} }} />
          </Field>
        </TabsContent>

        <TabsContent value="discord" className="glass-card p-5 space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white/60 px-3 py-2.5">
            <span className="text-sm text-slate-700">Notificaciones Discord activas</span>
            <Switch checked={!!form.discord_notifications_enabled} onCheckedChange={(v) => set('discord_notifications_enabled', v)} />
          </div>
          <Field label="Webhook scripts"><Input value={form.discord_webhook_scripts || ''} onChange={(e) => set('discord_webhook_scripts', e.target.value)} placeholder="https://discord.com/api/webhooks/…" /></Field>
          <Field label="Webhook alertas"><Input value={form.discord_webhook_alerts || ''} onChange={(e) => set('discord_webhook_alerts', e.target.value)} /></Field>
          <Field label="Webhook tareas"><Input value={form.discord_webhook_tasks || ''} onChange={(e) => set('discord_webhook_tasks', e.target.value)} /></Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Resumen diario</span>
              <Switch checked={!!form.daily_summary_enabled} onCheckedChange={(v) => set('daily_summary_enabled', v)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Posts de delivery</span>
              <Switch checked={!!form.delivery_posts_enabled} onCheckedChange={(v) => set('delivery_posts_enabled', v)} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="drive" className="glass-card p-5 space-y-3">
          <Field label="Folder ID — Script Library"><Input value={form.drive_folder_script_library || ''} onChange={(e) => set('drive_folder_script_library', e.target.value)} /></Field>
          <Field label="Folder ID — Generated Scripts"><Input value={form.drive_folder_generated || ''} onChange={(e) => set('drive_folder_generated', e.target.value)} /></Field>
        </TabsContent>
      </Tabs>

      <Button onClick={save} disabled={saving}><Save /> Guardar configuración</Button>
    </div>
  )
}
