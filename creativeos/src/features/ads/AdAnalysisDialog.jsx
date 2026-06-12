import { useState } from 'react'
import { Brain, Loader2, FileEdit } from 'lucide-react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { analyzeAdIntelligence } from '@/api/functions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { PerformanceLabel } from '@/components/shared/badges'
import { fmtEur, fmtRoas } from '@/lib/format'

export default function AdAnalysisDialog({ ad, adStats, mappedScript }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const navigate = useNavigate()

  const run = async () => {
    setLoading(true)
    try {
      const res = await analyzeAdIntelligence(ad, { adStats, mappedScript })
      setResult(res)
      toast.success('Análisis completado · borrador creado')
    } finally { setLoading(false) }
  }

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        className="rounded-lg p-1.5 text-indigo-500 hover:bg-indigo-50"
        title="Análisis IA"
      >
        <Brain className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Brain className="h-5 w-5 text-indigo-500" /> Análisis IA del Ad</DialogTitle>
            <DialogDescription className="line-clamp-1">{ad.ad_name}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <PerformanceLabel label={ad.label} action={ad.action} />
            <span className="text-slate-600">ROAS <b>{fmtRoas(ad.roas)}</b></span>
            <span className="text-slate-600">Spend <b>{fmtEur(ad.spend)}</b></span>
          </div>
          {!result ? (
            <div className="py-6 text-center">
              <Button onClick={run} disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : <Brain />} {loading ? 'Analizando métricas…' : 'Ejecutar análisis profundo'}
              </Button>
              <p className="mt-2 text-xs text-slate-400">Genera diagnóstico + borrador de iteración en Script Builder</p>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{result.analysis_text}</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setOpen(false); navigate('/ScriptBuilder') }}>
                  <FileEdit /> Abrir borrador en Script Builder
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
