import { useState } from 'react'
import { ChevronDown, HelpCircle, Pencil, Save } from 'lucide-react'
import { PageGuides } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export default function PageGuide({ pageName }) {
  const { effectiveRole } = useAuth()
  const { data: guides } = useEntityList(PageGuides, { staleTime: 300_000 })
  const guide = (guides || []).find((g) => g.pageName === pageName && g.is_active !== false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)

  if (!guide && effectiveRole !== 'ADMIN') return null

  const startEdit = () => {
    setDraft({ title: guide?.title || '', content: guide?.content || '', video_url: guide?.video_url || '' })
    setEditing(true)
    setOpen(true)
  }
  const save = async () => {
    if (guide) await PageGuides.update(guide.id, draft)
    else await PageGuides.create({ pageName, ...draft, is_active: true })
    setEditing(false)
  }

  return (
    <div className="glass-card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <HelpCircle className="h-4 w-4 text-indigo-500 shrink-0" />
        <span className="text-sm font-medium text-slate-700 flex-1 truncate">{guide?.title || 'Guía de esta página'}</span>
        {effectiveRole === 'ADMIN' && (
          <span onClick={(e) => { e.stopPropagation(); startEdit() }} className="p-1 rounded hover:bg-slate-100 text-slate-400 cursor-pointer"><Pencil className="h-3.5 w-3.5" /></span>
        )}
        <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3 animate-fade-in">
          {editing ? (
            <div className="space-y-2">
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Título" />
              <Textarea rows={3} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder="Contenido de la guía" />
              <Input value={draft.video_url} onChange={(e) => setDraft({ ...draft, video_url: e.target.value })} placeholder="URL de video Loom (opcional)" />
              <div className="flex gap-2">
                <Button size="sm" onClick={save}><Save className="h-3.5 w-3.5" /> Guardar</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{guide?.content || 'Sin contenido aún.'}</p>
              {guide?.video_url && (
                <div className="aspect-video w-full max-w-xl overflow-hidden rounded-lg border border-slate-200">
                  <iframe src={guide.video_url.replace('/share/', '/embed/')} className="h-full w-full" allowFullScreen title="Guía en video" />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
