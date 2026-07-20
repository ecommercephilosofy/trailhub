// Defaults de marca = valores Quies actuales. La tabla `settings` (Ajustes)
// los sobreescribe por deep-merge: settings vacía → la app se ve EXACTAMENTE
// como hoy (cero regresión en la instancia viva).
export const brandDefaults = {
  name: 'Quies',
  appName: 'Creative OS',
  tagline: 'QUIES · SISTEMA SEMANAL',
  loginSubtitle: 'Quies — sistema creativo semanal',
  productName: 'Quies',
  currency: 'EUR',
  currencyLocale: 'es-ES',
  adCodeExample: 'FER0099',
  competitorPlaceholder: 'zquiet.com',
  imageTool: 'Nano Banana Pro',
  bonus: { minLifetimeSpend: 1500, minRoas: 2.0, amount: 20 },
  accounts: [
    { id: 'act_920220397257603', name: 'Nivio 3', color: 'indigo' },
    { id: 'act_2238085909730254', name: 'IF', color: 'teal' },
    { id: 'act_547347304343706', name: 'IF MX', color: 'cyan' },
  ],
}

export function deepMerge(base, override) {
  if (Array.isArray(override)) return override
  if (typeof override !== 'object' || override === null) return override ?? base
  const out = { ...base }
  for (const [k, v] of Object.entries(override)) {
    out[k] = typeof v === 'object' && v !== null && !Array.isArray(v) && typeof base?.[k] === 'object'
      ? deepMerge(base[k], v) : (Array.isArray(v) && v.length === 0 ? base?.[k] : v)
  }
  return out
}

export const BADGE_PALETTE = {
  indigo: 'bg-indigo-100 text-indigo-700',
  teal: 'bg-teal-100 text-teal-700',
  cyan: 'bg-cyan-100 text-cyan-700',
  purple: 'bg-purple-100 text-purple-700',
  amber: 'bg-amber-100 text-amber-700',
  emerald: 'bg-emerald-100 text-emerald-700',
}
