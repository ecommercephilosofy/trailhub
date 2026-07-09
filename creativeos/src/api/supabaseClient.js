// Cliente Supabase único. Credenciales por env (Vite): .env local + Vercel env.
// La ANON key es pública por diseño (la seguridad real es RLS + sesión).
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Capturado ANTES de que supabase-js parsee y limpie el hash de la URL:
// si el usuario llega desde un link de invitación/recovery, la app debe
// mostrarle la pantalla de crear contraseña tras establecerse la sesión.
export const arrivedFromAuthLink = typeof window !== 'undefined'
  && /type=(invite|recovery|magiclink)/.test(window.location.hash)

export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = supabaseConfigured
  ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  : null
