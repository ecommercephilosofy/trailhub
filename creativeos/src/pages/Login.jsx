import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function Login() {
  const { signIn, configured } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err.message === 'Invalid login credentials'
        ? 'Email o contraseña incorrectos'
        : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen page-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold text-slate-900">CreativeOS</div>
          <div className="text-sm text-slate-500 mt-1">Quies — sistema creativo semanal</div>
        </div>
        {!configured ? (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Falta configurar Supabase: crea <code>.env</code> con
            <code> VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> y reinicia.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Input type="email" required placeholder="email"
                   value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            <Input type="password" required placeholder="contraseña"
                   value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <div className="text-sm text-red-600">{error}</div>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Entrando…' : 'Entrar'}
            </Button>
            <div className="text-xs text-slate-400 text-center pt-1">
              ¿Sin cuenta? Pídesela al administrador.
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
