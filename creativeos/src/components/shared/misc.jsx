import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function LoadingSpinner({ size = 'default', className }) {
  const s = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-6 w-6'
  return (
    <div className={cn('flex items-center justify-center py-10', className)}>
      <Loader2 className={cn(s, 'animate-spin text-indigo-500')} />
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4 text-center', className)}>
      {Icon && (
        <div className="mb-3 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 p-4">
          <Icon className="h-7 w-7 text-indigo-500" />
        </div>
      )}
      <h3 className="font-semibold text-slate-800">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
