/**
 * Display formatting. Everything the user sees is Europe/Madrid,
 * DD/MM/YYYY, 24-hour, litres with a thousands separator.
 */
export const TZ = 'Europe/Madrid';

const dateFmt = new Intl.DateTimeFormat('ca-ES', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat('ca-ES', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
});
const weekdayFmt = new Intl.DateTimeFormat('ca-ES', { timeZone: TZ, weekday: 'long' });
const monthFmt = new Intl.DateTimeFormat('ca-ES', { timeZone: TZ, month: 'long', year: 'numeric' });

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? dateFmt.format(d) : '—';
}

export function formatTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? timeFmt.format(d) : '—';
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? `${dateFmt.format(d)} ${timeFmt.format(d)}` : '—';
}

export function formatWeekday(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  const w = weekdayFmt.format(d);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function formatMonth(value: string | Date): string {
  const d = toDate(value);
  if (!d) return '';
  const m = monthFmt.format(d);
  return m.charAt(0).toUpperCase() + m.slice(1);
}

export function formatLiters(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${new Intl.NumberFormat('ca-ES', { maximumFractionDigits: 0 }).format(n)} L`;
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat('ca-ES').format(n) : '0';
}

/** "fa 3 dies" / "d'aquí a 2 hores" — used for last-contact columns. */
export function relativeDays(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days === 0) return 'avui';
  if (days === 1) return 'demà';
  if (days === -1) return 'ahir';
  return days < 0 ? `fa ${Math.abs(days)} dies` : `d'aquí a ${days} dies`;
}

/** Local datetime string for <input type="datetime-local"> in Europe/Madrid. */
export function toLocalInputValue(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  return parts.replace(' ', 'T');
}

export const CLASSIFICATION_TONE: Record<string, string> = {
  'ACTIU SEGUR': 'estat estat-ok',
  'POTENCIAL INTERESSAT': 'estat estat-marca',
  'POTENCIAL AMB UN ALTRE PROVEIDOR': 'estat estat-neutre',
  'NO POTENCIAL': 'estat estat-perill',
};

export const TASK_TONE: Record<string, string> = {
  PENDENT: 'estat estat-neutre',
  FET: 'estat estat-ok',
  AJORNAT: 'estat estat-avis',
  'CANCEL·LAT': 'estat estat-perill',
};

export const VERIFICATION_TONE: Record<string, string> = {
  ACTIVA: 'estat estat-ok',
  INACTIVA: 'estat estat-perill',
  'PENDENT DE VERIFICAR': 'estat estat-neutre',
  DUBTOSA: 'estat estat-avis',
};
