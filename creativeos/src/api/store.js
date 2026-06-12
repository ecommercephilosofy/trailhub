// Local-first data layer with a Base44-style entity SDK:
// Entity.list / filter / get / create / update / delete / subscribe
// Persisted in localStorage, pub/sub for real-time UI, cross-tab via 'storage' events.

import { seedDatabase } from './seed'

const KEY = 'creativeos_db_v1'
let db = null
const listeners = new Map()
const anyListeners = new Set()

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) { console.warn('DB load failed', e) }
  return null
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)) } catch (e) { console.warn('DB persist failed', e) }
}

export function getDB() {
  if (!db) {
    db = load()
    if (!db) { db = seedDatabase(); persist() }
  }
  return db
}

export function resetDB() {
  db = seedDatabase()
  persist()
  emit('*')
}

function emit(entityName) {
  if (entityName !== '*') (listeners.get(entityName) || []).forEach((cb) => { try { cb() } catch {} })
  anyListeners.forEach((cb) => { try { cb(entityName) } catch {} })
}

export function onAnyChange(cb) {
  anyListeners.add(cb)
  return () => anyListeners.delete(cb)
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { db = load(); emit('*') }
  })
}

let seq = 1000
export const uid = (p = 'rec') => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`

const delay = (ms = 40) => new Promise((r) => setTimeout(r, ms))

function applySort(rows, sort) {
  if (!sort) return rows
  const desc = sort.startsWith('-')
  const field = desc ? sort.slice(1) : sort
  return [...rows].sort((a, b) => {
    const av = a[field], bv = b[field]
    if (av === bv) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return (av < bv ? -1 : 1) * (desc ? -1 : 1)
  })
}

function matches(rec, query) {
  return Object.entries(query).every(([k, v]) => {
    if (Array.isArray(v)) return v.includes(rec[k])
    return rec[k] === v
  })
}

export function createEntity(name) {
  const table = () => {
    const d = getDB()
    if (!d[name]) d[name] = []
    return d[name]
  }
  return {
    name,
    async list(sort = '-created_date', limit) {
      await delay()
      let rows = applySort(table(), sort)
      if (limit) rows = rows.slice(0, limit)
      return rows.map((r) => ({ ...r }))
    },
    async filter(query = {}, sort = '-created_date', limit) {
      await delay()
      let rows = applySort(table().filter((r) => matches(r, query)), sort)
      if (limit) rows = rows.slice(0, limit)
      return rows.map((r) => ({ ...r }))
    },
    async get(id) {
      await delay(10)
      const r = table().find((r) => r.id === id)
      return r ? { ...r } : null
    },
    async create(data) {
      const now = new Date().toISOString()
      const rec = { id: uid(name.slice(0, 4).toLowerCase()), created_date: now, updated_date: now, ...data }
      table().push(rec)
      persist()
      emit(name)
      return { ...rec }
    },
    async bulkCreate(arr) {
      const now = new Date().toISOString()
      const recs = arr.map((data) => ({ id: uid(name.slice(0, 4).toLowerCase()), created_date: now, updated_date: now, ...data }))
      table().push(...recs)
      persist()
      emit(name)
      return recs.map((r) => ({ ...r }))
    },
    async update(id, patch) {
      const t = table()
      const i = t.findIndex((r) => r.id === id)
      if (i === -1) throw new Error(`${name}#${id} not found`)
      t[i] = { ...t[i], ...patch, updated_date: new Date().toISOString() }
      persist()
      emit(name)
      return { ...t[i] }
    },
    async delete(id) {
      const t = table()
      const i = t.findIndex((r) => r.id === id)
      if (i !== -1) t.splice(i, 1)
      persist()
      emit(name)
      return true
    },
    subscribe(cb) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(cb)
      return () => listeners.get(name)?.delete(cb)
    },
  }
}
