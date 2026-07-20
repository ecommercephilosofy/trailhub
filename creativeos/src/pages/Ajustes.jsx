// Ajustes de marca (solo ADMIN) — white-label: lo que aquí se guarda
// (settings.data.brand) sobreescribe los defaults Quies en toda la app.
// Vacío = la app se comporta como siempre.
import { useEffect, useState } from 'react'
import { getSettings, saveSettings } from '@/api/entities'
import { useBrand } from '@/context/BrandContext'
import { brandDefaults, BADGE_PALETTE } from '@/lib/brandDefaults'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Settings2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

const FIELDS = [
  ['name', 'Nombre de la marca'],
  ['appName', 'Nombre de la app'],
  ['tagline', 'Subtítulo del sidebar'],
  ['loginSubtitle', 'Subtítulo del login'],
  ['productName', 'Nombre del producto'],
  ['adCodeExample', 'Ejemplo de código de ad'],
]

export default function Ajustes() {
  const { refreshBrand } = useBrand()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSettings().then((data) => {
      const b = data?.brand || {}
      setForm({
        ...brandDefaults, ...b,
        bonus: { ...brandDefaults.bonus, ...(b.bonus || {}) },
        accounts: b.accounts?.length ? b.accounts : brandDefaults.accounts,
      })
    })
  }, [])

  if (!form) return null
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setAcc = (i, k, v) => setForm((f) => {
    const accounts = f.accounts.map((a, j) => (j === i ? { ...a, [k]: v } : a))
    return { ...f, accounts }
  })

  const save = async () => {
    // Valida locale/divisa antes de persistir: un locale inválido reventaría el
    // formateo de moneda en toda la app (RangeError en Intl.NumberFormat).
    try {
      new Intl.NumberFormat(form.currencyLocale || 'es-ES', { style: 'currency', currency: form.currency })
    } catch {
      return toast.error('Locale o divisa inválidos (ej. locale "es-ES", divisa "EUR")')
    }
    setSaving(true)
    try {
      const data = await getSettings()
      await saveSettings({ ...data, brand: form })
      refreshBrand()
      toast.success('Marca guardada — la app usa la nueva configuración')
    } catch (e) {
      toast.error(`No se pudo guardar: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-indigo-500" /> Marca
        </CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map(([k, label]) => (
            <label key={k} className="text-xs text-slate-500">
              {label}
              <Input className="mt-1" value={form[k] || ''} onChange={(e) => set(k, e.target.value)} />
            </label>
          ))}
          <label className="text-xs text-slate-500">
            Divisa
            <Select value={form.currency} onValueChange={(v) => set('currency', v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{['EUR', 'USD', 'MXN', 'GBP'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            <span className="mt-1 block text-[10px] text-slate-400">
              Los importes de cuentas que operan en OTRA divisa se muestran convertidos
              (≈) con el cambio BCE del día. Las cuentas que ya operan en esta divisa no se tocan.
            </span>
          </label>
          <label className="text-xs text-slate-500">
            Locale (formato números)
            <Input className="mt-1" value={form.currencyLocale || ''} placeholder="es-ES, en-US…"
                   onChange={(e) => set('currencyLocale', e.target.value)} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Cuentas publicitarias (nombre corto en Performance)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {form.accounts.map((a, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input className="flex-1 font-mono text-xs" value={a.id} placeholder="act_…"
                     onChange={(e) => setAcc(i, 'id', e.target.value)} />
              <Input className="w-40" value={a.name} placeholder="Nombre corto"
                     onChange={(e) => setAcc(i, 'name', e.target.value)} />
              <Select value={a.color || 'indigo'} onValueChange={(v) => setAcc(i, 'color', v)}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.keys(BADGE_PALETTE).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="ghost" size="icon" onClick={() => set('accounts', form.accounts.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4 text-red-400" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm"
                  onClick={() => set('accounts', [...form.accounts, { id: '', name: '', color: 'indigo' }])}>
            <Plus className="h-4 w-4" /> Añadir cuenta
          </Button>
          <p className="text-[11px] text-slate-400">
            El pipeline usa brand/brand.json en la máquina que lo ejecuta — esto solo controla cómo se MUESTRAN las cuentas en la app.
          </p>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar marca'}</Button>
    </div>
  )
}
