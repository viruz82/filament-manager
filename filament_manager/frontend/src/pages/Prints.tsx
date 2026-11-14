import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '../components/ui/Feedback'
import { api } from '../api'
import type { PrintJob, Spool, PrinterConfig } from '../types'
import { Plus, X, Search, CalendarDays } from 'lucide-react'
import Modal from '../components/Modal'
import PageHeader from '../components/ui/PageHeader'
import { useHATZ, useCurrencyFormatter } from '../hooks/useHATZ'
import { fmtNum } from '../utils/number'
import { nowInTZ } from '../utils/time'
import { LogUsageModal } from '../components/prints/LogUsageModal'
import { PrintForm } from '../components/prints/PrintForm'
import { PrintRow } from '../components/prints/PrintRow'
import { addDays, getMondayOf, presetToCustom, fmtShort, resolveDateRange } from '../components/prints/dateFilter'
import type { FilterMode, DateFilter } from '../components/prints/dateFilter'

const PAGE_SIZE = 50

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Prints() {
  const { confirm } = useConfirm()
  const { t } = useTranslation()
  const fmtCurrency = useCurrencyFormatter()
  const qc = useQueryClient()
  const tz = useHATZ()
  const today = nowInTZ(tz).slice(0, 10)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<PrintJob | null>(null)
  const [loggingUsage, setLoggingUsage] = useState<PrintJob | null>(null)
  const [page, setPage] = useState(0)
  const [shown, setShown] = useState<PrintJob[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(null)

  // Debounce search input — fire API call 300 ms after the user stops typing
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const needle    = debouncedSearch.trim().toLowerCase()
  const dateRange = dateFilter ? resolveDateRange(dateFilter, today) : null
  const isFiltered = !!needle || !!dateRange

  // Reset accumulated list whenever filters change
  useEffect(() => {
    setShown([])
    setPage(0)
  }, [debouncedSearch, dateFilter])

  const { data: total } = useQuery({
    queryKey: ['prints-count', needle, dateRange?.start, dateRange?.end, tz],
    queryFn: () => api.getPrintsTotal(
      needle || undefined,
      dateRange?.start,
      dateRange?.end,
      tz,
    ),
  })

  const { data: pagePrints = [], isLoading } = useQuery<PrintJob[]>({
    queryKey: ['prints', page, needle, dateRange?.start, dateRange?.end, tz],
    queryFn: () => api.getPrints(
      PAGE_SIZE,
      page * PAGE_SIZE,
      needle || undefined,
      dateRange?.start,
      dateRange?.end,
      tz,
    ),
  })

  useEffect(() => {
    if (pagePrints.length === 0) return
    setShown(prev => {
      const existingIds = new Set(prev.map(p => p.id))
      const newItems = pagePrints.filter(p => !existingIds.has(p.id))
      return newItems.length > 0 ? [...prev, ...newItems] : prev
    })
  }, [pagePrints])

  const { data: spools = [] } = useQuery<Spool[]>({
    queryKey: ['spools'],
    queryFn: () => api.getSpools(),
  })

  const { data: printers = [] } = useQuery<PrinterConfig[]>({
    queryKey: ['printers'],
    queryFn: api.getPrinters,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['prints'] })
    qc.invalidateQueries({ queryKey: ['prints-count'] })
    qc.invalidateQueries({ queryKey: ['spools'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    setShown([])
    setPage(0)
  }

  const createMut = useMutation({ mutationFn: api.createPrint, onSuccess: () => { invalidate(); setShowForm(false) } })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: unknown }) => api.updatePrint(id, data),
    onSuccess: (updated: PrintJob) => {
      setShown(prev => prev.map(j => j.id === updated.id ? updated : j))
      qc.invalidateQueries({ queryKey: ['spools'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      // Invalidate prints cache so navigating away and back shows fresh project badges
      qc.invalidateQueries({ queryKey: ['prints'] })
      setEditing(null)
    },
  })
  const deleteMut = useMutation({ mutationFn: api.deletePrint, onSuccess: invalidate })

  const totalCount = total?.total ?? 0
  const hasMore = shown.length < totalCount

  // Filtering is handled server-side; shown contains only matching results
  const filtered = shown

  const totalGrams = filtered.reduce((s, j) => s + j.total_grams, 0)
  const totalCost  = filtered.reduce((s, j) => s + j.total_cost, 0)

  const modeSeg = (
    <div className="seg">
      {(['month', 'week', 'day'] as FilterMode[]).map(m => (
        <button
          key={m}
          onClick={() => setDateFilter(f =>
            f?.mode === m ? null : { mode: m, preset: 'this', custom: presetToCustom(m, 'this', today) }
          )}
          className={`seg-item ${dateFilter?.mode === m ? 'seg-item-on' : 'hover:text-white'}`}
        >
          {t(`prints.filter.${m}`)}
        </button>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-3 h-full">
      <PageHeader
        title={`${t('prints.history')} (${isFiltered ? `${filtered.length} ${t('prints.countOf')} ` : ''}${shown.length}${totalCount > shown.length ? ` ${t('prints.countOf')} ${totalCount}` : ''})`}
        subtitle={filtered.length > 0 ? `${fmtNum(totalGrams, 0)} ${t('common.g')} · ${fmtCurrency(totalCost)}` : undefined}
        actions={
          <>
            <div className="relative w-full sm:w-52 order-last sm:order-none">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              <input
                type="search"
                className="input !rounded-full !bg-surface-2 pl-9 !py-1.5"
                placeholder={t('prints.search')}
                aria-label={t('prints.search')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button className="btn-primary flex items-center gap-1.5" onClick={() => setShowForm(true)}>
              <Plus size={14} /> {t('prints.logPrint')}
            </button>
          </>
        }
      />

      {/* Date filter: one row, scrolls sideways on narrow screens */}
      <div className="flex-none flex items-center gap-2 overflow-x-auto pb-1 [&>*]:shrink-0">
        <CalendarDays size={14} className="text-gray-500" />
        {modeSeg}
        {dateFilter && (
          <>
            <div className="seg">
              {(['this', 'last'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setDateFilter(f => f ? { ...f, preset: p, custom: presetToCustom(f.mode, p, today) } : null)}
                  className={`seg-item ${dateFilter.preset === p ? 'seg-item-on' : 'hover:text-white'}`}
                >
                  {dateFilter.mode === 'month'
                    ? (p === 'this' ? t('prints.filter.thisMonth') : t('prints.filter.lastMonth'))
                    : dateFilter.mode === 'week'
                    ? (p === 'this' ? t('prints.filter.thisWeek') : t('prints.filter.lastWeek'))
                    : (p === 'this' ? t('prints.filter.today') : t('prints.filter.yesterday'))}
                </button>
              ))}
            </div>

            <input
              type={dateFilter.mode === 'month' ? 'month' : 'date'}
              className="input !rounded-full !py-1 text-xs"
              style={{ width: 138 }}
              value={dateFilter.custom}
              onChange={e => {
                if (!e.target.value) return
                if (dateFilter.mode === 'week') {
                  // Snap to Monday of the selected week
                  const monday = getMondayOf(e.target.value)
                  setDateFilter(f => f ? { ...f, preset: 'custom', custom: monday } : null)
                } else {
                  setDateFilter(f => f ? { ...f, preset: 'custom', custom: e.target.value } : null)
                }
              }}
            />
            {dateFilter.mode === 'week' && dateFilter.custom && (
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {fmtShort(dateFilter.custom)} – {fmtShort(addDays(dateFilter.custom, 6))}
              </span>
            )}

            <button
              onClick={() => setDateFilter(null)}
              className="chip"
              title={t('prints.filter.clear')}
              aria-label={t('prints.filter.clear')}
            >
              <X size={12} /> {t('common.clear')}
            </button>
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
        {isLoading && shown.length === 0 && <p className="text-gray-500 text-sm">{t('common.loading')}</p>}

        {isFiltered && filtered.length === 0 && shown.length > 0 && (
          <p className="text-sm text-gray-500">{t('prints.noResults')}</p>
        )}

        {filtered.map(job => (
          <PrintRow
            key={job.id}
            job={job}
            printer={printers.find(p => p.name === job.printer_name) ?? null}
            onEdit={() => setEditing(job)}
            onDelete={async () => { if (await confirm({ title: t('prints.confirmDelete', { name: job.name }), danger: true })) deleteMut.mutate(job.id) }}
            onLogUsage={() => setLoggingUsage(job)}
          />
        ))}

        {hasMore && (
          <div className="flex justify-center pt-2">
            <button
              className="btn-ghost text-sm px-6"
              onClick={() => setPage(p => p + 1)}
              disabled={isLoading}
            >
              {isLoading ? t('common.loading') : t('prints.loadMore', { n: totalCount - shown.length })}
            </button>
          </div>
        )}
      </div>

      {(showForm || editing) && (
        <Modal>
          <PrintForm
            initial={editing ?? undefined}
            spools={spools}
            onSave={data => {
              if (editing) updateMut.mutate({ id: editing.id, data })
              else createMut.mutate(data)
            }}
            onCancel={() => { setShowForm(false); setEditing(null) }}
          />
        </Modal>
      )}

      {loggingUsage && (
        <Modal>
          <LogUsageModal
            job={loggingUsage}
            onSave={usages => {
              updateMut.mutate({
                id: loggingUsage.id,
                data: { usages },
              })
              setLoggingUsage(null)
            }}
            onCancel={() => setLoggingUsage(null)}
            onEdit={() => { setEditing(loggingUsage); setLoggingUsage(null) }}
          />
        </Modal>
      )}
    </div>
  )
}
