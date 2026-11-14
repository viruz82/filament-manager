// Tile view (A) and list view (B) of the spool page. Both only show the key figures;
// everything else (all fields, all actions) lives in the detail column / sheet.
import { useTranslation } from 'react-i18next'
import { ChevronUp, ChevronDown, Scale, Droplet, QrCode } from 'lucide-react'
import Ring from '../ui/Ring'
import Menu from '../ui/Menu'
import { fmtNum } from '../../utils/number'
import type { Spool } from '../../types'
import type { Pill, SortKey, SortState } from './spoolFilters'
import { spoolPills, spoolTitle } from './spoolFilters'

const PILL_CLASS: Record<Pill['kind'], string> = {
  crit: 'pill-crit', warn: 'pill-warn', ok: 'pill-ok', info: 'pill-info', plain: '',
}

export function PillList({ spool, lowPct, max = 3 }: { spool: Spool; lowPct: number; max?: number }) {
  const { t } = useTranslation()
  const pills = spoolPills(spool, lowPct, t as never).slice(0, max)
  return <>{pills.map((p, i) => <span key={i} className={`pill ${PILL_CLASS[p.kind]}`}>{p.text}</span>)}</>
}

const numberLabel = (s: Spool) => (s.custom_id != null ? `#${s.custom_id} ` : '')
const kgLabel = (g: number) => fmtNum(g / 1000, 2)

export interface ViewActions {
  select: (s: Spool) => void
  weigh: (s: Spool) => void
  moisture: (s: Spool) => void
  label: (s: Spool) => void
}

// ── Tiles ─────────────────────────────────────────────────────────────────────

