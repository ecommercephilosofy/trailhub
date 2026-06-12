import { useState } from 'react'
import { GraduationCap, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { TrainingResources } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'

const CAT_CLS = { HOOKS: 'bg-indigo-100 text-indigo-700', EDITING: 'bg-purple-100 text-purple-700', DATA: 'bg-emerald-100 text-emerald-700', PROCESS: 'bg-amber-100 text-amber-700' }

export default function Training() {
  const { effectiveRole } = useAuth()
  const { data: resources, isLoading } = useEntityList(TrainingResources, { sort: '-created_date' })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', category: 'HOOKS', description: '', content_url: '', duration_min: 10 })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!form.title.trim()) return toast.error('Título obligatorio')
    setSaving(true)
    try {
      await TrainingResources.create({ ...form, required_for: ['EDITOR'] })
      toast.success('Recurso creado')
      setOpen(false)
    } finally { setSaving(false) }
  }

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="Training" />
      {effectiveRole === 'ADMIN' && (
        <div className="flex justify-end"><Button onClick={() => setOpen(true)}><Plus /> Añadir recurso</Button></div>
      )}
      {(resources || []).length === 0 ? (
        <EmptyState icon={GraduationCap} title="Sin recursos de training" description="El material de formación del equipo aparecerá aquí." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(resources || []).map((r) => (
            <a key={r.id} href={r.content_url || '#'} target={r.content_url ? '_blank' : undefined} rel="noreferrer" className="glass-card p-4 hover:shadow-md transition-shadow block">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-slate-800 leading-snug">{r.title}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${CAT_CLS[r.category] || 'bg-slate-100 text-slate-600'}`}>{r.category}</span>
              </div>
              <p className="mt-1.5 text-sm text-slate-500 line-clamp-2">{r.description}</p>
              <p className="mt-2 text-xs text-slate-400">⏱ {r.duration_min} min</p>
            </a>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo recurso de training</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Título</Label><Input className="mt-1" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Categoría</Label><Input className="mt-1" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value.toUpperCase() })} /></div>
              <div><Label>Duración (min)</Label><Input type="number" className="mt-1" value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: Number(e.target.value) })} /></div>
            </div>
            <div><Label>URL (Loom, Notion…)</Label><Input className="mt-1" value={form.content_url} onChange={(e) => setForm({ ...form, content_url: e.target.value })} /></div>
            <div><Label>Descripción</Label><Textarea rows={2} className="mt-1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Crear</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
