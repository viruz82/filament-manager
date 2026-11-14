import { useState, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '../components/ui/Feedback'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import Ring from '../components/ui/Ring'
import { api } from '../api'
import type { DashboardStats, PrintJob, PrinterConfig, PrinterStatus, AMSTray, Spool, PrinterEnergy } from '../types'
import { AlertTriangle, Printer, Zap, CheckCircle2, ChevronRight } from 'lucide-react'
import { findBestSpoolMatch } from '../utils/amsMatch'
import { formatDistanceToNow } from 'date-fns'
import { enUS, de, es, type Locale } from 'date-fns/locale'
import { useHATZ, useCurrencyFormatter, useCurrencySymbol } from '../hooks/useHATZ'
import { parseUTC } from '../utils/time'
import { fmtNum } from '../utils/number'

const ChartSection = lazy(() => import('../components/dashboard/DashboardCharts'))

const LOCALE_MAP: Record<string, Locale> = { en: enUS, de, es }


// ── Inventory key figures ─────────────────────────────────────────────────────

function InventoryCard({ stats }: { stats: DashboardStats }) {
  const { t } = useTranslation()
  const fmtCurrency = useCurrencyFormatter()

  const usedKg = stats.total_filament_kg - stats.total_available_kg
  const usedEur = stats.total_filament_spent_eur - stats.total_available_eur
  const spools = (n: number) => t('dashboard.spoolCount', { count: n })

  return (
    <div className="card">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        {t('dashboard.inventoryGroup')}
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-4">
        <StatTile
          className="col-span-2 lg:col-span-1"
          label={t('dashboard.available')}
          value={<span className="text-2xl">{fmtNum(stats.total_available_kg, 2)} {t('common.kg')}</span>}
          detail={`${spools(stats.active_spools)} · ${fmtCurrency(stats.total_available_eur)}`}
          tone="ok"
        />
        <StatTile
          label={t('dashboard.totalPurchased')}
          value={`${fmtNum(stats.total_filament_kg, 2)} ${t('common.kg')}`}
          detail={`${spools(stats.total_spools)} · ${fmtCurrency(stats.total_filament_spent_eur)}`}
        />
        <StatTile
          label={t('dashboard.printedSpent')}
          value={`${fmtNum(usedKg, 2)} ${t('common.kg')}`}
          detail={`${t('dashboard.emptyCount', { count: stats.empty_spools })} · ${fmtCurrency(usedEur)}`}
          tone="muted"
        />
        {stats.refill_pack_spools > 0 && (
          <StatTile
            label={t('dashboard.refillPacks')}
            value={`${fmtNum(stats.refill_pack_kg, 2)} ${t('common.kg')}`}
            detail={`${spools(stats.refill_pack_spools)} · ${fmtCurrency(stats.refill_pack_spent_eur)}`}
            tone="muted"
          />
        )}
      </div>
    </div>
  )
}

// ── Running job card ──────────────────────────────────────────────────────────

function fmtMinutes(raw: string): string {
  const m = Math.round(Number(raw))
  if (!Number.isFinite(m)) return raw
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`
}

function ProgressDisc({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct))
  return (
    <div
      className="rounded-full shrink-0 grid place-items-center w-14 h-14"
      style={{ background: `conic-gradient(rgb(var(--fm-info)) ${p * 3.6}deg, rgba(128,128,128,0.25) 0)` }}
      role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}
    >
      <span className="rounded-full bg-surface-2 grid place-items-center w-11 h-11 text-xs font-semibold tabular-nums text-info">
        {Math.round(p)}%
      </span>
    </div>
  )
}

function RunningJobCard({ job, printers }: { job: PrintJob; printers: PrinterConfig[] }) {
  const { confirm } = useConfirm()
  const { t, i18n } = useTranslation()
  const locale = LOCALE_MAP[i18n.resolvedLanguage ?? 'en'] ?? enUS
  const qc = useQueryClient()

  const printer = printers.find(p => p.name === job.printer_name) ?? null

  const { data: status } = useQuery<PrinterStatus>({
    queryKey: ['printer-status-live', printer?.id],
    queryFn: () => api.getPrinterStatus(printer!.id),
    enabled: !!printer,
    refetchInterval: 10_000,
  })

  const forceFinishMut = useMutation({
    mutationFn: () => api.updatePrint(job.id, {
      finished_at: new Date().toISOString(),
      success: true,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  })

  const handleForceFinish = async () => {
    if (!(await confirm({ title: t('dashboard.forceFinishConfirm') }))) return
    forceFinishMut.mutate()
  }

  const progress = status?.print_progress != null && status.print_progress !== '' ? Number(status.print_progress) : null
  const chips: { key: string; label: string; value: string }[] = []
  if (status?.remaining_time) chips.push({ key: 'rem', label: t('settings.bambuCloud.statusRemaining'), value: fmtMinutes(status.remaining_time) })
  if (status?.print_weight) chips.push({ key: 'w', label: t('dashboard.liveWeight'), value: `${status.print_weight} ${t('common.g')}` })
  if (status?.active_tray) chips.push({ key: 'tray', label: t('settings.bambuCloud.statusActiveTray'), value: String(status.active_tray) })

  return (
    <div className="card border border-info/40 bg-info/15">
      <div className="flex items-center gap-3">
        {progress != null && Number.isFinite(progress)
          ? <ProgressDisc pct={progress} />
          : <Zap size={20} className="text-info shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white truncate max-w-full">{job.name}</p>
            <span className="pill pill-info">{t('dashboard.runningJob')}</span>
            {status?.print_stage && <span className="pill">{status.print_stage}</span>}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {job.printer_name && <span>{job.printer_name} · </span>}
            {t('dashboard.runningFor')} {formatDistanceToNow(parseUTC(job.started_at), { locale })}
          </p>
        </div>
        <button
          className="btn-ghost !px-2.5 !py-1 text-xs shrink-0 flex items-center gap-1 border border-surface-3"
          onClick={handleForceFinish}
          disabled={forceFinishMut.isPending}
          title={t('dashboard.forceFinish')}
        >
          <CheckCircle2 size={13} />
          <span className="hidden sm:inline">{t('dashboard.forceFinish')}</span>
        </button>
      </div>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map(c => (
            <span key={c.key} className="pill !bg-surface-2/70">
              <span className="text-gray-500 font-medium">{c.label}</span> {c.value}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Recent print row ──────────────────────────────────────────────────────────

function PrintRow({ job }: { job: PrintJob }) {
  const { i18n } = useTranslation()
  const fmtCurrency = useCurrencyFormatter()
  const locale = LOCALE_MAP[i18n.resolvedLanguage ?? 'en'] ?? enUS
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-surface-3 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white truncate">{job.name}</p>
        <p className="text-xs text-gray-500 truncate">
          {formatDistanceToNow(parseUTC(job.started_at), { addSuffix: true, locale })}
          {job.printer_name && ` · ${job.printer_name}`}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm text-white tabular-nums">{fmtNum(job.total_grams, 0)} g</p>
        {job.total_cost > 0 && (
          <p className="text-xs text-gray-400 tabular-nums">{fmtCurrency(job.total_cost)}</p>
        )}
      </div>
    </div>
  )
}

// ── AMS mismatch alert ────────────────────────────────────────────────────────

function AMSPrinterAlert({ printer, spools }: { printer: PrinterConfig; spools: Spool[] }) {
  const { t } = useTranslation()

  const { data: trays = [] } = useQuery<AMSTray[]>({
    queryKey: ['printer-ams', printer.id],
    queryFn: () => api.getPrinterAMS(printer.id),
    refetchInterval: 30_000,
  })

  const mismatches = trays.filter(tr =>
    tr.ha_material &&
    tr.ha_color_hex &&
    tr.ha_remaining !== null &&
    parseFloat(tr.ha_remaining) > 0 &&
    findBestSpoolMatch(tr, spools) === null
  )

  if (mismatches.length === 0) return null

  return (
    <div className="card border border-warn/40 bg-warn/15">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <AlertTriangle size={14} className="text-warn" /> {t('dashboard.amsNoMatchCard')} — {printer.name}
      </h3>
      <div>
        {mismatches.map(tr => (
          <div key={tr.slot_key} className="flex items-center gap-3 py-2 border-b border-warn/40 last:border-0">
            <span
              className="w-3 h-3 rounded-full shrink-0 border border-white/20"
              style={{ background: tr.ha_color_hex ?? '#888' }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white">
                {tr.slot_key.replace(/ams(\d+)_tray(\d+)/, 'AMS $1 · T$2')}
                <span className="text-gray-400 ml-2">{tr.ha_material}</span>
              </p>
            </div>
            <span className="text-xs text-gray-400 shrink-0">{t('dashboard.amsNoMatch')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { t } = useTranslation()

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: api.getDashboard,
    refetchInterval: 30_000,
  })

  const { data: printers = [] } = useQuery<PrinterConfig[]>({
    queryKey: ['printers'],
    queryFn: api.getPrinters,
  })

  const { data: spools = [] } = useQuery<Spool[]>({
    queryKey: ['spools'],
    queryFn: () => api.getSpools(),
  })

  if (isLoading) return <div className="text-gray-500 text-sm">{t('common.loading')}</div>
  if (!stats) return null

  const cloudPrinters = printers.filter(p => p.is_active && !!p.bambu_serial)

  return (
    <div className="space-y-4">
      <PageHeader title={t('dashboard.title')} />

      {/* Running job — only shown when a print is active */}
      {stats.running_job && (
        <RunningJobCard job={stats.running_job} printers={printers} />
      )}

      {/* AMS mismatch warnings — one card per printer with unmatched trays */}
      {cloudPrinters.map(p => (
        <AMSPrinterAlert key={p.id} printer={p} spools={spools} />
      ))}

      <InventoryCard stats={stats} />

      <Suspense fallback={<div className="card h-[320px] animate-pulse" />}>
        <ChartSection stats={stats} />
      </Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Printer size={14} /> {t('dashboard.recentPrints')}
            </h3>
            <Link to="/prints" className="text-xs text-accent flex items-center gap-0.5 hover:underline">
              {t('dashboard.allPrints')} <ChevronRight size={12} />
            </Link>
          </div>
          {stats.recent_prints.length === 0 ? (
            <p className="text-gray-500 text-sm">{t('dashboard.noPrints')}</p>
          ) : (
            stats.recent_prints.map(job => <PrintRow key={job.id} job={job} />)
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <AlertTriangle size={14} className="text-warn" /> {t('dashboard.lowStockAlerts')}
            </h3>
            {stats.low_stock.length > 0 && (
              <Link to="/spools?filter=low" className="text-xs text-accent flex items-center gap-0.5 hover:underline">
                {t('dashboard.allLow')} <ChevronRight size={12} />
              </Link>
            )}
          </div>
          {stats.low_stock.length === 0 ? (
            <p className="text-gray-500 text-sm">{t('dashboard.allWellStocked')}</p>
          ) : (
            stats.low_stock.map(spool => (
              <Link
                key={spool.id}
                to={`/spools?spool=${spool.id}`}
                className="flex items-center gap-3 py-2 border-b border-surface-3 last:border-0 hover:bg-surface-3/40 rounded-lg -mx-1 px-1 transition-colors"
              >
                <Ring spool={spool} pct={Math.round(spool.remaining_pct)} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">
                    {spool.brand} {spool.material}{spool.subtype ? ` ${spool.subtype}` : ''} — {spool.color_name}
                  </p>
                  <p className="text-xs text-gray-500 tabular-nums">
                    {fmtNum(spool.current_weight_g, 0)} {t('common.g')}
                  </p>
                </div>
                <span className="pill pill-warn tabular-nums">{Math.round(spool.remaining_pct)}%</span>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
