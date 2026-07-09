import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { onAnyChange } from '@/api/supabaseStore'

// Invalidate entity queries on any store mutation → instant "real-time" UI.
export function useStoreSync() {
  const qc = useQueryClient()
  useEffect(() => onAnyChange((entityName) => {
    if (entityName === '*') qc.invalidateQueries()
    else qc.invalidateQueries({ queryKey: [entityName] })
  }), [qc])
}

export function useEntityList(entity, { filter, sort, limit, staleTime = 60_000, enabled = true } = {}) {
  const qc = useQueryClient()
  // Suscripción por tabla: abre el canal Realtime de Supabase (lazy, uno por
  // tabla) y refresca la query cuando OTRO cliente muta — el kanban de dos
  // navegadores se ve en vivo. Las mutaciones locales también emiten aquí.
  useEffect(() => {
    if (!enabled) return undefined
    return entity.subscribe(() => qc.invalidateQueries({ queryKey: [entity.name] }))
  }, [entity, enabled, qc])
  return useQuery({
    queryKey: [entity.name, { filter, sort, limit }],
    queryFn: () => (filter ? entity.filter(filter, sort, limit) : entity.list(sort, limit)),
    staleTime,
    enabled,
  })
}
