import { useMemo, useState } from 'react'
import { Plus, Search, Star, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { InspirationAds } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { FormatBadge } from '@/components/shared/badges'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import { extractDriveFileId } from '@/lib/utils'

export default function Inspiration() {
  const { effectiveRole } = useAuth()
  const readOnly = effectiveRole === 'VIEWER'
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ title: '', brand: '', platform: 'Meta', drive_link: '', notes: '', format: 'UGC', hook_type: '', tags: '' })
  const [saving, setSaving] = useState(false)
  const { data: ads, isLoading } = useEntityList(InspirationAds, { sort: '-created_date', limit: 200 })

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return (ads || []).filter((a) => !q || a.title?.toLowerCase().includes(q) || a.brand?.toLowerCase().includes(q) || (a.tags || []).some((t) => t.includes(q)))
  }, [ads, search])

  const save = async () => {
    if (!form.title.trim()) return toast.error('Título obligatorio')
    setSaving(true)
    try {
      await InspirationAds.create({ ...form, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean), thumbnail_url: `https://picsum.photos/seed/${encodeURIComponent(form.brand || form.title)}/400/225` })
      toast.success('Inspiración guardada')
      setAddOpen(false)
      setForm({ title: '', brand: '', platform: 'Meta', drive_link: '', notes: '', format: 'UGC', hook_type: '', tags: '' })
    } finally { setSaving(false) }
  }

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="Inspiration" />
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-8" placeholder="Buscar por marca, título o tag…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {!readOnly && <Button className="ml-auto" onClick={() => setAddOpen(true)}><Plus /> Añadir inspiración</Button>}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Star} title="Sin inspiración guardada" description="Guarda ads de competidores para referenciar estilo y formato." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a) => {
            const driveId = extractDriveFileId(a.drive_link)
            return (
              <div key={a.id} className="glass-card overflow-hidden">
                {driveId ? (
                  <iframe src={`https://drive.google.com/file/d/${driveId}/preview`} className="aspect-video w-full bg-slate-100" sandbox="allow-same-origin allow-scripts allow-popups allow-forms" title={a.title} />
                ) : (
                  <img src={a.thumbnail_url || 'https://picsum.photos/seed/x/400/225'} alt="" className="aspect-video w-full object-cover" />
                )}
                <div className="p-4">
                  <p className="font-medium text-slate-800 leading-snug">{a.title}</p>
                  <p className="text-xs text-slate-400">{a.brand} · {a.platform}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <FormatBadge format={a.format} size="sm" />
                    {a.hook_type && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{a.hook_type}</span>}
                    {(a.tags || []).slice(0, 3).map((t) => <span key={t} className="text-[10px] text-indigo-500">#{t}</span>)}
                  </div>
                  {a.notes && <p className="mt-2 text-xs text-slate-500 line-clamp-2">{a.notes}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Añadir inspiración</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Título *</Label><Input className="mt-1" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Marca</Label><Input className="mt-1" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></div>
              <div><Label>Plataforma</Label><Input className="mt-1" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} /></div>
            </div>
            <div><Label>Drive link (opcional)</Label><Input className="mt-1" value={form.drive_link} onChange={(e) => setForm({ ...form, drive_link: e.target.value })} /></div>
            <div><Label>Notas</Label><Textarea rows={2} className="mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div><Label>Tags (separados por coma)</Label><Input className="mt-1" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Guardar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
