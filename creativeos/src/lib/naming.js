// Naming-convention parser: extracts structured tags from Meta ad names.
// Supports patterns like "[V12] UGC | HOOK-QUESTION | MAMA_CANSADA | Quies Sleep"

const FORMATS = ['UGC', 'VSL', 'TESTIMONIAL', 'POV', 'AUTHORITY', 'PROBLEM_SOLUTION', 'GREEN_SCREEN', 'COMPARISON', 'BEFORE_AFTER']
const HOOKS = ['CONSPIRACY', 'QUESTION', 'STATISTIC', 'PERSONAL_STORY', 'CONTRADICTION', 'VISUAL_DEMO', 'RESULT_FIRST', 'DOCUMENTARY', 'HUMOR', 'CHALLENGE']

export function parseAdName(name = '') {
  const upper = name.toUpperCase()
  const out = { version: null, format: null, hook_type: null, avatar_tag: null, is_video: null }
  const v = upper.match(/\[?V(\d{1,3})\]?/)
  if (v) out.version = Number(v[1])
  for (const f of FORMATS) {
    if (upper.includes(f.replace('_', ' ')) || upper.includes(f)) { out.format = f; break }
  }
  const hookMatch = upper.match(/HOOK[-_ ]([A-Z_]+)/)
  if (hookMatch && HOOKS.includes(hookMatch[1])) out.hook_type = hookMatch[1]
  else for (const h of HOOKS) { if (upper.includes(h)) { out.hook_type = h; break } }
  const parts = name.split('|').map((p) => p.trim())
  if (parts.length >= 3) {
    const candidate = parts.find((p) => /^[A-ZÁÉÍÓÚÑ_]{4,}$/.test(p.toUpperCase().replace(/\s/g, '_')) && !FORMATS.includes(p.toUpperCase()) && !p.toUpperCase().startsWith('HOOK'))
    if (candidate && !/^\[?V\d+/.test(candidate)) out.avatar_tag = candidate
  }
  // Meta convention seen in spec: I/V marker for image vs video
  if (/(^|[\s|_-])V(\d|[\s|_-])/.test(upper) || upper.includes('VIDEO')) out.is_video = true
  if (/(^|[\s|_-])I([\s|_-]|\d)/.test(upper) || upper.includes('IMG') || upper.includes('IMAGE')) out.is_video = out.is_video ?? false
  return out
}

// País por convención de naming en campaña/ad: "MX" → México;
// "USA", "USAH" o "USA Hispanos" → Estados Unidos; resto → España.
export function parseCountry(...names) {
  const u = names.filter(Boolean).join(' | ').toUpperCase()
  if (/USAH|USA[\s_-]?HISPANOS|(^|[\s|_-])USA([\s|_-]|$)/.test(u)) return 'US'
  if (/(^|[\s|_-])MX([\s|_-]|$)/.test(u)) return 'MX'
  return 'ES'
}

export function isVideoAd(name = '', creativeType) {
  if (creativeType) return creativeType === 'VIDEO'
  const p = parseAdName(name)
  return p.is_video !== false
}
