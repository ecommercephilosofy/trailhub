// Performance aggregation engine — Breakdown-Effect safe:
// ratios are ALWAYS derived from summed numerators/denominators, never averaged averages.

export const DEFAULT_THRESHOLDS = {
  roas_winner: 2.5,
  roas_regular: 1.5,
  min_spend: 50,
  hook_rate_good: 25,
  hold_rate_good: 12,
  cpa_max: 15,
}

// Unit economics (modelo CashPilot): GM% = 1 − COGS% − fees%; breakeven ROAS = 1/GM%.
// SCALE exige breakeven × scale_mult; por debajo de breakeven el ad pierde dinero → KILL.
export const DEFAULT_MARGINS = { cogs_pct: 16, fees_pct: 6, scale_mult: 1.4 }

export function breakEvenRoas(margins = DEFAULT_MARGINS) {
  const m = { ...DEFAULT_MARGINS, ...(margins || {}) }
  const gm = 1 - (Number(m.cogs_pct || 0) + Number(m.fees_pct || 0)) / 100
  return gm > 0 ? 1 / gm : null
}

export function marginThresholds(margins, base = DEFAULT_THRESHOLDS) {
  const be = breakEvenRoas(margins)
  if (!be) return { ...base, breakeven_roas: null }
  const mult = Number(margins?.scale_mult ?? DEFAULT_MARGINS.scale_mult) || 1.4
  return {
    ...base,
    roas_regular: +be.toFixed(2),
    roas_winner: +(be * mult).toFixed(2),
    breakeven_roas: +be.toFixed(2),
  }
}

export function aggregateDaily(rows) {
  const byAd = new Map()
  for (const r of rows) {
    let a = byAd.get(r.ad_id)
    if (!a) {
      a = {
        ad_id: r.ad_id, ad_name: r.ad_name, campaign_name: r.campaign_name,
        country: r.country || null,
        creative_type: r.creative_type, spend: 0, impressions: 0, reach: 0, clicks: 0,
        link_clicks: 0, conversions: 0, conversion_value: 0, video_plays: 0,
        video_3s: 0, thruplay: 0, video_p25: 0, video_p50: 0, video_p75: 0,
        watch_time_total: 0, freq_weighted: 0, days: 0, daily: [],
      }
      byAd.set(r.ad_id, a)
    }
    a.spend += r.spend || 0
    a.impressions += r.impressions || 0
    a.reach += r.reach || 0
    a.clicks += r.clicks || 0
    a.link_clicks += r.link_clicks || 0
    a.conversions += r.conversions || 0
    a.conversion_value += r.conversion_value || 0
    a.video_plays += r.video_plays || 0
    a.video_3s += r.video_3s || 0
    a.thruplay += r.thruplay || 0
    a.video_p25 += r.video_p25 || 0
    a.video_p50 += r.video_p50 || 0
    a.video_p75 += r.video_p75 || 0
    a.watch_time_total += (r.avg_watch_time || 0) * (r.video_plays || 0)
    a.freq_weighted += (r.frequency || 0) * (r.impressions || 0)
    a.days += 1
    a.daily.push(r)
  }
  const out = []
  for (const a of byAd.values()) {
    a.roas = a.spend > 0 ? a.conversion_value / a.spend : 0
    a.ctr = a.impressions > 0 ? (a.link_clicks / a.impressions) * 100 : 0
    a.cpc = a.link_clicks > 0 ? a.spend / a.link_clicks : 0
    a.cpa = a.conversions > 0 ? a.spend / a.conversions : 0
    a.cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0
    a.frequency = a.impressions > 0 ? a.freq_weighted / a.impressions : 0
    a.hook_rate = a.video_plays > 0 ? (a.video_3s / a.video_plays) * 100 : 0
    a.hold_rate = a.video_3s > 0 ? (a.thruplay / a.video_3s) * 100 : 0
    a.ret_25 = a.video_plays > 0 ? (a.video_p25 / a.video_plays) * 100 : 0
    a.ret_50 = a.video_plays > 0 ? (a.video_p50 / a.video_plays) * 100 : 0
    a.ret_75 = a.video_plays > 0 ? (a.video_p75 / a.video_plays) * 100 : 0
    a.avg_watch_time = a.video_plays > 0 ? a.watch_time_total / a.video_plays : 0
    a.daily.sort((x, y) => (x.date < y.date ? -1 : 1))
    out.push(a)
  }
  return out
}

export function labelFor(agg, t = DEFAULT_THRESHOLDS) {
  if ((agg.spend || 0) < (t.min_spend ?? 50)) return { label: 'UNSCORED', action: null }
  if (agg.roas >= (t.roas_winner ?? 2.5)) return { label: 'WINNER', action: 'SCALE' }
  if (agg.roas >= (t.roas_regular ?? 1.5)) return { label: 'REGULAR', action: 'ITERATE' }
  return { label: 'LOSER', action: 'KILL' }
}

// Fatigue engine: CTR decay (1st half vs 2nd half) + frequency ramp + ROAS slide.
export function computeFatigue(agg) {
  const d = agg.daily || []
  if (d.length < 6 || agg.spend < 30) return { flag: false }
  const half = Math.floor(d.length / 2)
  const sum = (arr, f) => arr.reduce((s, r) => s + (f(r) || 0), 0)
  const ctrOf = (arr) => {
    const imp = sum(arr, (r) => r.impressions)
    return imp > 0 ? (sum(arr, (r) => r.link_clicks) / imp) * 100 : 0
  }
  const roasOf = (arr) => {
    const sp = sum(arr, (r) => r.spend)
    return sp > 0 ? sum(arr, (r) => r.conversion_value) / sp : 0
  }
  const a = d.slice(0, half), b = d.slice(half)
  const ctrDecay = ctrOf(a) > 0 ? 1 - ctrOf(b) / ctrOf(a) : 0
  const roasDecay = roasOf(a) > 0 ? 1 - roasOf(b) / roasOf(a) : 0
  const lastFreq = d[d.length - 1]?.frequency || 0
  const reasons = []
  if (ctrDecay > 0.25) reasons.push(`CTR -${Math.round(ctrDecay * 100)}% vs primera mitad`)
  if (lastFreq > 3.2) reasons.push(`Frecuencia ${lastFreq.toFixed(1)} (>3.2)`)
  if (roasDecay > 0.3) reasons.push(`ROAS -${Math.round(roasDecay * 100)}% en tendencia`)
  const score = (ctrDecay > 0.25 ? 1 : 0) + (lastFreq > 3.2 ? 1 : 0) + (roasDecay > 0.3 ? 1 : 0)
  return { flag: score >= 2 || (score === 1 && ctrDecay > 0.4), reasons, severity: score >= 2 ? 'HIGH' : 'MEDIUM' }
}

export function metricGrade(value, good, ok, invert = false) {
  if (value == null) return null
  if (!invert) {
    if (value >= good) return 'A'
    if (value >= ok) return 'B'
    return 'C'
  }
  if (value <= good) return 'A'
  if (value <= ok) return 'B'
  return 'C'
}
