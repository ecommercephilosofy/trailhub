// Bonuses AUTOMÁTICOS. Regla: un ad tuyo es winner de bonus con gasto total y
// ROAS total por encima del umbral; el pipeline lo detecta cada lunes.
// PRIVACIDAD (regla de Marc): el EDITOR nunca ve cifras de gasto — solo ROAS,
// etapa cualitativa del progreso y sus bonuses. La dirección lo ve todo.
// El bloqueo es de BASE DE DATOS (RLS + rpc sin columnas de dinero), no de UI.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { useEntityList } from '@/hooks/useData'
import { BonusRules, BonusLedger, AdLifecycle, AdsWeekly, Cards, Profiles, Notifications } from '@/api/entities'
import { supabase } from '@/api/supabaseClient'
import { qbToEditorMap, attributeLifecycle } from '@/lib/attribution'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/shared/badges'
import { ErrorState } from '@/components/shared/misc'
import { Coins, Trophy } from 'lucide-react'
import { fmtRoas, fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const LEDGER_BADGE = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-700',
  PAID: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-slate-100 text-slate-500',
}

const STAGE = {
  arrancando: { pct: 15, label: 'Arrancando', cls: 'bg-slate-300' },
  'en marcha': { pct: 45, label: 'En marcha', cls: 'bg-indigo-400' },
  cerca: { pct: 80, label: '¡Cerca!', cls: 'bg-amber-400' },
  listo: { pct: 100, label: '✓ Objetivo de entrega cumplido', cls: 'bg-emerald-500' },
}

