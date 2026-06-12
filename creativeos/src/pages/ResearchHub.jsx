import { useMemo, useState } from 'react'
import { FlaskConical, Plus, Search, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { AvatarProfiles, AngleLibrary, DesireLibrary, ProblemLibrary, ObjectionLibrary } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import { fmtEur } from '@/lib/format'

// field types: text | textarea | list (newline-separated array) | bool
const TAB_CONFIG = [
  {
    key: 'avatars', label: 'Avatars', entity: AvatarProfiles, color: 'from-blue-500 to-cyan-500',
    desc: (x) => x.descripcion,
    fields: [
      { key: 'nombre', label: 'Nombre', type: 'text', required: true },
      { key: 'avatar_id', label: 'ID externo (AV-…)', type: 'text' },
      { key: 'descripcion', label: 'Descripción', type: 'textarea' },
      { key: 'age_range', label: 'Rango de edad', type: 'text' },
      { key: 'gender', label: 'Género', type: 'text' },
      { key: 'pains', label: 'Pains (uno por línea)', type: 'list' },
      { key: 'desired_outcomes', label: 'Resultados deseados', type: 'list' },
      { key: 'objections', label: 'Objeciones', type: 'list' },
      { key: 'language_style', label: 'Estilo de lenguaje', type: 'text' },
      { key: 'forbidden_tones', label: 'Tonos prohibidos', type: 'list' },
      { key: 'products', label: 'Productos', type: 'list' },
      { key: 'is_active', label: 'Activo', type: 'bool' },
    ],
  },
  {
    key: 'angles', label: 'Angles', entity: AngleLibrary, color: 'from-purple-500 to-fuchsia-500',
    desc: (x) => x.promise,
    fields: [
      { key: 'nombre', label: 'Nombre', type: 'text', required: true },
      { key: 'angle_id', label: 'ID externo (ANG-…)', type: 'text' },
      { key: 'promise', label: 'Promesa', type: 'textarea' },
      { key: 'mechanism', label: 'Mecanismo', type: 'textarea' },
      { key: 'key_objection_to_crush', label: 'Objeción clave a destruir', type: 'text' },
      { key: 'proof_strategy', label: 'Estrategia de prueba', type: 'text' },
      { key: 'best_formats', label: 'Mejores formatos', type: 'list' },
      { key: 'products', label: 'Productos', type: 'list' },
    ],
  },
  {
    key: 'desires', label: 'Desires', entity: DesireLibrary, color: 'from-pink-500 to-rose-500',
    desc: (x) => x.core_desire,
    fields: [
      { key: 'nombre', label: 'Nombre', type: 'text', required: true },
      { key: 'desire_id', label: 'ID externo (DES-…)', type: 'text' },
      { key: 'core_desire', label: 'Deseo core', type: 'textarea' },
      { key: 'emotional_triggers', label: 'Triggers emocionales', type: 'list' },
      { key: 'proof_types_that_work', label: 'Pruebas que funcionan', type: 'list' },
      { key: 'products', label: 'Productos', type: 'list' },
    ],
  },
  {
    key: 'problems', label: 'Problems', entity: ProblemLibrary, color: 'from-orange-500 to-amber-500',
    desc: (x) => x.description,
    fields: [
      { key: 'nombre', label: 'Nombre', type: 'text', required: true },
      { key: 'problem_id', label: 'ID externo (PRB-…)', type: 'text' },
      { key: 'description', label: 'Descripción', type: 'textarea' },
      { key: 'unique_mechanism_behind_problem', label: 'Mecanismo único del problema', type: 'textarea' },
      { key: 'unique_mechanism_behind_solution', label: 'Mecanismo único de la solución', type: 'textarea' },
      { key: 'knowledge_gap', label: 'Knowledge gap', type: 'textarea' },
      { key: 'past_solutions_tried', label: 'Soluciones ya probadas', type: 'list' },
      { key: 'why_past_failed', label: 'Por qué fallaron', type: 'textarea' },
      { key: 'products', label: 'Productos', type: 'list' },
    ],
  },
  {
    key: 'objections', label: 'Objections', entity: ObjectionLibrary, color: 'from-slate-500 to-slate-700',
    desc: (x) => x.text,
    fields: [
      { key: 'nombre', label: 'Nombre', type: 'text', required: true },
      { key: 'objection_id', label: 'ID externo (OBJ-…)', type: 'text' },
      { key: 'text', label: 'Texto literal de la objeción', type: 'textarea' },
      { key: 'how_to_address', label: 'Cómo abordarla', type: 'textarea' },
      { key: 'best_rebuttals', label: 'Mejores rebatimientos', type: 'list' },
      { key: 'products', label: 'Productos', type: 'list' },
      { key: 'avatars', label: 'Avatares', type: 'list' },
      { key: 'is_active', label: 'Activa', type: 'bool' },
    ],
  },
]

function FieldInput({ field, value, onChange }) {
  if (field.type === 'textarea') return <Textarea rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} />
  if (field.type === 'list') return <Textarea rows={3} className="text-xs" value={Array.isArray(value) ? value.join('\n') : value || ''} onChange={(e) => onChange(e.target.value)} placeholder="Uno por línea" />
  if (field.type === 'bool') {
    return (
      <Select value={value === false ? 'false' : 'true'} onValueChange={(v) => onChange(v === 'true')}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="true">Sí</SelectItem><SelectItem value="false">No</SelectItem></SelectContent>
      </Select>
    )
  }
  return <Input value={value || ''} onChange={(e) => onChange(e.target.value)} />
}

