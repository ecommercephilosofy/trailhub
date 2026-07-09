// Constantes compartidas entre páginas (antes duplicadas en Dashboard/Direccion/Performance).

// Semáforo CMO (verde/amarillo/rojo) — clases del badge y borde de card.
export const CMO_STATUS_STYLE = {
  verde: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  amarillo: 'bg-amber-100 text-amber-800 border-amber-300',
  rojo: 'bg-red-100 text-red-700 border-red-300',
}

// Cuentas publicitarias — el mismo creativo puede correr en varias a la vez.
// Si se añade una cuenta nueva al pipeline, añadir aquí su nombre y color.
export const ACCOUNT_NAMES = {
  act_920220397257603: 'Nivio 3',
  act_2238085909730254: 'IF',
  act_547347304343706: 'IF MX',
}
export const ACCOUNT_BADGE = {
  act_920220397257603: 'bg-indigo-100 text-indigo-700',
  act_2238085909730254: 'bg-teal-100 text-teal-700',
  act_547347304343706: 'bg-cyan-100 text-cyan-700',
}