function SpoolTile({ spool, selected, lowPct, actions }: {
  spool: Spool; selected: boolean; lowPct: number; actions: ViewActions
}) {
  const { t } = useTranslation()
  const pct = spool.remaining_pct
  const low = !spool.archived && pct < lowPct
  const sub = [spool.color_name, spool.storage_location].filter(Boolean).join(' · ')
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => actions.select(spool)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.select(spool) } }}
      className={`bg-surface-2 rounded-2xl p-3 flex flex-col gap-2 cursor-pointer text-left transition-shadow
        hover:bg-surface-3/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent
        ${selected ? 'ring-2 ring-accent' : ''} ${spool.archived ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Ring spool={spool} pct={pct} size={44} />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white leading-tight break-words">{numberLabel(spool)}{spool.brand} {spool.material}{spool.subtype ? ` ${spool.subtype}` : ''}</p>
          {sub && <p className="text-[11px] text-gray-400 truncate">{sub}</p>}
        </div>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className={`text-xl font-bold leading-none tabular-nums ${low ? 'text-crit' : 'text-white'}`}>{fmtNum(spool.current_weight_g, 0)} g</span>
        <span className="text-[11px] text-gray-400 whitespace-nowrap">{t('spools.of')} {kgLabel(spool.initial_weight_g)} kg · {fmtNum(pct, Number.isInteger(pct) ? 0 : 1)} %</span>
      </p>
      <div className="flex items-center justify-between gap-1 mt-auto min-h-[28px]">
        <div className="flex flex-wrap items-center gap-1 min-w-0"><PillList spool={spool} lowPct={lowPct} /></div>
        {!spool.archived && (
          <Menu
            label={t('nav.more')}
            up
            triggerClassName="px-2 py-1 text-gray-400"
            trigger={<span className="tracking-widest font-bold leading-none">⋯</span>}
            items={[
              { key: 'w', label: t('spools.actions.weigh'), icon: <Scale size={15} />, onClick: () => actions.weigh(spool) },
              { key: 'm', label: t('spools.actions.dry'), icon: <Droplet size={15} />, onClick: () => actions.moisture(spool) },
              { key: 'l', label: t('labels.action'), icon: <QrCode size={15} />, onClick: () => actions.label(spool) },
            ]}
          />
        )}
      </div>
    </div>
  )
}

export function SpoolTiles({ spools, selectedId, lowPct, actions }: {
  spools: Spool[]; selectedId: number | null; lowPct: number; actions: ViewActions
}) {
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 175px), 1fr))' }}>
      {spools.map(s => <SpoolTile key={s.id} spool={s} selected={s.id === selectedId} lowPct={lowPct} actions={actions} />)}
    </div>
  )
}

// ── List ──────────────────────────────────────────────────────────────────────

// ring | name | material | rest bar | g | status   (phone: ring | name + pills | g)
const ROW_GRID = 'grid items-center gap-x-3 grid-cols-[28px_minmax(0,1fr)_auto] lg:grid-cols-[28px_minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(70px,1fr)_64px_minmax(0,1.1fr)]'

function HeaderCell({ label, k, sort, onSort, className = '' }: {
  label: string; k: SortKey; sort: SortState; onSort: (k: SortKey) => void; className?: string
}) {
  const active = sort.key === k
  return (
    <button
      className={`flex items-center gap-1 uppercase tracking-wider text-[10.5px] hover:text-white ${active ? 'text-accent' : 'text-gray-400'} ${className}`}
      onClick={() => onSort(k)}
    >
      {label}
      {active && (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
    </button>
  )
}

function SpoolRow({ spool, selected, lowPct }: { spool: Spool; selected: boolean; lowPct: number }) {
  const pct = spool.remaining_pct
  const low = !spool.archived && pct < lowPct
  const barColor = low ? 'rgb(var(--fm-crit))' : 'rgb(var(--fm-accent))'
  const sub = [spool.color_name, spool.storage_location].filter(Boolean).join(' · ')
  return (
    <>
      <Ring spool={spool} pct={pct} size={28} />
      <div className="min-w-0">
        <p className={`text-[13px] font-medium truncate ${selected ? 'text-white' : 'text-gray-100'}`}>{numberLabel(spool)}{spool.brand} {spool.material}{spool.subtype ? ` ${spool.subtype}` : ''}</p>
        {sub && <p className="text-[11px] text-gray-400 truncate">{sub}</p>}
        <div className="lg:hidden flex flex-wrap items-center gap-1 mt-0.5">
          <PillList spool={spool} lowPct={lowPct} max={3} />
        </div>
      </div>
      <span className="hidden lg:block text-xs text-gray-300 truncate">{spool.material}{spool.subtype ? ` ${spool.subtype}` : ''}</span>
      <span className="hidden lg:block h-1.5 rounded-full bg-surface-3 overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: barColor }} />
      </span>
      <span className={`text-right text-[13px] tabular-nums font-mono ${low ? 'text-crit' : 'text-gray-200'}`}>
        {fmtNum(spool.current_weight_g, 0)}<span className="lg:hidden"> g</span>
      </span>
      <span className="hidden lg:flex flex-wrap items-center gap-1 min-w-0"><PillList spool={spool} lowPct={lowPct} max={2} /></span>
    </>
  )
}

export function SpoolList({ spools, selectedId, lowPct, sort, onSortKey, actions }: {
  spools: Spool[]; selectedId: number | null; lowPct: number
  sort: SortState; onSortKey: (k: SortKey) => void; actions: ViewActions
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col">
      {/* header only on the laptop; phone sorts through the sort menu in the bar */}
      <div className={`${ROW_GRID} hidden lg:grid px-3 py-2 sticky top-0 z-10 bg-surface border-b border-surface-3`}>
        <span />
        <HeaderCell label={t('spools.list.spool')} k="number" sort={sort} onSort={onSortKey} />
        <HeaderCell label={t('spools.table.material')} k="material" sort={sort} onSort={onSortKey} />
        <HeaderCell label={t('spools.list.rest')} k="rest" sort={sort} onSort={onSortKey} />
        <HeaderCell label="g" k="weight" sort={sort} onSort={onSortKey} className="justify-end" />
        <span className="uppercase tracking-wider text-[10.5px] text-gray-400">{t('spools.list.status')}</span>
      </div>
      {spools.map(s => (
        <div
          key={s.id}
          role="button"
          tabIndex={0}
          aria-pressed={s.id === selectedId}
          aria-label={spoolTitle(s)}
          onClick={() => actions.select(s)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.select(s) } }}
          className={`${ROW_GRID} px-3 py-2 cursor-pointer border-b border-surface-2 transition-colors hover:bg-surface-2
            focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent
            ${s.id === selectedId ? 'bg-surface-2 shadow-[inset_3px_0_0_rgb(var(--fm-accent))]' : ''} ${s.archived ? 'opacity-60' : ''}`}
        >
          <SpoolRow spool={s} selected={s.id === selectedId} lowPct={lowPct} />
        </div>
      ))}
    </div>
  )
}
