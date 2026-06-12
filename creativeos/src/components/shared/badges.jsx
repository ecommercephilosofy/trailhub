import { cn, initials } from '@/lib/utils'
import { Flame, Trophy, Minus, X, HelpCircle, Video, Mic, Star, Eye, BookOpen, MessageSquare } from 'lucide-react'

const STATUS_STYLES = {
  SCRIPT_DRAFT: 'bg-slate-100 text-slate-600',
  TODO: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  REVIEW: 'bg-purple-100 text-purple-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  PUBLISHED: 'bg-green-100 text-green-800',
  ARCHIVED: 'bg-slate-100 text-slate-500',
  DRAFT: 'bg-slate-100 text-slate-600',
  READY: 'bg-blue-100 text-blue-700',
  SENT: 'bg-indigo-100 text-indigo-700',
  NEEDS_EDIT: 'bg-amber-100 text-amber-700',
  REJECTED: 'bg-red-100 text-red-700',
  DONE: 'bg-emerald-100 text-emerald-700',
  BLOCKED: 'bg-red-100 text-red-700',
  WINNER: 'bg-emerald-100 text-emerald-700',
  REGULAR: 'bg-amber-100 text-amber-700',
  LOSER: 'bg-red-100 text-red-700',
  UNSCORED: 'bg-slate-100 text-slate-500',
  SUCCESS: 'bg-emerald-100 text-emerald-700',
  ERROR: 'bg-red-100 text-red-700',
  RUNNING: 'bg-blue-100 text-blue-700',
  OPEN: 'bg-blue-100 text-blue-700',
  CLOSED: 'bg-slate-100 text-slate-500',
  PENDING: 'bg-amber-100 text-amber-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  BASE: 'bg-indigo-100 text-indigo-700',
  ITERATION: 'bg-purple-100 text-purple-700',
}

const STATUS_LABELS = {
  SCRIPT_DRAFT: 'Script Draft', TODO: 'To Do', IN_PROGRESS: 'In Progress', REVIEW: 'Review',
  APPROVED: 'Approved', PUBLISHED: 'Published', ARCHIVED: 'Archived', NEEDS_EDIT: 'Needs Edit',
}

export function StatusBadge({ status, className }) {
  if (!status) return null
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_STYLES[status] || 'bg-slate-100 text-slate-600', className)}>
      {STATUS_LABELS[status] || status.replace(/_/g, ' ')}
    </span>
  )
}

const FORMAT_STYLES = {
  UGC: 'bg-indigo-100 text-indigo-700',
  VSL: 'bg-purple-100 text-purple-700',
  TESTIMONIAL: 'bg-emerald-100 text-emerald-700',
  POV: 'bg-orange-100 text-orange-700',
  AUTHORITY: 'bg-blue-100 text-blue-700',
  PROBLEM_SOLUTION: 'bg-rose-100 text-rose-700',
  GREEN_SCREEN: 'bg-lime-100 text-lime-700',
  COMPARISON: 'bg-cyan-100 text-cyan-700',
  BEFORE_AFTER: 'bg-fuchsia-100 text-fuchsia-700',
}
const FORMAT_ICONS = { UGC: Video, VSL: Mic, TESTIMONIAL: MessageSquare, POV: Eye, AUTHORITY: BookOpen, PROBLEM_SOLUTION: Star }

export function FormatBadge({ format, size, showIcon = false, className }) {
  if (!format) return null
  const Icon = FORMAT_ICONS[format]
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
      size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
      FORMAT_STYLES[format] || 'bg-slate-100 text-slate-600', className
    )}>
      {showIcon && Icon && <Icon className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />}
      {format.replace(/_/g, '-')}
    </span>
  )
}

const PRIORITY_STYLES = {
  LOW: 'bg-slate-100 text-slate-600',
  MEDIUM: 'bg-amber-100 text-amber-700',
  HIGH: 'bg-orange-100 text-orange-700',
  URGENT: 'bg-red-100 text-red-700',
}

export function PriorityBadge({ priority, className }) {
  if (!priority) return null
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', PRIORITY_STYLES[priority] || PRIORITY_STYLES.MEDIUM, className)}>
      {priority}
    </span>
  )
}

const LABEL_META = {
  WINNER: { icon: Trophy, text: 'Winner', cls: 'bg-emerald-100 text-emerald-700' },
  REGULAR: { icon: Minus, text: 'Regular', cls: 'bg-amber-100 text-amber-700' },
  LOSER: { icon: X, text: 'Loser', cls: 'bg-red-100 text-red-700' },
  UNSCORED: { icon: HelpCircle, text: 'Unscored', cls: 'bg-slate-100 text-slate-500' },
}
const ACTION_CLS = { SCALE: 'bg-emerald-500 text-white', ITERATE: 'bg-amber-500 text-white', KILL: 'bg-red-500 text-white' }

export function PerformanceLabel({ label, action, className }) {
  const meta = LABEL_META[label] || LABEL_META.UNSCORED
  const Icon = meta.icon
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', meta.cls)}>
        <Icon className="h-3 w-3" /> {meta.text}
      </span>
      {action && <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide', ACTION_CLS[action])}>{action}</span>}
    </span>
  )
}

export function FatigueIndicator({ reasons = [], severity = 'MEDIUM', className }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', severity === 'HIGH' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700', className)} title={reasons.join(' · ')}>
      <Flame className="h-3 w-3" /> Fatiga
    </span>
  )
}

const AVATAR_COLORS = ['bg-indigo-500', 'bg-purple-500', 'bg-emerald-500', 'bg-orange-500', 'bg-rose-500', 'bg-cyan-500']

export function UserAvatar({ name, size = 'default', className }) {
  if (!name) return null
  const color = AVATAR_COLORS[(name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % AVATAR_COLORS.length]
  return (
    <span
      title={name}
      className={cn(
        'inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0',
        size === 'sm' ? 'h-5 w-5 text-[9px]' : size === 'lg' ? 'h-10 w-10 text-sm' : 'h-7 w-7 text-[11px]',
        color, className
      )}
    >
      {initials(name)}
    </span>
  )
}
