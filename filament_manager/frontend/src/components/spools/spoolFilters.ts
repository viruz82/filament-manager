// Filter, sort and status helpers shared by the tile view, the list view and the
// detail column of the spool page.
import type { Spool } from '../../types'

export type QuickFilter = 'all' | 'moist' | 'low' | 'ams' | 'archived'
export const QUICK_FILTERS: QuickFilter[] = ['all', 'moist', 'low', 'ams', 'archived']

/** Values of the deep link `#/spools?filter=…` (used by the Home Assistant buttons). */
export const FILTER_PARAM: Record<string, QuickFilter> = {
  wenig: 'low', low: 'low',
  feucht: 'moist', moist: 'moist',
  ams: 'ams',
  archiv: 'archived', archived: 'archived',
}

export interface SpoolFilter {
  q: string
  quick: QuickFilter
  material: string
  location: string
}
export const EMPTY_FILTER: SpoolFilter = { q: '', quick: 'all', material: '', location: '' }

export type SortKey = 'ams' | 'number' | 'name' | 'material' | 'rest' | 'weight'
export type SortDir = 'asc' | 'desc'
export interface SortState { key: SortKey; dir: SortDir }
export const SORT_KEYS: SortKey[] = ['ams', 'number', 'name', 'material', 'rest', 'weight']
export const DEFAULT_SORT: SortState = { key: 'ams', dir: 'asc' }

export function isMoist(s: Spool): boolean {
  const l = s.moisture.level
  return !s.archived && (l === 'warning' || l === 'critical' || l === 'drying')
}
export function isLow(s: Spool, lowPct: number): boolean {
  return !s.archived && s.remaining_pct < lowPct
}

export function spoolTitle(s: Spool): string {
  return `${s.custom_id != null ? `#${s.custom_id} ` : ''}${s.brand} ${s.material}${s.subtype ? ` ${s.subtype}` : ''}${s.subtype2 ? ` · ${s.subtype2}` : ''}`
}

/** Tray number of an AMS slot key ("Bambu Lab A1:ams1_tray3" → "3"), null without a slot. */
export function trayNumber(slot: string | null): string | null {
  if (!slot) return null
  const m = /tray(\d+)$/.exec(slot)
  return m ? m[1] : null
}

const norm = (v: string) => v.toLocaleLowerCase()

function haystack(s: Spool): string {
  return norm([
    s.custom_id != null ? `#${s.custom_id} ${s.custom_id}` : '',
    s.brand, s.material, s.subtype, s.subtype2, s.color_name, s.storage_location,
    s.purchase_location, s.article_number, s.notes,
  ].filter(Boolean).join(' '))
}

export function filterSpools(spools: Spool[], f: SpoolFilter, lowPct: number): Spool[] {
  const words = norm(f.q.trim()).split(/\s+/).filter(Boolean)
  return spools.filter(s => {
    if (f.quick === 'archived' ? !s.archived : s.archived) return false
    if (f.quick === 'moist' && !isMoist(s)) return false
    if (f.quick === 'low' && !isLow(s, lowPct)) return false
    if (f.quick === 'ams' && !s.ams_slot) return false
    if (f.material && s.material !== f.material) return false
    if (f.location && (s.storage_location ?? '') !== f.location) return false
    if (words.length) {
      const h = haystack(s)
      if (!words.every(w => h.includes(w))) return false
    }
    return true
  })
}

const cmpText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

export function sortSpools(spools: Spool[], sort: SortState): Spool[] {
  const dir = sort.dir === 'asc' ? 1 : -1
  const byNumber = (a: Spool, b: Spool) => (a.custom_id ?? 1e9) - (b.custom_id ?? 1e9) || a.id - b.id
  const rows = [...spools]
  rows.sort((a, b) => {
    switch (sort.key) {
      case 'ams': {
        // spools in the AMS first (by slot), then by number
        const ha = a.ams_slot ? 0 : 1
        const hb = b.ams_slot ? 0 : 1
        if (ha !== hb) return dir * (ha - hb)
        if (a.ams_slot && b.ams_slot) {
          const c = cmpText(a.ams_slot, b.ams_slot)
          if (c) return dir * c
        }
        return byNumber(a, b)
      }
      case 'number': return dir * byNumber(a, b)
      case 'name': return dir * (cmpText(`${a.brand} ${a.material} ${a.color_name}`, `${b.brand} ${b.material} ${b.color_name}`) || byNumber(a, b))
      case 'material': return dir * (cmpText(`${a.material} ${a.subtype ?? ''}`, `${b.material} ${b.subtype ?? ''}`) || byNumber(a, b))
      case 'rest': return dir * (a.remaining_pct - b.remaining_pct || byNumber(a, b))
      case 'weight': return dir * (a.current_weight_g - b.current_weight_g || byNumber(a, b))
    }
  })
  return rows
}

/** Direction a sort key starts with when chosen from the sort menu. */
export function defaultDir(key: SortKey): SortDir {
  return key === 'weight' ? 'desc' : 'asc'
}

export function loadSort(): SortState {
  try {
    const raw = JSON.parse(localStorage.getItem('fm_spool_sort') ?? 'null')
    if (raw && SORT_KEYS.includes(raw.key) && (raw.dir === 'asc' || raw.dir === 'desc')) return raw
  } catch { /* ignore */ }
  return DEFAULT_SORT
}
export function saveSort(s: SortState) {
  try { localStorage.setItem('fm_spool_sort', JSON.stringify(s)) } catch { /* private mode etc. */ }
}

export interface Pill { kind: 'crit' | 'warn' | 'ok' | 'info' | 'plain'; text: string }

type T = (key: string, opts?: Record<string, unknown>) => string

/** Status pills of a spool, most important first. */
export function spoolPills(s: Spool, lowPct: number, t: T): Pill[] {
  const pills: Pill[] = []
  if (s.archived) return [{ kind: 'plain', text: t('spools.archived') }]
  if (isLow(s, lowPct)) pills.push({ kind: 'crit', text: t('spools.pillLow') })
  const m = s.moisture
  if (m.level === 'critical') pills.push({ kind: 'crit', text: t('spools.pillDryNow') })
  else if (m.level === 'warning') pills.push({ kind: 'warn', text: m.pct != null ? t('spools.pillMoistPct', { pct: Math.round(m.pct) }) : t('moisture.level.warning') })
  else if (m.level === 'drying') pills.push({ kind: 'warn', text: t('moisture.level.drying') })
  const tray = trayNumber(s.ams_slot)
  if (s.ams_slot) pills.push({ kind: 'info', text: tray ? t('spools.pillAms', { n: tray }) : 'AMS' })
  if (m.level === 'dry' || m.level === 'good') pills.push({ kind: 'ok', text: t(`moisture.level.${m.level}`) })
  return pills
}
