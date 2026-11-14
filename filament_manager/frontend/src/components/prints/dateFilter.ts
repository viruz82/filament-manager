
// ── Date filter helpers ───────────────────────────────────────────────────────

export type FilterMode = 'month' | 'week' | 'day'

export interface DateFilter {
  mode: FilterMode
  preset: 'this' | 'last' | 'custom'
  custom: string  // YYYY-MM for month; YYYY-MM-DD for week/day
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const delta = (d.getUTCDay() + 6) % 7   // Mon=0 … Sun=6
  return addDays(dateStr, -delta)
}

/** Return the default date/month string for a mode+preset combination. */
export function presetToCustom(mode: FilterMode, preset: 'this' | 'last', today: string): string {
  if (mode === 'month') {
    if (preset === 'this') return today.slice(0, 7)
    const d = new Date(today + 'T12:00:00Z')
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() - 1)
    return d.toISOString().slice(0, 7)
  }
  if (mode === 'week') {
    const ref = preset === 'this' ? today : addDays(today, -7)
    return getMondayOf(ref)
  }
  return preset === 'this' ? today : addDays(today, -1)
}

/** Format "YYYY-MM-DD" as "DD.MM." for compact range labels. */
export function fmtShort(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return `${d}.${m}.`
}

export function resolveDateRange(f: DateFilter, today: string): { start: string; end: string } | null {
  const { mode, preset, custom } = f
  if (mode === 'month') {
    let ym: string
    if (preset === 'this') {
      ym = today.slice(0, 7)
    } else if (preset === 'last') {
      const d = new Date(today + 'T12:00:00Z')
      d.setUTCDate(1)
      d.setUTCMonth(d.getUTCMonth() - 1)
      ym = d.toISOString().slice(0, 7)
    } else {
      if (!custom) return null
      ym = custom
    }
    const [y, m] = ym.split('-').map(Number)
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return { start: `${ym}-01`, end: `${ym}-${String(lastDay).padStart(2, '0')}` }
  }
  if (mode === 'week') {
    const ref = preset === 'this' ? today : preset === 'last' ? addDays(today, -7) : custom
    if (!ref) return null
    const mon = getMondayOf(ref)
    return { start: mon, end: addDays(mon, 6) }
  }
  if (mode === 'day') {
    const day = preset === 'this' ? today : preset === 'last' ? addDays(today, -1) : custom
    if (!day) return null
    return { start: day, end: day }
  }
  return null
}
