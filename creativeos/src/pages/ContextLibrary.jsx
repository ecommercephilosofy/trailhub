import { useMemo, useState } from 'react'
import { BookOpen, Copy, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ScriptModules } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import { cn } from '@/lib/utils'

const MODULE_TYPES = ['HOOK', 'BODY', 'PROOF', 'OBJECTION', 'CTA', 'OFFER']
const TYPE_CLS = {
  HOOK: 'bg-indigo-100 text-indigo-700', BODY: 'bg-slate-100 text-slate-700', PROOF: 'bg-emerald-100 text-emerald-700',
  OBJECTION: 'bg-amber-100 text-amber-700', CTA: 'bg-purple-100 text-purple-700', OFFER: 'bg-rose-100 text-rose-700',
}

export default function ContextLibrary() {
  const { data: modules, isLoading } = useEntityList(ScriptModules, { sort: '-created_date' })
  const [typeFilter, setTypeFilter] = useState('all')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ module_type: 'HOOK', name: '', content: '', performance_note: '' })
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => (modules || []).filter((m) => typeFilter === 'all' || m.module_type === typeFilter), [modules, typeFilter])

  const save = async () => {
    if (!form.name.trim() || !form.content.trim()) return toast.error('Nombre y contenido obligatorios')
    setSaving(true)
    try {
      await ScriptModules.create({ ...form, best_for: [] })
      toast.success('Módulo creado')
      setOpen(false)
      setForm({ module_type: 'HOOK', name: '', content: '', performance_note: '' })
    } finally { setSaving(false) }
  }

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="ContextLibrary" />
      <p className="text-sm text-slate-500">Módulos reutilizables de copy con plantillas {'{variables}'} — bloques probados para componer scripts.</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTypeFilter('all')} className={cn('rounded-full px-3 py-1 text-xs font-medium', typeFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600')}>Todos</button>
        {MODULE_TYPES.map((t) => (
          <button key={t} onClick={() => setTypeFilter(t)} className={cn('rounded-full px-3 py-1 text-xs font-medium', typeFilter === t ? 'bg-slate-800 text-white' : TYPE_CLS[t])}>{t}</button>
        ))}
        <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}><Plus /> Nuevo módulo</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={BookOpen} title="Sin módulos" description="Guarda bloques de copy reutilizables: hooks, pruebas, CTAs…" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((m) => (
            <div key={m.id} className="glass-card p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-slate-800">{m.name}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${TYPE_CLS[m.module_type]}`}>{m.module_type}</span>
              </div>
              <p className="mt-2 rounded-lg bg-slate-50 p-2.5 font-mono text-xs text-slate-700">{m.content}</p>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[10px] text-slate-400">{m.performance_note}</p>
                <button onClick={() => { navigator.clipboard.writeText(m.content); toast.success('Copiado') }} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Copy className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo módulo</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <Select value={form.module_type} onValueChange={(v) => setForm({ ...form, module_type: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{MODULE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Nombre</Label><Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Contenido (usa {'{variables}'})</Label><Textarea rows={3} className="mt-1 font-mono text-xs" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></div>
            <div><Label>Nota de performance</Label><Input className="mt-1" value={form.performance_note} onChange={(e) => setForm({ ...form, performance_note: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Crear</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
