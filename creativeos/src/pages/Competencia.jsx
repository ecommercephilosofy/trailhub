// Mecanismos de competencia/inspiración — publicados automáticamente cada lunes
// por el pipeline (frames + voz analizados). Extraemos MECANISMOS, no copies.
import { useMemo, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useEntityList } from '@/hooks/useData'
import { Mechanisms, Brands, BrandProfiles, TtScalingAds, TtBrandSnapshots, TtBrandSuggestions } from '@/api/entities'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState, ErrorState } from '@/components/shared/misc'
import { Switch } from '@/components/ui/switch'
import { Telescope, ExternalLink, Plus, Trash2, Power, Sparkles, Radar, Lightbulb, Check, X } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { useBrand } from '@/context/BrandContext'

function normalizeDomain(raw) {
  return (raw || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
}

function AdLibraryLink({ domain }) {
  const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=${encodeURIComponent(domain)}&search_type=keyword_unordered&media_type=all`
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-500 hover:underline">
      ver ads en Ad Library ↗
    </a>
  )
}

function BrandsPanel({ kind, isAdmin }) {
  const { brand: brandCfg } = useBrand()
  const ph = brandCfg.competitorPlaceholder
  const { data: brands, refetch } = useEntityList(Brands, { filter: { kind }, sort: 'priority' })
  const [open, setOpen] = useState(false)
  const [domain, setDomain] = useState('')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')

  const add = async () => {
    const d = normalizeDomain(domain)
    if (!d || !d.includes('.')) return toast.error(`Dominio inválido (ej. ${ph})`)
    try {
      await Brands.create({ domain: d, name: name.trim() || d, kind,
                            priority: 3, notes: notes.trim() || null, is_active: true })
      toast.success(`${d} añadida — entra en el próximo run del lunes`)
      setDomain(''); setName(''); setNotes(''); setOpen(false); refetch()
    } catch (e) {
      toast.error(e.message.includes('duplicate') ? 'Ya existe esa marca' : e.message)
    }
  }
  const toggle = async (b) => {
    try { await Brands.update(b.id, { is_active: !b.is_active }); refetch() }
    catch (e) { toast.error(e.message) }
  }
  const remove = async (b) => {
    if (!confirm(`¿Quitar ${b.domain}? (se puede volver a añadir)`)) return
    try { await Brands.delete(b.id); refetch() }
    catch (e) { toast.error(e.message) }
  }

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-500 uppercase">
            Marcas monitorizadas ({(brands || []).filter((b) => b.is_active).length} activas)
          </p>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Añadir marca
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(brands || []).map((b) => (
            <span key={b.id}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                    b.is_active ? 'bg-white border-slate-200 text-slate-700' : 'bg-slate-50 border-slate-200 text-slate-400 line-through'}`}>
              <span title={b.notes || ''}>{b.domain}</span>
              {isAdmin && (
                <>
                  <button onClick={() => toggle(b)} title={b.is_active ? 'Desactivar' : 'Activar'}
                          className="text-slate-400 hover:text-slate-700"><Power className="h-3 w-3" /></button>
                  <button onClick={() => remove(b)} title="Quitar"
                          className="text-slate-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
                </>
              )}
            </span>
          ))}
          {!brands?.length && <span className="text-xs text-slate-400">Ninguna aún.</span>}
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Añadir marca de {kind === 'competitor' ? 'competencia' : 'inspiración'}</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Input value={domain} onChange={(e) => setDomain(e.target.value)}
                     placeholder={`dominio (ej. ${ph})`} autoFocus />
              <Input value={name} onChange={(e) => setName(e.target.value)}
                     placeholder="nombre (opcional)" />
              <Input value={notes} onChange={(e) => setNotes(e.target.value)}
                     placeholder="notas (opcional)" />
              <p className="text-[11px] text-slate-500">
                El scraper busca por dominio en la Ad Library (US) — pilla todas las
                fanpages-persona que redirigen ahí. Efecto: próximo lunes.
              </p>
              <Button onClick={add} className="w-full">Añadir</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

// ── Radar Trendtrack ─────────────────────────────────────────────────────────
// Señales de la API de trendtrack.io publicadas cada lunes por el pipeline.
// `duplicates` = nº de copias activas del MISMO creativo = la marca lo está
// financiando ahora (señal de scaling válida en US, donde no hay reach DSA).

