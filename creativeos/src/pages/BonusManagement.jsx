import { useState } from 'react'
import { Coins, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { BonusRules, BonusPeriods, BonusLedger } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { StatusBadge, UserAvatar } from '@/components/shared/badges'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import { fmtEur } from '@/lib/format'

const RULE_TYPES = [['PER_WINNER', 'Por cada Winner'], ['PORTFOLIO_ROAS', 'ROAS de cartera'], ['SPEND_MILESTONE', 'Hito de spend']]
const LEDGER_STATUSES = ['PENDING', 'APPROVED', 'PAID']

export default function BonusManagement() {
  const { data: rules, isLoading } = useEntityList(BonusRules, { sort: '-created_date' })
  const { data: periods } = useEntityList(BonusPeriods, { sort: '-start_date' })
  const { data: ledger } = useEntityList(BonusLedger, { sort: '-created_date', limit: 100 })
  const [ruleOpen, setRuleOpen] = useState(false)
  const [rule, setRule] = useState({ name: '', rule_type: 'PER_WINNER', amount_eur: 50, condition: '' })
  const [saving, setSaving] = useState(false)

  const saveRule = async () => {
    if (!rule.name.trim()) return toast.error('Nombre obligatorio')
    setSaving(true)
    try {
      await BonusRules.create({ ...rule, is_active: true })
      toast.success('Regla creada')
      setRuleOpen(false)
      setRule({ name: '', rule_type: 'PER_WINNER', amount_eur: 50, condition: '' })
    } finally { setSaving(false) }
  }

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="BonusManagement" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Reglas de bonus</CardTitle>
            <Button size="sm" onClick={() => setRuleOpen(true)}><Plus /> Nueva regla</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {(rules || []).map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-100 bg-white/60 p-3">
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-sm font-medium text-slate-800">{r.name}</p>
                  <span className="font-bold text-emerald-600">{fmtEur(r.amount_eur)}</span>
                  <Switch checked={r.is_active !== false} onCheckedChange={(v) => BonusRules.update(r.id, { is_active: v })} />
                </div>
                <p className="mt-1 text-xs text-slate-500">{r.condition}</p>
                <span className="mt-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{r.rule_type}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Períodos de evaluación</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(periods || []).map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-white/60 p-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-800">{p.period_name}</p>
                  <p className="text-xs text-slate-400">{p.start_date} → {p.end_date}</p>
                </div>
                <span className="text-sm font-semibold text-slate-700">{fmtEur(p.total_paid_eur)}</span>
                <StatusBadge status={p.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-1.5"><Coins className="h-4 w-4 text-amber-500" /> Ledger de bonos</CardTitle></CardHeader>
        <CardContent>
          {(ledger || []).length === 0 ? (
            <EmptyState icon={Coins} title="Sin bonos registrados" />
          ) : (
            <div className="space-y-2">
              {(ledger || []).map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-white/60 p-3">
                  <UserAvatar name={l.editor_name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{l.editor_name} · {l.rule_name}</p>
                    <p className="truncate text-xs text-slate-400">{l.detail}</p>
                  </div>
                  <span className="font-bold text-emerald-600">{fmtEur(l.amount_eur)}</span>
                  <Select value={l.status} onValueChange={(v) => BonusLedger.update(l.id, { status: v })}>
                    <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{LEDGER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva regla de bonus</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nombre</Label><Input className="mt-1" value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <Select value={rule.rule_type} onValueChange={(v) => setRule({ ...rule, rule_type: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{RULE_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Importe (€)</Label><Input type="number" className="mt-1" value={rule.amount_eur} onChange={(e) => setRule({ ...rule, amount_eur: Number(e.target.value) })} /></div>
            </div>
            <div><Label>Condición</Label><Input className="mt-1" value={rule.condition} onChange={(e) => setRule({ ...rule, condition: e.target.value })} placeholder="p.ej. Ad alcanza WINNER en 7d" /></div>
          </div>
          <DialogFooter><Button onClick={saveRule} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Crear</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
