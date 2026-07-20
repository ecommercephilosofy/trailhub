// Marca dinámica: settings.data.brand (tabla settings, editable en Ajustes)
// sobre brandDefaults (Quies). Provee useBrand() + reconfigura los formatters
// de moneda al cargar. Settings vacía = app idéntica a hoy.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getSettings } from '@/api/entities'
import { brandDefaults, deepMerge, BADGE_PALETTE } from '@/lib/brandDefaults'
import { setCurrencyFormat } from '@/lib/format'
import { useAuth } from '@/context/AuthContext'

const BrandContext = createContext({ brand: brandDefaults, refreshBrand: () => {} })

// Tipos de cambio BCE del día (frankfurter.dev, sin key) con caché en
// localStorage — 1 fetch por divisa y día. rates = unidades de OTRA divisa
// por 1 unidad de la divisa de la app (base).
async function loadFxRates(base) {
  const today = new Date().toISOString().slice(0, 10)
  const cacheKey = `fx:${base}:${today}`
  try {
    // Poda: borra cachés fx de días anteriores (evita crecimiento sin límite).
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('fx:') && !k.endsWith(today)) localStorage.removeItem(k)
    }
    const cached = localStorage.getItem(cacheKey)
    if (cached) return JSON.parse(cached)
    const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}`)
    if (!r.ok) throw new Error(`fx ${r.status}`)
    const { rates, date } = await r.json()
    const fx = { rates, date }
    localStorage.setItem(cacheKey, JSON.stringify(fx))
    return fx
  } catch {
    return null   // sin tasa → los importes se muestran en su divisa original
  }
}

export function BrandProvider({ children }) {
  const { user } = useAuth()
  const [override, setOverride] = useState(null)
  const [fx, setFx] = useState(null)

  const load = () => {
    getSettings().then((data) => setOverride(data?.brand || {})).catch(() => setOverride({}))
  }
  useEffect(() => { if (user) load() }, [user])

  const brand = useMemo(() => deepMerge(brandDefaults, override || {}), [override])

  useEffect(() => {
    setCurrencyFormat(brand.currencyLocale, brand.currency)
    document.title = `${brand.appName} — ${brand.name}`
  }, [brand])

  useEffect(() => {
    let alive = true
    loadFxRates(brand.currency).then((r) => { if (alive) setFx(r) })
    return () => { alive = false }
  }, [brand.currency])

  const value = useMemo(() => {
    const fmtIn = (amount, currency) => {
      try {
        return new Intl.NumberFormat(brand.currencyLocale, {
          style: 'currency', currency, maximumFractionDigits: 0,
        }).format(amount)
      } catch {
        // locale/divisa inválidos guardados en Ajustes: fallback, no matar la página
        return new Intl.NumberFormat('es-ES', {
          style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
        }).format(amount)
      }
    }
    return {
      brand,
      refreshBrand: load,
      accountName: (id) => brand.accounts.find((a) => a.id === id)?.name || id || '—',
      accountBadge: (id) => BADGE_PALETTE[brand.accounts.find((a) => a.id === id)?.color] || 'bg-slate-100 text-slate-600',
      fxDate: fx?.date || null,
      // Importe en su divisa nativa → divisa de la app al cambio BCE del día.
      // Misma divisa: formato directo. Sin tasa: divisa original (no mentir).
      fmtMoneyFrom: (amount, fromCurrency) => {
        if (amount == null) return '—'
        const from = fromCurrency || brand.currency
        if (from === brand.currency) return fmtIn(amount, brand.currency)
        const rate = fx?.rates?.[from]
        if (!rate) return fmtIn(amount, from)
        return `≈${fmtIn(amount / rate, brand.currency)}`
      },
    }
  }, [brand, fx])

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
}

export const useBrand = () => useContext(BrandContext)
