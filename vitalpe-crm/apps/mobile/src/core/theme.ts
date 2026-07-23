/**
 * Design tokens, transcribed from `apps/web/src/app/globals.css`.
 *
 * Same numbers, same names, so the phone and the browser are recognisably one
 * product: warm paper, dark burgundy, charcoal text, no gradients. Status is
 * never carried by colour alone — every chip has a label as well, exactly as
 * the web `.estat-*` classes do.
 *
 * Touch targets follow the web's mobile media query: 44 pt minimum, and 16 px
 * text in inputs.
 *
 * Pure module: plain objects, no React Native imports, so it can be asserted in
 * a test alongside the rest of `src/core`.
 */

export const colors = {
  paper: '#faf7f2',
  paperRaised: '#ffffff',
  paperSunken: '#f3eee6',

  ink: '#1c1a19',
  inkSoft: '#4a4644',
  inkFaint: '#7c7773',

  line: '#e2dbd0',
  lineStrong: '#cdc3b4',

  burgundy: '#6b1230',
  burgundySoft: '#8d2a48',
  burgundyWash: '#f5e9ed',

  ok: '#2f6b43',
  okWash: '#e8f1ea',
  warn: '#9a6212',
  warnWash: '#fbf1de',
  danger: '#a02020',
  dangerWash: '#fbe9e9',

  onBurgundy: '#ffffff',
} as const;

export const radius = { sm: 3, md: 5, lg: 8, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const typography = {
  /** `.etiqueta` — uppercase field labels. */
  label: { fontSize: 11, letterSpacing: 0.7, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 21 },
  bodySmall: { fontSize: 13, lineHeight: 19 },
  title: { fontSize: 19, fontWeight: '600', letterSpacing: -0.2 },
  sectionTitle: { fontSize: 15, fontWeight: '600' },
  /** Inputs stay at 16 so iOS does not zoom on focus. */
  input: { fontSize: 16 },
  button: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
} as const;

/** Web parity: `.boto`/`.camp` are 44 pt tall below 768 px. */
export const MIN_TOUCH_TARGET = 44;

export type Tone = 'ok' | 'avis' | 'perill' | 'neutre' | 'marca';

/** The `.estat-*` chips. `mark` is the shape cue, so colour is never alone. */
export const tones: Readonly<Record<Tone, { fg: string; bg: string; border: string; mark: string }>> =
  Object.freeze({
    ok: { fg: colors.ok, bg: colors.okWash, border: colors.ok, mark: '●' },
    avis: { fg: colors.warn, bg: colors.warnWash, border: colors.warn, mark: '▲' },
    perill: { fg: colors.danger, bg: colors.dangerWash, border: colors.danger, mark: '■' },
    neutre: { fg: colors.inkSoft, bg: colors.paperSunken, border: colors.lineStrong, mark: '◆' },
    marca: { fg: colors.burgundy, bg: colors.burgundyWash, border: colors.burgundy, mark: '●' },
  });

/** Mirrors `CLASSIFICATION_TONE` in apps/web/src/lib/format.ts. */
export const CLASSIFICATION_TONE: Readonly<Record<string, Tone>> = Object.freeze({
  'ACTIU SEGUR': 'ok',
  'POTENCIAL INTERESSAT': 'marca',
  'POTENCIAL AMB UN ALTRE PROVEIDOR': 'neutre',
  'NO POTENCIAL': 'perill',
});

/** Mirrors `TASK_TONE`. */
export const TASK_TONE: Readonly<Record<string, Tone>> = Object.freeze({
  PENDENT: 'neutre',
  FET: 'ok',
  AJORNAT: 'avis',
  'CANCEL·LAT': 'perill',
});

/** Mirrors `VERIFICATION_TONE`. */
export const VERIFICATION_TONE: Readonly<Record<string, Tone>> = Object.freeze({
  ACTIVA: 'ok',
  INACTIVA: 'perill',
  'PENDENT DE VERIFICAR': 'neutre',
  DUBTOSA: 'avis',
});

export const VISIT_TONE: Readonly<Record<string, Tone>> = Object.freeze({
  PLANIFICADA: 'neutre',
  CONFIRMADA: 'marca',
  FETA: 'ok',
  'CANCEL·LADA': 'perill',
});

export function toneFor(map: Readonly<Record<string, Tone>>, value: string | null | undefined): Tone {
  if (value === null || value === undefined) return 'neutre';
  return map[value] ?? 'neutre';
}
