// Auth real: Supabase Auth (email+password) + rol desde `profiles.custom_role`.
// Se mantiene "Ver como" (ADMIN simula otro rol para revisar la UI del equipo).
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseConfigured } from '@/api/supabaseClient'

const AuthContext = createContext(null)
const VIEW_AS_KEY = 'admin_view_as_role'

export function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [viewAsRole, setViewAsRoleState] = useState(() => localStorage.getItem(VIEW_AS_KEY) || null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return }
    const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle()
    // Fallo transitorio (red/RLS): NO degradar el perfil a null → si no, un ADMIN
    // caería a VIEWER en silencio. Conserva el perfil actual hasta el próximo pull.
    if (error) return
    setProfile(data || null)
  }, [])

  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return }
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      await loadProfile(session?.user?.id)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      // Perfil ANTES de exponer la sesión: si no, hay un render con rol VIEWER
      // (perfil aún null) y RequireRole redirige mal el aterrizaje del ADMIN.
      await loadProfile(session?.user?.id)
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [loadProfile])

  const value = useMemo(() => {
    const user = session?.user || null
    const baseRole = profile?.custom_role || 'VIEWER'
    const effectiveRole = baseRole === 'ADMIN' && viewAsRole ? viewAsRole : baseRole
    return {
      loading,
      configured: supabaseConfigured,
      user,
      currentUser: user ? { id: user.id, email: user.email, full_name: profile?.name || user.email } : null,
      profile,
      baseRole,
      effectiveRole,
      isSystemAdmin: baseRole === 'ADMIN',
      isViewingAs: baseRole === 'ADMIN' && !!viewAsRole,
      viewAsRole,
      setViewAsRole: (role) => {
        if (role) localStorage.setItem(VIEW_AS_KEY, role)
        else localStorage.removeItem(VIEW_AS_KEY)
        setViewAsRoleState(role)
      },
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      signOut: async () => {
        localStorage.removeItem(VIEW_AS_KEY)
        setViewAsRoleState(null)
        await supabase.auth.signOut()
        // Vaciar la caché de queries: si no, otro usuario en el mismo navegador
        // (p.ej. un EDITOR tras un ADMIN) vería datos con dinero cacheados.
        queryClient.clear()
      },
    }
  }, [loading, session, profile, viewAsRole, queryClient])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
