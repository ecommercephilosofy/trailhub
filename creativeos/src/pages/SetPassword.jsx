// Pantalla de crear/restablecer contraseña — se muestra cuando el usuario llega
// desde un link de invitación o recovery (la sesión ya viene en el hash de la URL).
import { useState } from 'react'
import { supabase } from '@/api/supabaseClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBrand } from '@/context/BrandContext'

export default function SetPassword({ onDone }) {
  const { brand } = useBrand()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Mínimo 8 caracteres')
    if (password !== confirm) return setError('Las contraseñas no coinciden')
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen page-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold text-slate-900">{brand.appName}</div>
          <div className="text-sm text-slate-500 mt-1">Crea tu contraseña para entrar</div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Input type="password" required placeholder="nueva contraseña (mín. 8)"
                 value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <Input type="password" required placeholder="repítela"
                 value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {error && <div className="text-sm text-red-600">{error}</div>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar y entrar'}
          </Button>
        </form>
      </div>
    </div>
  )
}
