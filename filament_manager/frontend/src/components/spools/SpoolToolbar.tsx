// One bar for both spool views: search, filter chips, material / location filters,
// view switch, sort (tiles + phone), add button and the "⋯" menu (inventory, labels).
import { useTranslation } from 'react-i18next'
import { Search, X, LayoutGrid, List, Plus, Ellipsis, FileDown, QrCode, Loader2, ArrowDownUp } from 'lucide-react'
import Menu from '../ui/Menu'
import { fmtNum } from '../../utils/number'
import type { QuickFilter, SortKey, SortState, SpoolFilter } from './spoolFilters'
import { QUICK_FILTERS, SORT_KEYS, defaultDir } from './spoolFilters'

export type SpoolView = 'cards' | 'table'

export interface Counts { all: number; moist: number; low: number; ams: number }

export default function SpoolToolbar({
  filter, onFilter, counts, materials, locations, view, onView, sort, onSort,
  onAdd, onInventory, inventoryBusy, onLabels, total, kg, value, fmtCurrency,
}: {
  filter: SpoolFilter
  onFilter: (f: SpoolFilter) => void
  counts: Counts
  materials: string[]
  locations: string[]
  view: SpoolView
  onView: (v: SpoolView) => void
  sort: SortState
  onSort: (s: SortState) => void
  onAdd: () => void
  onInventory: () => void
  inventoryBusy: boolean
  onLabels: () => void
  total: number
  kg: number
  value: number
  fmtCurrency: (n: number) => string
}) {
  const { t } = useTranslation()
  const set = (patch: Partial<SpoolFilter>) => onFilter({ ...filter, ...patch })

  const chipLabel = (q: QuickFilter) => {
    const base = t(`spools.filter.${q}`)
    const n = q === 'archived' ? null : counts[q]
    return n == null ? base : `${base} ${n}`
  }

  return (
    <div className="flex-none flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold shrink-0">{t('spools.title')}</h2>

        <div className="relative order-last w-full sm:order-none sm:w-auto sm:flex-1 sm:min-w-[200px] sm:max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            type="search"
            className="input !rounded-full !bg-surface-2 pl-9 pr-8 !py-1.5"
            placeholder={t('spools.search')}
            aria-label={t('spools.search')}
            value={filter.q}
            onChange={e => set({ q: e.target.value })}
          />
          {filter.q && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-400 hover:text-white"
              onClick={() => set({ q: '' })}
              aria-label={t('common.close')}
            ><X size={13} /></button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="seg" role="group">
            <button
              className={`seg-item ${view === 'cards' ? 'seg-item-on' : ''}`}
              onClick={() => onView('cards')}
              title={t('spools.viewGrid')} aria-label={t('spools.viewGrid')} aria-pressed={view === 'cards'}
            ><LayoutGrid size={14} /><span className="hidden lg:inline">{t('spools.viewGridShort')}</span></button>
            <button
              className={`seg-item ${view === 'table' ? 'seg-item-on' : ''}`}
              onClick={() => onView('table')}
              title={t('spools.viewList')} aria-label={t('spools.viewList')} aria-pressed={view === 'table'}
            ><List size={14} /><span className="hidden lg:inline">{t('spools.viewListShort')}</span></button>
          </div>
          <Menu
            label={t('nav.more')}
            triggerClassName="p-2 text-gray-300"
            trigger={inventoryBusy ? <Loader2 size={18} className="animate-spin" /> : <Ellipsis size={18} />}
            items={[
              { key: 'inv', label: t('spools.inventoryPdf'), icon: <FileDown size={15} />, onClick: onInventory, disabled: inventoryBusy },
              { key: 'lab', label: t('labels.title'), icon: <QrCode size={15} />, onClick: onLabels },
            ]}
          />
          <button className="btn-primary shrink-0 flex items-center gap-1.5" onClick={onAdd}>
            <Plus size={14} /><span className="hidden sm:inline">{t('spools.addSpool')}</span><span className="sm:hidden">{t('spools.addShort')}</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible" style={{ scrollbarWidth: 'none' }}>
        {QUICK_FILTERS.map(q => (
          <button
            key={q}
            className={`chip shrink-0 ${filter.quick === q ? 'chip-on' : ''}`}
            aria-pressed={filter.quick === q}
            onClick={() => set({ quick: q })}
          >{chipLabel(q)}</button>
        ))}
        <select
          className={`chip shrink-0 cursor-pointer max-w-[10rem] ${filter.material ? 'chip-on' : ''}`}
          value={filter.material}
          onChange={e => set({ material: e.target.value })}
          aria-label={t('spools.table.material')}
        >
          <option value="">{t('spools.filterMaterial')}</option>
          {materials.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {locations.length > 0 && (
          <select
            className={`chip shrink-0 cursor-pointer max-w-[10rem] ${filter.location ? 'chip-on' : ''}`}
            value={filter.location}
            onChange={e => set({ location: e.target.value })}
            aria-label={t('spools.table.storageLocation')}
          >
            <option value="">{t('spools.filterLocation')}</option>
            {locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        {/* Sort menu: the list header sorts on the laptop, so this is for tiles and the phone */}
        <label className={`chip shrink-0 cursor-pointer gap-1 ${view === 'table' ? 'lg:hidden' : ''}`}>
          <ArrowDownUp size={12} />
          <select
            className="bg-transparent cursor-pointer focus:outline-none max-w-[9rem]"
            value={sort.key}
            onChange={e => { const key = e.target.value as SortKey; onSort({ key, dir: defaultDir(key) }) }}
            aria-label={t('spools.sort.label')}
          >
            {SORT_KEYS.map(k => <option key={k} value={k}>{t(`spools.sort.${k}`)}</option>)}
          </select>
        </label>
        {(filter.q || filter.material || filter.location || filter.quick !== 'all') && (
          <button
            className="chip shrink-0 text-accent"
            onClick={() => onFilter({ q: '', quick: 'all', material: '', location: '' })}
          ><X size={12} />{t('spools.table.clearFilters')}</button>
        )}
      </div>

      <p className="text-xs text-gray-500">
        {t('spools.summary', { count: total })} · {fmtNum(kg, 2)} kg · {t('spools.stockValue')} {fmtCurrency(value)}
      </p>
    </div>
  )
}
