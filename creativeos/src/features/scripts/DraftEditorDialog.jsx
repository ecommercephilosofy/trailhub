import { useState } from 'react'
import { Loader2, Rocket, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { GeneratedScripts, ScriptBuilderDrafts } from '@/api/entities'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { PerformanceLabel } from '@/components/shared/badges'
import { fmtEur, fmtRoas } from '@/lib/format'

// Parses "=== SECTION ===" blocks from the draft text.
function parseSections(text) {
  const sections = {}
  const re = /===\s*([A-Z\- ]+?)\s*===/g
  const parts = text.split(re)
  for (let i = 1; i < parts.length; i += 2) {
    sections[parts[i].trim()] = (parts[i + 1] || '').trim()
  }
  return sections
}

export default function DraftEditorDialog({ draft, onClose }) {
  const [text, setText] = useState(draft.current_script_text || '')
  const [publishing, setPublishing] = useState(false)
  const snap = draft.performance_snapshot_json || {}

  const publish = async () => {
    setPublishing(true)
    try {
      const s = parseSections(text)
      const lines = (v) => (v || '').split('\n').map((x) => x.trim()).filter(Boolean)
      const fullScript = s['SCRIPT'] || text
      const hook = lines(fullScript)[0]?.replace(/^HOOK[^:]*:\s*/i, '') || ''
      await GeneratedScripts.create({
        title: `Iteración de ${draft.source_ad_name || draft.source_ad_id}`,
        product: snap.product || '', format: draft.format || 'UGC', status: 'DRAFT',
        duration_sec: 35, language: 'es',
        hook, full_script: fullScript,
        on_screen_text: lines(s['ON-SCREEN']), shotlist: lines(s['SHOTLIST']),
        broll_suggestions: lines(s['B-ROLL']), cta: s['CTA'] || '',
        editing_checklist: lines(s['EDITING CHECKLIST']),
        based_on: { source_ad_id: draft.source_ad_id, source_ad_name: draft.source_ad_name, source_roas: snap.roas, method: 'AI_ITERATION_FROM_AD' },
      })
      await ScriptBuilderDrafts.update(draft.id, { status: 'PUBLISHED', current_script_text: text })
      toast.success('Publicado en Script Builder ✨')
      onClose()
    } finally { setPublishing(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Draft Editor</DialogTitle>
          <DialogDescription>Borrador generado desde análisis del ad. Edita y publica a Script Builder.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-800">{draft.source_ad_name || draft.source_ad_id}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              {snap.label && <PerformanceLabel label={snap.label} />}
              {snap.roas != null && <span>ROAS <b>{fmtRoas(snap.roas)}</b></span>}
              {snap.spend != null && <span>Spend <b>{fmtEur(snap.spend)}</b></span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Script ID</Label>
              <p className="mt-1 rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-xs text-slate-500">{draft.id}</p>
            </div>
            <div>
              <Label className="text-xs">Format</Label>
              <p className="mt-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-500">{draft.format}</p>
            </div>
          </div>
          {draft.ai_analysis_notes && (
            <div>
              <Label>AI Analysis Notes</Label>
              <Textarea readOnly rows={5} className="mt-1 bg-amber-50 border-amber-200 text-xs" value={draft.ai_analysis_notes} />
            </div>
          )}
          <div>
            <Label>Current Script Text</Label>
            <Textarea rows={15} className="mt-1 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled title="Próximamente"><Sparkles /> Enhance with AI</Button>
          <Button onClick={publish} disabled={publishing}>
            {publishing ? <Loader2 className="animate-spin" /> : <Rocket />} Publish to Script Builder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
