import { useState } from 'react'
import { Mail, Pencil, UserPlus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { AuthUsers, UserProfiles } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UserAvatar } from '@/components/shared/badges'
import { LoadingSpinner } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'

const ROLES = ['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER']
const ROLE_CLS = { ADMIN: 'bg-indigo-100 text-indigo-700', MANAGER: 'bg-purple-100 text-purple-700', EDITOR: 'bg-emerald-100 text-emerald-700', VIEWER: 'bg-slate-100 text-slate-600' }

export default function Users() {
  const { data: users, isLoading } = useEntityList(AuthUsers, { sort: 'created_date' })
  const { data: profiles } = useEntityList(UserProfiles, { staleTime: 60_000 })
  const [editing, setEditing] = useState(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invite, setInvite] = useState({ email: '', role: 'EDITOR' })
  const [saving, setSaving] = useState(false)

  const profileOf = (uid) => (profiles || []).find((p) => p.user_id === uid)

  const saveProfile = async () => {
    setSaving(true)
    try {
      const { id, _userName, ...payload } = editing
      payload.skills_tags = typeof payload.skills_tags === 'string' ? payload.skills_tags.split(',').map((s) => s.trim()).filter(Boolean) : payload.skills_tags
      if (id) await UserProfiles.update(id, payload)
      else await UserProfiles.create(payload)
      toast.success('Perfil guardado')
      setEditing(null)
    } finally { setSaving(false) }
  }

  const doInvite = async () => {
    if (!invite.email.includes('@')) return toast.error('Email inválido')
    // Real backend: base44.users.inviteUser(email, role)
    const user = await AuthUsers.create({ email: invite.email, full_name: invite.email.split('@')[0], role: 'user' })
    await UserProfiles.create({ user_id: user.id, custom_role: invite.role, name: user.full_name, timezone: 'Europe/Madrid', skills_tags: [], capacity_per_day: 3, onboarding_completed: false, notification_prefs: { notify_on_task_assigned: true, notify_on_task_updated: true, notify_on_video_note_added: true, notify_on_script_assigned: true } })
    toast.success(`Invitación enviada a ${invite.email}`)
    setInviteOpen(false)
    setInvite({ email: '', role: 'EDITOR' })
  }

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="Users" />
      <div className="flex justify-end">
        <Button onClick={() => setInviteOpen(true)}><UserPlus /> Invitar usuario</Button>
      </div>

      <div className="glass-card overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-4 py-2.5 font-medium">Usuario</th>
              <th className="px-4 py-2.5 font-medium">Rol</th>
              <th className="px-4 py-2.5 font-medium">Skills</th>
              <th className="px-4 py-2.5 font-medium">Capacidad/día</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {(users || []).map((u) => {
              const p = profileOf(u.id)
              return (
                <tr key={u.id} className="border-b border-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar name={u.full_name} />
                      <div>
                        <p className="font-medium text-slate-800">{u.full_name}</p>
                        <p className="text-xs text-slate-400">{u.email}{u.role === 'admin' && ' · system admin'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${ROLE_CLS[p?.custom_role] || ROLE_CLS.VIEWER}`}>{p?.custom_role || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(p?.skills_tags || []).map((s) => <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{s}</span>)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p?.capacity_per_day ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p ? { ...p, skills_tags: (p.skills_tags || []).join(', '), _userName: u.full_name } : { user_id: u.id, custom_role: 'VIEWER', name: u.full_name, skills_tags: '', capacity_per_day: 3, _userName: u.full_name })}>
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Perfil de {editing._userName}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Rol</Label>
                <Select value={editing.custom_role} onValueChange={(v) => setEditing({ ...editing, custom_role: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Skills (separadas por coma)</Label><Input className="mt-1" value={editing.skills_tags} onChange={(e) => setEditing({ ...editing, skills_tags: e.target.value })} placeholder="UGC, VSL, captions" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Capacidad/día</Label><Input type="number" className="mt-1" value={editing.capacity_per_day ?? 3} onChange={(e) => setEditing({ ...editing, capacity_per_day: Number(e.target.value) })} /></div>
                <div><Label>Discord user ID</Label><Input className="mt-1" value={editing.discord_user_id || ''} onChange={(e) => setEditing({ ...editing, discord_user_id: e.target.value })} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={saveProfile} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invitar usuario</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Email</Label>
              <div className="relative mt-1">
                <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input className="pl-8" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="nuevo@equipo.com" />
              </div>
            </div>
            <div>
              <Label>Rol inicial</Label>
              <Select value={invite.role} onValueChange={(v) => setInvite({ ...invite, role: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={doInvite}><UserPlus /> Enviar invitación</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
