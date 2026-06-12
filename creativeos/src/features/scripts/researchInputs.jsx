// Reusable research selectors for Generate/Manual dialogs:
// searchable avatar combobox + multi-select with removable tags (first = principal ⭐)

import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Dedup by external id (avatar_id/angle_id/…) before DB id; hide inactive.
export function dedupResearch(items, externalKey) {
  const seen = new Set()
  return (items || []).filter((it) => {
    if (it.is_active === false) return false
    const key = it[externalKey] || it.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function AvatarCombobox({ items, value, onChange, onCreateNew }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const selected = items.find((i) => i.id === value)
  const filtered = useMemo(() => items.filter((i) => !q || i.nombre?.toLowerCase().includes(q.toLowerCase())), [items, q])
  return (
    <div className="flex gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="flex-1 justify-between font-normal">
            <span className="truncate">{selected ? selected.nombre : 'Seleccionar avatar…'}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-1.5" align="start">
          <Input autoFocus placeholder="Buscar avatar…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-1.5 h-8" />
          <div className="max-h-52 overflow-y-auto scrollbar-thin">
            {filtered.length === 0 && <p className="py-3 text-center text-xs text-slate-400">Sin resultados</p>}
            {filtered.map((item) => (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { onChange(item.id === value ? null : item.id); setOpen(false) }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-indigo-50"
                  >
                    <Check className={cn('h-3.5 w-3.5 text-indigo-600', item.id !== value && 'opacity-0')} />
                    <span className="truncate">{item.nombre}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.descripcion || 'Sin descripción'}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {onCreateNew && <Button type="button" size="icon" variant="outline" onClick={onCreateNew} title="Crear nuevo avatar"><Plus /></Button>}
    </div>
  )
}

const TAG_COLORS = {
  angle: 'bg-purple-100 text-purple-700 border-purple-200',
  desire: 'bg-pink-100 text-pink-700 border-pink-200',
  problem: 'bg-orange-100 text-orange-700 border-orange-200',
}

export function MultiSelectTags({ items, values = [], onChange, kind, placeholder, onCreateNew }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const selectedItems = values.map((v) => items.find((i) => i.id === v)).filter(Boolean)
  const filtered = items.filter((i) => !values.includes(i.id) && (!q || i.nombre?.toLowerCase().includes(q.toLowerCase())))
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="flex-1 justify-between font-normal text-slate-500">
              {placeholder}
              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-1.5" align="start">
            <Input autoFocus placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-1.5 h-8" />
            <div className="max-h-52 overflow-y-auto scrollbar-thin">
              {filtered.length === 0 && <p className="py-3 text-center text-xs text-slate-400">Sin resultados</p>}
              {filtered.map((item) => (
                <button key={item.id} onClick={() => { onChange([...values, item.id]); setOpen(false); setQ('') }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-indigo-50">
                  <span className="truncate">{item.nombre}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {onCreateNew && <Button type="button" size="icon" variant="outline" onClick={onCreateNew} title="Crear nuevo"><Plus /></Button>}
      </div>
      {selectedItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedItems.map((item, i) => (
            <span key={item.id} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', TAG_COLORS[kind])}>
              {i === 0 && '⭐'} {item.nombre}
              <button onClick={() => onChange(values.filter((v) => v !== item.id))} className="ml-0.5 hover:opacity-60"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function InlineCreateForm({ title, fields, onSubmit, onCancel, bg = 'bg-blue-50' }) {
  const [form, setForm] = useState({})
  return (
    <div className={cn('rounded-lg border border-slate-200 p-3 space-y-2', bg)}>
      <p className="text-xs font-semibold text-slate-700">{title}</p>
      {fields.map((f) => (
        <Input key={f.key} placeholder={f.label} value={form[f.key] || ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className="h-8 bg-white" />
      ))}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSubmit(form)} disabled={fields.some((f) => f.required && !form[f.key]?.trim())}>Crear</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  )
}

export const HOOK_TYPES = [
  { value: 'CONSPIRACY', label: 'Conspiración', formats: 'VSL, Authority' },
  { value: 'QUESTION', label: 'Pregunta', formats: 'UGC, Testimonial' },
  { value: 'STATISTIC', label: 'Estadística', formats: 'Authority, VSL' },
  { value: 'PERSONAL_STORY', label: 'Historia personal', formats: 'UGC, Testimonial, Before/After' },
  { value: 'CONTRADICTION', label: 'Contradicción', formats: 'Problem-Solution, VSL' },
  { value: 'VISUAL_DEMO', label: 'Demo visual', formats: 'POV, Problem-Solution' },
  { value: 'RESULT_FIRST', label: 'Resultado primero', formats: 'Before/After, Testimonial' },
  { value: 'DOCUMENTARY', label: 'Documental', formats: 'Authority, VSL' },
  { value: 'HUMOR', label: 'Humor', formats: 'UGC, POV' },
  { value: 'CHALLENGE', label: 'Reto', formats: 'UGC, Problem-Solution' },
]
