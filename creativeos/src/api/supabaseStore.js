// Adaptador Supabase con la MISMA interfaz que el viejo store.js localStorage:
//   Entity.list / filter / get / create / update / delete / subscribe
// → las páginas y useData.js siguen funcionando igual, pero los datos son
// compartidos (Postgres + RLS) y en tiempo real (canales postgres_changes).
import { supabase } from './supabaseClient'

const anyListeners = new Set()
const tableListeners = new Map()

export function onAnyChange(cb) {
  anyListeners.add(cb)
  return () => anyListeners.delete(cb)
}

function emit(table) {
  ;(tableListeners.get(table) || []).forEach((cb) => { try { cb() } catch {} })
  anyListeners.forEach((cb) => { try { cb(table) } catch {} })
}

// Un canal realtime por tabla (solo las incluidas en supabase_realtime emiten;
// para el resto el canal queda inerte y React Query refresca por invalidación local).
const channels = new Map()
function ensureChannel(table) {
  if (!supabase || channels.has(table)) return
  const ch = supabase
    .channel(`db:${table}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, () => emit(table))
    .subscribe()
  channels.set(table, ch)
}

function applySort(query, sort) {
  if (!sort) return query
  const desc = sort.startsWith('-')
  const field = desc ? sort.slice(1) : sort
  return query.order(field, { ascending: !desc })
}

export function createEntity(table, { pk = 'id' } = {}) {
  return {
    name: table,
    pk,
    async list(sort = null, limit) {
      let q = supabase.from(table).select('*')
      q = applySort(q, sort)
      if (limit) q = q.limit(limit)
      const { data, error } = await q
      if (error) throw new Error(`${table}.list: ${error.message}`)
      return data || []
    },
    async filter(query = {}, sort = null, limit) {
      let q = supabase.from(table).select('*')
      for (const [k, v] of Object.entries(query)) {
        q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v)
      }
      q = applySort(q, sort)
      if (limit) q = q.limit(limit)
      const { data, error } = await q
      if (error) throw new Error(`${table}.filter: ${error.message}`)
      return data || []
    },
    async get(id) {
      const { data, error } = await supabase.from(table).select('*').eq(pk, id).maybeSingle()
      if (error) throw new Error(`${table}.get: ${error.message}`)
      return data
    },
    async create(row) {
      const { data, error } = await supabase.from(table).insert(row).select().single()
      if (error) throw new Error(`${table}.create: ${error.message}`)
      emit(table)
      return data
    },
    async bulkCreate(rows) {
      const { data, error } = await supabase.from(table).insert(rows).select()
      if (error) throw new Error(`${table}.bulkCreate: ${error.message}`)
      emit(table)
      return data || []
    },
    async update(id, patch) {
      const { data, error } = await supabase.from(table).update(patch).eq(pk, id).select().single()
      if (error) throw new Error(`${table}.update: ${error.message}`)
      emit(table)
      return data
    },
    async upsert(row, onConflict = pk) {
      const { data, error } = await supabase.from(table).upsert(row, { onConflict }).select().single()
      if (error) throw new Error(`${table}.upsert: ${error.message}`)
      emit(table)
      return data
    },
    async delete(id) {
      // .select() para detectar el caso "0 filas borradas": RLS deniega en
      // silencio y sin esto la UI daría éxito con el item aún vivo.
      const { data, error } = await supabase.from(table).delete().eq(pk, id).select()
      if (error) throw new Error(`${table}.delete: ${error.message}`)
      if (!data?.length) throw new Error(`${table}.delete: 0 filas borradas (¿permiso RLS?)`)
      emit(table)
      return true
    },
    subscribe(cb) {
      ensureChannel(table)
      if (!tableListeners.has(table)) tableListeners.set(table, new Set())
      tableListeners.get(table).add(cb)
      return () => tableListeners.get(table)?.delete(cb)
    },
  }
}
