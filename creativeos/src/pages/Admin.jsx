// Admin: equipo (roles) + regla de bonus. Crear usuarios: Supabase Dashboard →
// Authentication → "Invite user" (el perfil se gestiona aquí tras el primer login).
import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useEntityList } from '@/hooks/useData'
import { Profiles, BonusRules } from '@/api/entities'
import { invokeFn } from '@/api/functions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UserAvatar } from '@/components/shared/badges'
import { UserPlus, Trash2, Copy } from 'lucide-react'
import { toast } from 'sonner'

const callAdminUsers = (body) => invokeFn('admin-users', body)

function InviteDialog({ open, onClose, onDone }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('EDITOR')
  const [link, setLink] = useState(null)
  const [busy, setBusy] = useState(false)

  const invite = async () => {
    setBusy(true)
    try {
      const r = await callAdminUsers({ action: 'invite', email: email.trim(), name: name.trim(), role })
      setLink(r.action_link)
      toast.success('Usuario creado — pásale el link de acceso')
      onDone()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }
  const close = () => { setEmail(''); setName(''); setRole('EDITOR'); setLink(null); onClose() }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Invitar usuario</DialogTitle></DialogHeader>
        {!link ? (
          <div className="space-y-2">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" autoFocus />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="nombre" />
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['EDITOR', 'MANAGER', 'ADMIN', 'VIEWER'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={invite} disabled={busy || !email.includes('@')} className="w-full">
              {busy ? 'Creando…' : 'Crear + generar link de acceso'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Pásale este link (WhatsApp/Telegram — es de un solo uso, mejor que el email):
              al abrirlo pone su contraseña y entra.
            </p>
            <div className="flex gap-2">
              <code className="flex-1 bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[10px] break-all max-h-24 overflow-y-auto">{link}</code>
              <Button variant="outline" size="sm" onClick={async () => {
                await navigator.clipboard.writeText(link); toast.success('Copiado')
              }}><Copy className="h-3.5 w-3.5" /></Button>
            </div>
            <Button onClick={close} className="w-full">Cerrar</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function Admin() {
  const { user } = useAuth()
  const { data: profiles, refetch } = useEntityList(Profiles)
  const { data: rules, refetch: refetchRules } = useEntityList(BonusRules)
  const rule = (rules || []).find((r) => r.rule_key === 'PER_WINNER_LIFETIME')
  const [edit, setEdit] = useState(null)
  const [inviting, setInviting] = useState(false)

  const setRole = async (p, role) => {
    await Profiles.update(p.user_id, { custom_role: role })
    toast.success(`${p.name || 'Usuario'} → ${role}`)
    refetch()
  }

  const removeUser = async (p) => {
    if (!confirm(`¿Eliminar a ${p.name}? Se borra su acceso; sus tarjetas quedan sin asignar.`)) return
    try {
      await callAdminUsers({ action: 'delete', user_id: p.user_id })
      toast.success(`${p.name} eliminado`)
      refetch()
    } catch (e) {
      toast.error(e.message)
    }
  }

  const resendLink = async (p) => {
    if (!p.email) return toast.error('Perfil sin email')
    try {
      // Re-invitación: genera link de acceso fresco para un usuario existente
      const r = await callAdminUsers({ action: 'invite', email: p.email, name: p.name, role: p.custom_role })
      await navigator.clipboard.writeText(r.action_link)
      toast.success('Link de acceso copiado — pásaselo (un solo uso)')
    } catch (e) {
      toast.error(e.message)
    }
  }

  const saveRule = async () => {
    await BonusRules.update(rule.id, {
      amount_eur: Number(edit.amount_eur),
      min_lifetime_spend: Number(edit.min_lifetime_spend),
      min_lifetime_roas: Number(edit.min_lifetime_roas),
    })
    toast.success('Regla de bonus actualizada (aplica desde el próximo lunes)')
    setEdit(null)
    refetchRules()
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Equipo</CardTitle>
          <Button size="sm" onClick={() => setInviting(true)}>
            <UserPlus className="h-4 w-4" /> Invitar
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {(profiles || []).map((p) => (
            <div key={p.user_id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
              <UserAvatar name={p.name} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{p.name || p.user_id.slice(0, 8)}</p>
                <p className="text-[11px] text-slate-400 truncate">{p.email}</p>
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-indigo-600"
                      onClick={() => resendLink(p)} title="Genera y copia un link de acceso (poner/cambiar contraseña)">
                🔗 link
              </Button>
              <Select value={p.custom_role} onValueChange={(v) => setRole(p, v)}>
                <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              {p.user_id !== user?.id && (
                <button onClick={() => removeUser(p)} className="text-slate-300 hover:text-red-600" title="Eliminar usuario">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <InviteDialog open={inviting} onClose={() => setInviting(false)} onDone={refetch} />

      {rule && (
        <Card>
          <CardHeader><CardTitle className="text-base">Regla de bonus</CardTitle></CardHeader>
          <CardContent>
            {!edit ? (
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-700">
                  <b>{rule.amount_eur}€</b> por ad con <b>≥{rule.min_lifetime_spend}€</b> de gasto total
                  y <b>ROAS total ≥{rule.min_lifetime_roas}</b>
                </p>
                <Button variant="outline" size="sm" onClick={() => setEdit({ ...rule })}>Editar</Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="text-xs text-slate-500">Importe (€)</label>
                  <Input type="number" value={edit.amount_eur}
                         onChange={(e) => setEdit({ ...edit, amount_eur: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Gasto mínimo (€)</label>
                  <Input type="number" value={edit.min_lifetime_spend}
                         onChange={(e) => setEdit({ ...edit, min_lifetime_spend: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-500">ROAS mínimo</label>
                  <Input type="number" step="0.1" value={edit.min_lifetime_roas}
                         onChange={(e) => setEdit({ ...edit, min_lifetime_roas: e.target.value })} />
                </div>
                <div className="sm:col-span-3 flex gap-2">
                  <Button onClick={saveRule}>Guardar</Button>
                  <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
