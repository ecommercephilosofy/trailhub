import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Sparkles, LayoutDashboard, FileText, Clapperboard, TrendingUp, Telescope,
  Coins, MessageCircle, Shield, Menu, X, Bell, LogOut, Eye, Moon, Sun, Briefcase, Settings2,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/api/supabaseClient'
import { Notifications } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { UserAvatar } from '@/components/shared/badges'
import { ErrorBoundary } from '@/components/shared/misc'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn, timeAgo } from '@/lib/utils'
import { useBrand } from '@/context/BrandContext'

export const NAV_ITEMS = [
  { path: '/', title: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'MANAGER'] },
  { path: '/Direccion', title: 'Dirección', icon: Briefcase, roles: ['ADMIN', 'MANAGER'] },
  { path: '/Briefs', title: 'Briefs', icon: FileText, roles: ['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER'] },
  { path: '/VideoOps', title: 'Video Ops', icon: Clapperboard, roles: ['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER'] },
  { path: '/Performance', title: 'Performance', icon: TrendingUp, roles: ['ADMIN', 'MANAGER'] },
  { path: '/Competencia', title: 'Competencia', icon: Telescope, roles: ['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER'] },
  { path: '/Bonuses', title: 'Bonuses', icon: Coins, roles: ['ADMIN', 'MANAGER', 'EDITOR'] },
  { path: '/Chat', title: 'Chat', icon: MessageCircle, roles: ['ADMIN', 'MANAGER'] },
  { path: '/Admin', title: 'Admin', icon: Shield, roles: ['ADMIN'] },
  { path: '/Ajustes', title: 'Ajustes', icon: Settings2, roles: ['ADMIN'] },
]

const ROLE_BADGE = {
  ADMIN: 'bg-indigo-100 text-indigo-700',
  MANAGER: 'bg-purple-100 text-purple-700',
  EDITOR: 'bg-emerald-100 text-emerald-700',
  VIEWER: 'bg-slate-100 text-slate-600',
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])
  return (
    <button onClick={() => setDark((d) => !d)} title={dark ? 'Modo claro' : 'Modo oscuro'}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  )
}

// Los broadcasts (target_user_id null) comparten la columna `read` y la RLS solo
// deja a cada usuario marcar SUS notificaciones → no se pueden marcar en la BD sin
// pisar a los demás. Guardamos su estado de leído por-usuario en localStorage,
// así el badge de no-leídas puede llegar a cero.
const READ_BCAST_KEY = 'notif_read_broadcasts'
function loadReadBroadcasts() {
  try { return new Set(JSON.parse(localStorage.getItem(READ_BCAST_KEY) || '[]')) }
  catch { return new Set() }
}

function NotificationsBell() {
  const { user } = useAuth()
  const { data: notifs, refetch } = useEntityList(Notifications, { sort: '-created_at', limit: 30, staleTime: 30_000 })
  const [readBcast, setReadBcast] = useState(loadReadBroadcasts)
  const mine = (notifs || []).filter((nf) => !nf.target_user_id || nf.target_user_id === user?.id).slice(0, 10)
  const isRead = (nf) => nf.read || (!nf.target_user_id && readBcast.has(nf.id))
  const unread = mine.filter((nf) => !isRead(nf)).length
  const markAllRead = async () => {
    const ownIds = mine.filter((x) => !isRead(x) && x.target_user_id === user?.id).map((x) => x.id)
    const bcastIds = mine.filter((x) => !isRead(x) && !x.target_user_id).map((x) => x.id)
    if (ownIds.length) {
      // Un solo UPDATE ... IN (antes: N peticiones secuenciales)
      await supabase.from('notifications').update({ read: true }).in('id', ownIds)
    }
    if (bcastIds.length) {
      const next = new Set([...readBcast, ...bcastIds])
      localStorage.setItem(READ_BCAST_KEY, JSON.stringify([...next]))
      setReadBcast(next)
    }
    refetch()
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
          <Bell className="h-5 w-5" />
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <span className="text-sm font-semibold">Notificaciones</span>
          {unread > 0 && <button onClick={markAllRead} className="text-xs text-indigo-600 hover:underline">Marcar leídas</button>}
        </div>
        <div className="max-h-80 overflow-y-auto scrollbar-thin">
          {mine.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">Sin notificaciones</p>}
          {mine.map((nf) => (
            <div key={nf.id} className={cn('border-b border-slate-50 px-3 py-2.5', !isRead(nf) && 'bg-indigo-50/50')}>
              <p className="text-sm font-medium text-slate-800 leading-snug">{nf.title}</p>
              {nf.body && <p className="text-xs text-slate-500 mt-0.5">{nf.body}</p>}
              <p className="text-[10px] text-slate-400 mt-1">{timeAgo(nf.created_at)}</p>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default function Layout({ children }) {
  const { currentUser, baseRole, effectiveRole, viewAsRole, setViewAsRole, signOut } = useAuth()
  const { brand } = useBrand()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const nav = NAV_ITEMS.filter((item) => item.roles.includes(effectiveRole))
  const active = NAV_ITEMS.find((i) => i.path === location.pathname)

  const SidebarContent = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 p-2 shadow-lg shadow-indigo-200">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="font-bold text-slate-900 leading-none">{brand.appName}</p>
          <p className="text-[10px] text-slate-400 mt-0.5 tracking-wide">{brand.tagline}</p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-3 space-y-0.5">
        {nav.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-gradient-to-r from-indigo-500/10 to-purple-500/10 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.title}</span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-200/60 p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-slate-100 text-left">
              <UserAvatar name={currentUser?.full_name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{currentUser?.full_name}</p>
                <p className="truncate text-xs text-slate-400">{currentUser?.email}</p>
              </div>
              <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold', ROLE_BADGE[baseRole])}>{baseRole}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel>{currentUser?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-600" onClick={signOut}><LogOut /> Cerrar sesión</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen page-bg">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[272px] border-r border-slate-200/60 bg-white/70 backdrop-blur-md lg:block">
        {SidebarContent}
      </aside>
      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[272px] bg-white shadow-xl animate-in slide-in-from-left">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 p-1 text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            {SidebarContent}
          </aside>
        </div>
      )}

      <div className="lg:pl-[272px]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200/60 bg-white/70 px-4 backdrop-blur-md sm:px-6">
          <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"><Menu className="h-5 w-5" /></button>
          <h1 className="flex-1 truncate text-base font-semibold text-slate-800">{active?.title || brand.appName}</h1>
          {baseRole === 'ADMIN' && (
            <div className="hidden items-center gap-1.5 sm:flex">
              <Eye className="h-4 w-4 text-slate-400" />
              <span className="text-xs text-slate-500">Ver como:</span>
              <Select value={viewAsRole || 'ADMIN'} onValueChange={(v) => setViewAsRole(v === 'ADMIN' ? null : v)}>
                <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {effectiveRole !== baseRole && (
            <span className="hidden rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 sm:inline">SIMULANDO {effectiveRole}</span>
          )}
          <ThemeToggle />
          <NotificationsBell />
        </header>
        <main className="p-4 sm:p-6 max-w-[1600px]">
          {/* key=pathname: al navegar se resetea el boundary (un crash en una página no bloquea las demás) */}
          <ErrorBoundary key={location.pathname}>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