function RadarPanel({ kind }) {
  const { data: ads } = useEntityList(TtScalingAds, { sort: '-week_date', limit: 300 })
  const { data: snaps } = useEntityList(TtBrandSnapshots, { sort: '-week_date', limit: 60 })
  const [expandedBrand, setExpandedBrand] = useState(null)

  const week = ads?.[0]?.week_date
  const weekAds = (ads || []).filter((a) => a.week_date === week && (a.kind || 'competitor') === kind)
  const weekSnaps = (snaps || []).filter((s) => s.week_date === week && (s.kind || 'competitor') === kind)
  const snapByBrand = Object.fromEntries(weekSnaps.map((s) => [s.brand, s]))

  const byBrand = useMemo(() => {
    const g = {}
    for (const a of weekAds) (g[a.brand] ||= []).push(a)
    for (const b of Object.keys(g)) g[b].sort((x, y) => (y.duplicates || 0) - (x.duplicates || 0))
    // marcas con más scaling primero (max duplicates)
    return Object.entries(g).sort((x, y) =>
      (y[1][0]?.duplicates || 0) - (x[1][0]?.duplicates || 0))
  }, [weekAds])

  if (!weekAds.length) return null
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
            <Radar className="h-3.5 w-3.5 text-indigo-500" /> Radar Trendtrack — qué están escalando
          </p>
          <span className="text-[11px] text-slate-400">semana {week}</span>
        </div>
        <p className="text-[11px] text-slate-400">
          <b>Duplicados</b> = copias activas del mismo creativo: la marca lo está financiando AHORA.
          Duplicados + días = su winner confirmado → candidato #1 a extraer mecanismo.
        </p>
        <div className="space-y-2">
          {byBrand.map(([b, list]) => {
            const snap = snapByBrand[b]
            const open = expandedBrand === b
            return (
              <div key={b} className="rounded-lg border border-slate-100">
                <button onClick={() => setExpandedBrand(open ? null : b)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50">
                  <span className="font-medium text-sm text-slate-800">{b}</span>
                  <Badge variant="outline" className="text-[10px]">{list.length} ads top</Badge>
                  {list[0]?.duplicates != null && (
                    <Badge className="bg-amber-100 text-amber-800 text-[10px] hover:bg-amber-100">
                      máx {list[0].duplicates} duplicados
                    </Badge>
                  )}
                  {snap?.testing?.length > 0 && (
                    <Badge className="bg-indigo-100 text-indigo-700 text-[10px] hover:bg-indigo-100">
                      {snap.testing.length} batches testing
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-slate-400">{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <div className="border-t border-slate-100 px-3 py-2 space-y-2">
                    {list.slice(0, 6).map((a) => (
                      <div key={a.library_id} className="flex items-start gap-2 text-xs">
                        <span className="shrink-0 rounded bg-amber-50 border border-amber-100 px-1.5 py-0.5 text-amber-800 font-medium">
                          ×{a.duplicates ?? '?'}
                        </span>
                        <div className="min-w-0">
                          <p className="text-slate-700 truncate">
                            {a.headline || a.body || '(sin copy)'}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {a.days_running != null && `${a.days_running}d rodando`}
                            {a.current_rank != null && ` · rank #${a.current_rank}`}
                            {a.library_id && !/^\D/.test(a.library_id) && (
                              <> · <a target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline"
                                      href={`https://www.facebook.com/ads/library/?id=${a.library_id}`}>ver ad ↗</a></>
                            )}
                          </p>
                        </div>
                      </div>
                    ))}
                    {snap?.hooks?.length > 0 && (
                      <div className="pt-1 border-t border-slate-50">
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Hooks que más repiten</p>
                        <div className="flex flex-wrap gap-1">
                          {snap.hooks.slice(0, 5).map((h, i) => (
                            <span key={i} className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                              «{h.hook}»{h.usage_count > 1 && <span className="text-[9px] text-slate-400"> ×{h.usage_count}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// Sugerencias del descubrimiento mensual (similar shops + rising-star).
// El ADMIN acepta (→ alta en brands, entra el próximo lunes) o descarta.
function SuggestionsPanel({ isAdmin }) {
  const { data: suggestions, refetch } = useEntityList(TtBrandSuggestions,
    { filter: { status: 'pending' }, sort: '-suggested_at' })
  if (!suggestions?.length) return null

  const resolve = async (s, accept) => {
    try {
      if (accept) {
        await Brands.create({ domain: s.domain, name: s.name || s.domain,
                              kind: s.suggested_kind || 'inspiration', priority: 3,
                              notes: `sugerida por Trendtrack (${s.source})`, is_active: true })
      }
      await TtBrandSuggestions.update(s.domain,
        { status: accept ? 'accepted' : 'dismissed', resolved_at: new Date().toISOString() })
      toast.success(accept ? `${s.domain} añadida — entra el próximo lunes` : `${s.domain} descartada`)
      refetch()
    } catch (e) {
      toast.error(e.message.includes('duplicate') ? 'Ya existe esa marca' : e.message)
    }
  }

  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        <p className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500" /> Marcas sugeridas ({suggestions.length})
        </p>
        {suggestions.map((s) => (
          <div key={s.domain} className="flex items-center gap-2 text-sm border border-slate-100 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="font-medium text-slate-800">{s.name || s.domain}
                <span className="ml-2 text-[10px] text-slate-400">{s.domain}</span></p>
              <p className="text-[11px] text-slate-500">
                {s.source === 'similar_shops' ? 'tienda similar a las monitorizadas' : 'anunciante en crecimiento del nicho'}
                {s.evidence?.reason && ` — ${s.evidence.reason}`}
              </p>
            </div>
            {isAdmin && (
              <div className="ml-auto flex gap-1.5 shrink-0">
                <Button size="sm" variant="outline" onClick={() => resolve(s, true)}>
                  <Check className="h-3.5 w-3.5" /> Añadir
                </Button>
                <Button size="sm" variant="ghost" onClick={() => resolve(s, false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

const KIND_TABS = [
  { key: 'competitor', label: '⚔️ Competencia directa', hint: 'mismo problema, mismo target — qué les funciona' },
  { key: 'inspiration', label: '💡 Inspiración', hint: 'marcas adyacentes — mecanismos que robar (nunca copiar copy)' },
]

// Clases estáticas por color: Tailwind no compila clases interpoladas
// (`bg-${color}-50` no existe en el build) — con template strings los chips
// salían sin estilo en producción.
const CHIP_STYLE = {
  indigo: 'bg-indigo-50 border-indigo-100 text-indigo-800',
  purple: 'bg-purple-50 border-purple-100 text-purple-800',
  emerald: 'bg-emerald-50 border-emerald-100 text-emerald-800',
  amber: 'bg-amber-50 border-amber-100 text-amber-800',
  rose: 'bg-rose-50 border-rose-100 text-rose-800',
  slate: 'bg-slate-50 border-slate-100 text-slate-800',
}

function TopChips({ items, color = 'indigo' }) {
  if (!items?.length) return <span className="text-xs text-slate-400">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it, i) => (
        <span key={i} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${CHIP_STYLE[color] || CHIP_STYLE.indigo}`}>
          {it.name}{it.count > 1 && <span className="text-[9px] text-slate-400">×{it.count}</span>}
        </span>
      ))}
    </div>
  )
}

function BrandProfileDrawer({ brand, onClose }) {
  const { data: profiles } = useEntityList(BrandProfiles, { filter: { brand }, enabled: !!brand })
  const p = profiles?.[0]
  if (!brand) return null
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-500" /> {brand}
            <AdLibraryLink domain={brand} />
          </DialogTitle>
        </DialogHeader>
        {!p ? (
          <p className="text-sm text-slate-500">
            Sin perfil todavía — se construye tras el primer análisis del lunes.
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-4 text-xs text-slate-500 border-b border-slate-100 pb-2">
              <span><b>{p.ads_analyzed}</b> ads analizados</span>
              <span><b>{p.active_ads_analyzed}</b> activos</span>
              <span><b>{p.weeks_analyzed}</b> semanas</span>
              {p.first_seen_week && <span>desde {p.first_seen_week}</span>}
            </div>
            {p.what_they_sell && (
              <div><p className="text-xs font-bold text-slate-500 uppercase mb-1">Qué venden</p>
                <p>{p.what_they_sell}</p></div>
            )}
            {p.target_avatar && (
              <div><p className="text-xs font-bold text-slate-500 uppercase mb-1">A quién le hablan</p>
                <p>{p.target_avatar}</p></div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div><p className="text-xs font-bold text-slate-500 uppercase mb-1">Ángulos que usan</p>
                <TopChips items={p.top_angles} color="purple" /></div>
              <div><p className="text-xs font-bold text-slate-500 uppercase mb-1">Ofertas típicas</p>
                <TopChips items={p.top_offers} color="emerald" /></div>
              <div><p className="text-xs font-bold text-slate-500 uppercase mb-1">Hooks que repiten</p>
                <TopChips items={p.top_hooks} color="amber" /></div>
              <div><p className="text-xs font-bold text-slate-500 uppercase mb-1">Estructuras narrativas</p>
                <TopChips items={p.top_structures} color="indigo" /></div>
              <div><p className="text-xs font-bold text-slate-500 uppercase mb-1">Framings emocionales</p>
                <TopChips items={p.top_framings} color="rose" /></div>
              <div><p className="text-xs font-bold text-slate-500 uppercase mb-1">Formatos que usan</p>
                <TopChips items={p.top_formats} color="slate" /></div>
            </div>
            {p.language_style && (
              <div><p className="text-xs font-bold text-slate-500 uppercase mb-1">Estilo de lenguaje</p>
                <p>{p.language_style}</p></div>
            )}
            {p.key_phrases?.length > 0 && (
              <div><p className="text-xs font-bold text-slate-500 uppercase mb-1">Frases/palabras clave</p>
                <div className="flex flex-wrap gap-1">
                  {p.key_phrases.map((k, i) =>
                    <span key={i} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">«{k}»</span>)}
                </div></div>
            )}
            {p.longest_running_ad && (
              <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3">
                <p className="text-xs font-bold text-amber-800 mb-1">🏆 Winner longevo</p>
                <p className="text-sm">{p.longest_running_ad.hook}</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  {p.longest_running_ad.days ? `${p.longest_running_ad.days} días rodando` : ''}
                  {p.longest_running_ad.library_id && (
                    <> · <a target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline"
                            href={`https://www.facebook.com/ads/library/?id=${p.longest_running_ad.library_id}`}>ver ad ↗</a></>
                  )}
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function Competencia() {
  const { brand: brandCfg } = useBrand()
  const { effectiveRole } = useAuth()
  const isAdmin = effectiveRole === 'ADMIN'
  const { data: mechanisms, error } = useEntityList(Mechanisms, { sort: '-week_date', limit: 300 })
  const [brand, setBrand] = useState('all')
  const [kind, setKind] = useState('competitor')
  const [onlyActive, setOnlyActive] = useState(false)
  const [profileBrand, setProfileBrand] = useState(null)

  const byKind = (mechanisms || []).filter((m) => (m.kind || 'competitor') === kind)
  const brands = useMemo(() => [...new Set(byKind.map((m) => m.brand).filter(Boolean))].sort(), [byKind])
  const visible = byKind
    .filter((m) => brand === 'all' || m.brand === brand)
    .filter((m) => !onlyActive || m.is_active !== false)

  if (error) return <ErrorState error={error} />
  if (!mechanisms?.length) {
    return <EmptyState icon={Telescope} title="Sin mecanismos todavía"
      description="Cada lunes el pipeline analiza los mejores creativos nuevos de competencia e inspiración y publica aquí sus mecanismos." />
  }

  const activeTab = KIND_TABS.find((t) => t.key === kind)
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {KIND_TABS.map((t) => (
          <button key={t.key} onClick={() => { setKind(t.key); setBrand('all') }}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    kind === t.key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-400">{activeTab?.hint}</p>
      <BrandsPanel kind={kind} isAdmin={isAdmin} />
      <SuggestionsPanel isAdmin={isAdmin} />
      <RadarPanel kind={kind} />
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-slate-500">Marca:</span>
        <Select value={brand} onValueChange={setBrand}>
          <SelectTrigger className="h-8 w-[200px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-xs text-slate-600 ml-2">
          <Switch checked={onlyActive} onCheckedChange={setOnlyActive} /> solo activos
        </label>
        {brand !== 'all' && (
          <Button size="sm" variant="outline" onClick={() => setProfileBrand(brand)}>
            <Sparkles className="h-3.5 w-3.5" /> Perfil de la marca
          </Button>
        )}
      </div>

      {visible.length === 0 && (
        <p className="text-sm text-slate-400 py-8 text-center">
          Sin mecanismos de {kind === 'competitor' ? 'competencia' : 'inspiración'} todavía esta semana.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((m) => (
          <Card key={m.id}>
            <CardContent className="pt-5 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setProfileBrand(m.brand)}
                        className="font-semibold text-slate-900 hover:text-indigo-700">
                  {m.brand}
                </button>
                {m.is_active === false && <Badge variant="outline" className="text-[9px] text-slate-500">INACTIVO</Badge>}
                <Badge variant="outline" className="text-[10px]">{m.kind}</Badge>
                {m.structure && <Badge className="bg-indigo-100 text-indigo-700 text-[10px] hover:bg-indigo-100">{m.structure}</Badge>}
                {m.framing && <Badge className="bg-purple-100 text-purple-700 text-[10px] hover:bg-purple-100">{m.framing}</Badge>}
                {m.days_running != null && <span className="ml-auto text-xs text-slate-400">{m.days_running}d rodando</span>}
              </div>
              {m.visual_evidence && (
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                  <b>👁 Qué se ve:</b> {m.visual_evidence}
                </p>
              )}
              {m.what_works && <p className="text-sm text-slate-700">{m.what_works}</p>}
              {m.extrapolation && (
                <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                  <b>→ Para {brandCfg.name}:</b> {m.extrapolation}
                </p>
              )}
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Semana {m.week_date}</span>
                <div className="flex items-center gap-2">
                  {m.brand && <AdLibraryLink domain={m.brand} />}
                  {m.library_id && (
                    <a href={`https://www.facebook.com/ads/library/?id=${m.library_id}`} target="_blank" rel="noreferrer"
                       className="flex items-center gap-1 text-indigo-500 hover:underline">
                      ver ad original <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {profileBrand && <BrandProfileDrawer brand={profileBrand} onClose={() => setProfileBrand(null)} />}
    </div>
  )
}
