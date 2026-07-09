// Normalización de filas de guión que publica el pipeline (Claude alterna
// mayúsculas/minúsculas y campos alternativos content/text entre runs).
export const SCRIPT_COLS = [
  ['vo', 'VO'], ['clip', 'CLIP'], ['sfx', 'SFX'], ['trans', 'TRANS'], ['zoom', 'ZOOM'],
]

export function normRow(r) {
  const out = {}
  for (const [k, v] of Object.entries(r || {})) {
    if (typeof v !== 'string' || !v) continue
    const lk = k.toLowerCase()
    if (lk === 'content' || lk === 'text') out.vo = out.vo || v
    else out[lk] = v
  }
  return out
}
