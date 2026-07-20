// Formateo de números reconfigurable por locale (BrandContext llama
// setCurrencyFormat). El dinero con símbolo va por BrandContext.fmtMoneyFrom
// (convierte divisas); aquí solo queda el separador de miles.
let num = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })

export function setCurrencyFormat(locale = 'es-ES') {
  try {
    num = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  } catch { /* locale invalido: mantener formato anterior */ }
}

export const fmtNum = (v) => num.format(v || 0)
export const fmtPct = (v, d = 1) => `${(v || 0).toFixed(d)}%`
export const fmtRoas = (v) => `${(v || 0).toFixed(2)}x`
export const fmtSec = (s) => {
  if (s == null) return '—'
  if (s < 60) return `${Math.round(s)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}
export const fmtDate = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}
export const fmtDateTime = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
