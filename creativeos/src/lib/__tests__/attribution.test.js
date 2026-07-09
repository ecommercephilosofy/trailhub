import { describe, it, expect } from 'vitest'
import { extractAdCode, qbToEditorMap, attributeLifecycle } from '../attribution'
import { normRow } from '../briefScript'

// Camino del dinero: si algo aquí rompe, un editor cobra mal (o no cobra).

describe('extractAdCode', () => {
  it('extrae código simple', () => {
    expect(extractAdCode('FER0077')).toBe('FER0077')
  })
  it('underscore → dash y conserva sufijo', () => {
    expect(extractAdCode('FER0077_HOOK2')).toBe('FER0077-HOOK2')
  })
  it('encuentra el código dentro de un título largo', () => {
    expect(extractAdCode('Video final v3 QB0123 listo para lanzar')).toBe('QB0123')
  })
  it('case-insensitive (título en minúsculas)', () => {
    expect(extractAdCode('fer0077 hook nuevo')).toBe('FER0077')
  })
  it('sufijo de versión con dash', () => {
    expect(extractAdCode('IF12345-V2')).toBe('IF12345-V2')
  })
  it('null cuando no hay código', () => {
    expect(extractAdCode('video sin código')).toBeNull()
    expect(extractAdCode('')).toBeNull()
    expect(extractAdCode(null)).toBeNull()
  })
})

describe('qbToEditorMap', () => {
  it('solo tarjetas con brief Y editor', () => {
    const cards = [
      { brief_tracking_code: 'QB01', assigned_editor: 'u1' },
      { brief_tracking_code: 'QB02', assigned_editor: null },
      { brief_tracking_code: null, assigned_editor: 'u2' },
    ]
    expect(qbToEditorMap(cards)).toEqual({ QB01: 'u1' })
  })
  it('tolera null/undefined', () => {
    expect(qbToEditorMap(null)).toEqual({})
  })
})

describe('attributeLifecycle', () => {
  const qbToEditor = { QB01: 'laura' }
  const ads = [
    { ad_code: 'FER0077', qb_code_detected: 'QB01' },
    { ad_code: 'FER0088', qb_code_detected: 'QB99' },   // QB sin tarjeta asignada
    { ad_code: 'FER0099', qb_code_detected: null },      // sin QB
  ]
  const lifecycle = [
    { code: 'FER0077', lifetime_spend: 2000 },
    { code: 'FER0088', lifetime_spend: 500 },
    { code: 'FER0099', lifetime_spend: 100 },
  ]

  it('atribuye solo ads cuyo QB tiene editor asignado', () => {
    const out = attributeLifecycle(lifecycle, ads, qbToEditor)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ code: 'FER0077', qb: 'QB01', editor: 'laura' })
  })
  it('vacío sin datos', () => {
    expect(attributeLifecycle(null, null, {})).toEqual([])
  })
})

describe('normRow (guiones del pipeline)', () => {
  it('normaliza claves a minúsculas', () => {
    expect(normRow({ VO: 'hola', Clip: 'plano' })).toEqual({ vo: 'hola', clip: 'plano' })
  })
  it('content/text → vo sin pisar un vo existente', () => {
    expect(normRow({ content: 'texto' })).toEqual({ vo: 'texto' })
    expect(normRow({ vo: 'real', text: 'alt' })).toEqual({ vo: 'real' })
  })
  it('descarta valores no-string y vacíos', () => {
    expect(normRow({ vo: '', clip: 42, sfx: 'boom' })).toEqual({ sfx: 'boom' })
  })
  it('tolera null', () => {
    expect(normRow(null)).toEqual({})
  })
})