function StageBar({ stage }) {
  const s = STAGE[stage] || STAGE.arrancando
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 w-full rounded-full bg-slate-100">
        <div className={cn('h-2 rounded-full transition-all', s.cls)} style={{ width: `${s.pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 whitespace-nowrap">{s.label}</span>
    </div>
  )
}

// ── Vista del EDITOR: sin dinero ─────────────────────────────────────────────
// Vista `my_bonus_ledger` y rpc `my_bonus_progress` (security definer, sin
// columnas de dinero) — vía React Query, no entidades (no son tablas normales).
function EditorView({ rule }) {
  const { data: ledger, error: ledgerErr } = useQuery({
    queryKey: ['my_bonus_ledger'],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('my_bonus_ledger').select('*').order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return data || []
    },
  })
  const { data: progress, error: progressErr } = useQuery({
    queryKey: ['my_bonus_progress'],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_bonus_progress')
      if (error) throw new Error(error.message)
      return data || []
    },
  })

  if (progressErr || ledgerErr) return <ErrorState error={progressErr || ledgerErr} />

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Mis ads — camino al bonus</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {progress === undefined && <p className="text-sm text-slate-400">Cargando…</p>}
          {progress?.length === 0 && (
            <p className="text-sm text-slate-400">
              Aún no tienes ads en seguimiento. El flujo: te asignan un brief → produces →
              lanzas el ad con el nombre sugerido (lleva tu código QB) → aquí aparece su progreso.
            </p>
          )}
          {(progress || []).map((p) => (
            <div key={p.ad_code} className="rounded-lg border border-slate-100 p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-slate-800">{p.ad_code}</span>
                {p.is_winner && (
                  <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 gap-1">
                    <Trophy className="h-3 w-3" /> WINNER{p.weeks_as_winner > 1 ? ` · ${p.weeks_as_winner} sem` : ''}
                  </Badge>
                )}
                {p.lifetime_roas != null && (
                  <span className={cn('ml-auto text-sm font-semibold',
                    p.lifetime_roas >= (rule?.min_lifetime_roas || 2) ? 'text-emerald-600' : 'text-slate-500')}>
                    ROAS total {fmtRoas(p.lifetime_roas)}
                  </span>
                )}
              </div>
              <div className="mt-2"><StageBar stage={p.stage} /></div>
              {p.bonus_status && (
                <Badge className={cn('mt-2 text-[10px]', LEDGER_BADGE[p.bonus_status])}>bonus {p.bonus_status}</Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Mis bonuses</CardTitle></CardHeader>
        <CardContent>
          {!ledger?.length ? (
            <p className="text-sm text-slate-400">Todavía ninguno — el primero caerá solo.</p>
          ) : (
            <div className="space-y-2">
              {ledger.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
                  <Badge className={cn('text-[10px]', LEDGER_BADGE[e.status])}>{e.status}</Badge>
                  <span className="font-medium text-slate-800">{e.ad_code}</span>
                  <span className="ml-auto font-bold text-slate-900">{e.amount_eur}€</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}

// ── Vista de DIRECCIÓN: todo visible + aprobar ───────────────────────────────
function MgmtView({ rule, isAdmin }) {
  const minSpend = rule?.min_lifetime_spend || 1500
  const minRoas = rule?.min_lifetime_roas || 2.0
  const { data: ledger, refetch } = useEntityList(BonusLedger, { sort: '-created_at' })
  const { data: lifecycle } = useEntityList(AdLifecycle, { limit: 1000 })
  const { data: ads } = useEntityList(AdsWeekly, { sort: '-week_date', limit: 1000 })
  const { data: cards } = useEntityList(Cards, { limit: 500 })
  const { data: profiles } = useEntityList(Profiles)

  // Lógica de atribución en lib/attribution.js (con tests — es el camino del dinero)
  const qbToEditor = useMemo(() => qbToEditorMap(cards), [cards])
  const attributed = useMemo(() => attributeLifecycle(lifecycle, ads, qbToEditor), [lifecycle, ads, qbToEditor])

  const nameOf = (uid) => (profiles || []).find((p) => p.user_id === uid)?.name || '—'

  const setStatus = async (entry, status) => {
    await BonusLedger.update(entry.id, { status })
    if (status === 'APPROVED') {
      await Notifications.create({
        target_user_id: entry.editor_user_id, type: 'BONUS',
        title: `🎉 Bonus aprobado: ${entry.amount_eur}€`, body: `Tu ad ${entry.ad_code} lo consiguió`,
      }).catch(() => {})
    }
    toast.success(`Bonus → ${status}`)
    refetch()
  }

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Progreso de ads atribuidos (equipo)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {attributed.length === 0 && (
            <p className="text-sm text-slate-400">Sin ads atribuidos aún (brief asignado → ad lanzado con su QB).</p>
          )}
          {attributed.map((l) => {
            const roas = l.lifetime_spend ? l.lifetime_revenue / l.lifetime_spend : 0
            return (
              <div key={l.code} className="rounded-lg border border-slate-100 p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-slate-800">{l.code}</span>
                  <code className="text-[10px] text-slate-400">{l.qb}</code>
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <UserAvatar name={nameOf(l.editor)} size="sm" />{nameOf(l.editor)}</span>
                  <span className={cn('ml-auto text-sm font-semibold',
                    roas >= minRoas ? 'text-emerald-600' : 'text-slate-500')}>
                    ROAS total {fmtRoas(roas)}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-2 w-full rounded-full bg-slate-100">
                    <div className={cn('h-2 rounded-full', (l.lifetime_spend || 0) >= minSpend ? 'bg-emerald-500' : 'bg-indigo-400')}
                         style={{ width: `${Math.min(100, ((l.lifetime_spend || 0) / minSpend) * 100)}%` }} />
                  </div>
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {fmtNum(l.lifetime_spend || 0)}€ / {fmtNum(minSpend)}€
                  </span>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Ledger de bonuses</CardTitle></CardHeader>
        <CardContent>
          {!ledger?.length ? (
            <p className="text-sm text-slate-400">Todavía ninguno.</p>
          ) : (
            <div className="space-y-2">
              {ledger.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
                  <Badge className={cn('text-[10px]', LEDGER_BADGE[e.status])}>{e.status}</Badge>
                  <span className="font-medium text-slate-800">{e.ad_code}</span>
                  <span className="text-xs text-slate-500">{nameOf(e.editor_user_id)}</span>
                  <span className="text-xs text-slate-400">
                    {e.evidence?.lifetime_spend && `${fmtNum(e.evidence.lifetime_spend)}€ · ROAS ${e.evidence.lifetime_roas}`}
                  </span>
                  <span className="ml-auto font-bold text-slate-900">{e.amount_eur}€</span>
                  {isAdmin && e.status === 'PENDING' && <Button size="sm" onClick={() => setStatus(e, 'APPROVED')}>Aprobar</Button>}
                  {isAdmin && e.status === 'APPROVED' && <Button size="sm" variant="outline" onClick={() => setStatus(e, 'PAID')}>Marcar pagado</Button>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}

export default function Bonuses() {
  const { effectiveRole } = useAuth()
  const isMgmt = ['ADMIN', 'MANAGER'].includes(effectiveRole)
  const { data: rules } = useEntityList(BonusRules)
  const rule = (rules || []).find((r) => r.rule_key === 'PER_WINNER_LIFETIME')

  return (
    <div className="space-y-6">
      <Card className="border-indigo-200 bg-indigo-50/40">
        <CardContent className="pt-5 flex items-center gap-3">
          <Coins className="h-8 w-8 text-indigo-500 shrink-0" />
          <div>
            <p className="font-semibold text-slate-900">{rule?.name || 'Bonus por winner'}</p>
            <p className="text-sm text-slate-600">
              {isMgmt
                ? <>Un ad gana <b>{rule?.amount_eur || 50}€</b> para su editor al acumular <b>{fmtNum(rule?.min_lifetime_spend || 1500)}€ de entrega total</b> con <b>ROAS total ≥ {rule?.min_lifetime_roas || 2}</b>.</>
                : <>Cuando un ad tuyo se convierte en <b>winner sostenido</b> (suficiente entrega + ROAS total ≥ {rule?.min_lifetime_roas || 2}), ganas <b>{rule?.amount_eur || 50}€</b>. Se detecta solo cada lunes — sin papeleo.</>}
            </p>
          </div>
        </CardContent>
      </Card>
      {isMgmt ? <MgmtView rule={rule} isAdmin={effectiveRole === 'ADMIN'} /> : <EditorView rule={rule} />}
    </div>
  )
}