function ElementDialog({ config, item, onClose, readOnly }) {
  const [form, setForm] = useState(item || {})
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!form.nombre?.trim()) return toast.error('Nombre obligatorio')
    setSaving(true)
    try {
      const payload = { ...form }
      for (const f of config.fields) {
        if (f.type === 'list' && typeof payload[f.key] === 'string') payload[f.key] = payload[f.key].split('\n').map((s) => s.trim()).filter(Boolean)
      }
      if (item?.id) { await config.entity.update(item.id, payload); toast.success('Actualizado') }
      else { await config.entity.create({ ...payload, performance_score: null, total_spend: 0, tests_count: 0 }); toast.success('Creado') }
      onClose()
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!confirm(`¿Eliminar "${item.nombre}"?`)) return
    await config.entity.delete(item.id)
    toast.success('Eliminado')
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{item?.id ? item.nombre : `Nuevo ${config.label.slice(0, -1)}`}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {config.fields.map((f) => (
            <div key={f.key} className={['textarea', 'list'].includes(f.type) ? 'sm:col-span-2' : ''}>
              <Label className="text-xs">{f.label}{f.required && ' *'}</Label>
              <div className="mt-1">
                <FieldInput field={f} value={form[f.key]} onChange={(v) => setForm({ ...form, [f.key]: v })} />
              </div>
            </div>
          ))}
        </div>
        {!readOnly && (
          <DialogFooter className="sm:justify-between">
            {item?.id ? <Button variant="destructive" onClick={del}>Eliminar</Button> : <span />}
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Guardar</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ResearchTab({ config, readOnly }) {
  const [search, setSearch] = useState('')
  const [product, setProduct] = useState('all')
  const [sortBy, setSortBy] = useState('performance')
  const [dialogItem, setDialogItem] = useState(undefined) // undefined=closed, null=new, obj=edit
  const { data: items, isLoading } = useEntityList(config.entity, { staleTime: 60_000 })

  const products = useMemo(() => [...new Set((items || []).flatMap((i) => i.products || []))], [items])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    let out = (items || []).filter((i) => !q || i.nombre?.toLowerCase().includes(q) || config.desc(i)?.toLowerCase?.().includes(q))
    if (product !== 'all') out = out.filter((i) => (i.products || []).includes(product))
    if (sortBy === 'performance') out.sort((a, b) => (b.performance_score || 0) - (a.performance_score || 0))
    else out.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
    return out
  }, [items, search, product, sortBy, config])

  if (isLoading) return <LoadingSpinner />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-8" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {products.length > 0 && (
          <Select value={product} onValueChange={setProduct}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los productos</SelectItem>
              {products.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="performance">Por performance</SelectItem>
            <SelectItem value="name">Por nombre</SelectItem>
          </SelectContent>
        </Select>
        {!readOnly && <Button className="ml-auto" onClick={() => setDialogItem(null)}><Plus /> Nuevo</Button>}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={FlaskConical} title={`Sin ${config.label.toLowerCase()}`} description="Crea el primero o importa desde PDF en el Dashboard." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <button key={item.id} onClick={() => setDialogItem(item)} className="glass-card p-4 text-left hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-slate-800 leading-snug">{item.nombre}</p>
                {item.performance_score != null && (
                  <span className={`shrink-0 rounded-full bg-gradient-to-r ${config.color} px-2 py-0.5 text-xs font-bold text-white`}>{item.performance_score}</span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-500 line-clamp-2">{config.desc(item) || '—'}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                {item.total_spend > 0 && <span>{fmtEur(item.total_spend)} testados</span>}
                {item.tests_count > 0 && <span>· {item.tests_count} tests</span>}
                {item.is_active === false && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">inactivo</span>}
                {(item.products || []).slice(0, 2).map((p) => <span key={p} className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">{p}</span>)}
              </div>
            </button>
          ))}
        </div>
      )}

      {dialogItem !== undefined && <ElementDialog config={config} item={dialogItem} onClose={() => setDialogItem(undefined)} readOnly={readOnly} />}
    </div>
  )
}

export default function ResearchHub() {
  const { effectiveRole } = useAuth()
  const readOnly = effectiveRole === 'VIEWER'
  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="ResearchHub" />
      <Tabs defaultValue="avatars">
        <TabsList className="w-full justify-start overflow-x-auto">
          {TAB_CONFIG.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
        </TabsList>
        {TAB_CONFIG.map((t) => (
          <TabsContent key={t.key} value={t.key}>
            <ResearchTab config={t} readOnly={readOnly} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
