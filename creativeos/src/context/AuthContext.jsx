import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { AuthUsers, UserProfiles } from '@/api/entities'

const AuthContext = createContext(null)
const CURRENT_USER_KEY = 'creativeos_current_user'
const VIEW_AS_KEY = 'admin_view_as_role'

export function AuthProvider({ children }) {
  const [users, setUsers] = useState([])
  const [profiles, setProfiles] = useState([])
  const [currentUserId, setCurrentUserId] = useState(() => localStorage.getItem(CURRENT_USER_KEY))
  const [viewAsRole, setViewAsRoleState] = useState(() => localStorage.getItem(VIEW_AS_KEY) || null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const [u, p] = await Promise.all([AuthUsers.list('created_date'), UserProfiles.list('created_date')])
    setUsers(u)
    setProfiles(p)
    return { u, p }
  }, [])

  useEffect(() => {
    ;(async () => {
      const { u, p } = await reload()
      let uid = localStorage.getItem(CURRENT_USER_KEY)
      if (!uid || !u.find((x) => x.id === uid)) {
        uid = u[0]?.id
        if (uid) localStorage.setItem(CURRENT_USER_KEY, uid)
      }
      setCurrentUserId(uid)
      // Auto-create profile on first login (default role from system role)
      const user = u.find((x) => x.id === uid)
      if (user && !p.find((x) => x.user_id === uid)) {
        await UserProfiles.create({
          user_id: uid, custom_role: user.role === 'admin' ? 'ADMIN' : 'VIEWER', name: user.full_name,
          timezone: 'Europe/Madrid', skills_tags: [], capacity_per_day: 3,
          notification_prefs: { notify_on_task_assigned: true, notify_on_task_updated: true, notify_on_video_note_added: true, notify_on_script_assigned: true },
          onboarding_completed: false,
        })
        await reload()
      }
      setLoading(false)
    })()
  }, [reload])

  useEffect(() => {
    const unsub1 = UserProfiles.subscribe(reload)
    const unsub2 = AuthUsers.subscribe(reload)
    return () => { unsub1(); unsub2() }
  }, [reload])

  const value = useMemo(() => {
    const currentUser = users.find((u) => u.id === currentUserId) || null
    const profile = profiles.find((p) => p.user_id === currentUserId) || null
    const isSystemAdmin = currentUser?.role === 'admin'
    const baseRole = isSystemAdmin ? 'ADMIN' : profile?.custom_role || 'VIEWER'
    const effectiveRole = baseRole === 'ADMIN' && viewAsRole ? viewAsRole : baseRole
    return {
      loading, users, profiles, currentUser, profile,
      baseRole, effectiveRole, isSystemAdmin,
      isViewingAs: baseRole === 'ADMIN' && !!viewAsRole,
      switchUser: (id) => { localStorage.setItem(CURRENT_USER_KEY, id); setCurrentUserId(id) },
      setViewAsRole: (role) => {
        if (role) localStorage.setItem(VIEW_AS_KEY, role)
        else localStorage.removeItem(VIEW_AS_KEY)
        setViewAsRoleState(role)
      },
      viewAsRole,
    }
  }, [loading, users, profiles, currentUserId, viewAsRole])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
