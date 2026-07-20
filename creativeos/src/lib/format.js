// Formatters reconfigurables por marca (BrandContext llama setCurrencyFormat).
// Default = Quies (EUR, es-ES): sin settings, formato identico a siempre.
let eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
let eur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
let num = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })

export function setCurrencyFormat(locale = 'es-ES', currency = 'EUR') {
  try {
    eur = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 })
    eur2 = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
    num = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  } catch { /* locale/divisa invalidos: mantener formato anterior */ }
}

export const fmtEur = (v) => eur.format(v || 0)
export const fmtEur2 = (v) => eur2.format(v || 0)
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
