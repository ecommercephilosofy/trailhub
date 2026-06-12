import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { onAnyChange } from '@/api/store'

// Invalidate entity queries on any store mutation → instant "real-time" UI.
export function useStoreSync() {
  const qc = useQueryClient()
  useEffect(() => onAnyChange((entityName) => {
    if (entityName === '*') qc.invalidateQueries()
    else qc.invalidateQueries({ queryKey: [entityName] })
  }), [qc])
}

export function useEntityList(entity, { filter, sort, limit, staleTime = 60_000, enabled = true } = {}) {
  return useQuery({
    queryKey: [entity.name, { filter, sort, limit }],
    queryFn: () => (filter ? entity.filter(filter, sort, limit) : entity.list(sort, limit)),
    staleTime,
    enabled,
  })
}
