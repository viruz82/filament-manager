import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import type { PrintJob, Spool, PrinterConfig, PrinterStatus } from '../../types'
import { Pencil, Trash2, Ellipsis, CheckCircle, XCircle, Zap, Scale, FileText, FolderOpen, ExternalLink } from 'lucide-react'
import Menu from '../ui/Menu'
import type { MenuItem } from '../ui/Menu'
import StatTile from '../ui/StatTile'
import { discBackground } from '../ui/Ring'
import { useHATZ, useCurrencyFormatter } from '../../hooks/useHATZ'
import { useAmsSlotLabel } from '../../hooks/useAmsSlots'
import { fmtNum } from '../../utils/number'
import { formatDateTimeTZ } from '../../utils/time'

// ── Live status bar for active (open) print jobs ──────────────────────────────

const LIVE_UNITS: Record<string, string> = {
  print_progress: '%',
  remaining_time: ' min',
  print_weight:   'g',
}
const LIVE_KEYS = ['print_stage', 'print_progress', 'remaining_time', 'print_weight', 'ams_active', 'active_tray'] as const

function LivePrintStatus({ printerId }: { printerId: number }) {
  const { t } = useTranslation()
  const liveLabels: Record<string, string> = {
    print_stage:    t('settings.bambuCloud.statusStage'),
    print_progress: t('settings.bambuCloud.statusProgress'),
    remaining_time: t('settings.bambuCloud.statusRemaining'),
    print_weight:   'Weight',
    ams_active:     'AMS',
    active_tray:    t('settings.bambuCloud.statusActiveTray'),
  }
  const { data: status } = useQuery<PrinterStatus>({
    queryKey: ['printer-status-live', printerId],
    queryFn: () => api.getPrinterStatus(printerId),
    refetchInterval: 10_000,
  })

  const entries = status
    ? LIVE_KEYS.map(k => [k, status[k]] as [string, string | null]).filter(([, v]) => v != null && v !== '')
    : []

  if (entries.length === 0) return null

  return (
    <div className="mt-2 pt-2 border-t border-surface-3 flex flex-wrap gap-x-4 gap-y-0.5">
      {entries.map(([key, val]) => (
        <span key={key} className="text-xs text-gray-500">
          {liveLabels[key]}: <span className="text-gray-300">{val}{LIVE_UNITS[key] ?? ''}</span>
        </span>
      ))}
    </div>
  )
}

// ── Print Row ─────────────────────────────────────────────────────────────────

export function PrintRow({ job, printer, onEdit, onDelete, onLogUsage }: {
  job: PrintJob
  printer: PrinterConfig | null
  onEdit: () => void
  onDelete: () => void
  onLogUsage: () => void
}) {
  const { t } = useTranslation()
  const tz = useHATZ()
  const fmtCurrency = useCurrencyFormatter()
  const slotLabel = useAmsSlotLabel()
  const [expanded, setExpanded] = useState(false)
  const needsUsage = job.source === 'auto' && job.finished_at && job.total_grams === 0 && job.suggested_usages !== null
  const showModel = job.model_name && job.model_name !== job.name
  const showDesignTitle = job.design_title && job.design_title !== job.name
  const designLabel = showDesignTitle ? job.design_title : showModel ? job.model_name : null
  const hasDetail = job.usages.length > 0 || job.energy_kwh != null || job.wear_cost != null

  const menuItems: MenuItem[] = [
    { key: 'edit', label: t('common.edit'), icon: <Pencil size={14} />, onClick: onEdit },
    ...(needsUsage ? [{ key: 'usage', label: t('prints.logUsage'), icon: <Scale size={14} />, onClick: onLogUsage }] : []),
    { key: 'delete', label: t('common.delete'), icon: <Trash2 size={14} />, onClick: onDelete, danger: true },
  ]

  return (
    <div className="card !p-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
      <div className="flex items-start gap-3">
        {job.success
          ? <CheckCircle size={18} className="text-ok shrink-0 mt-0.5" />
          : <XCircle size={18} className="text-crit shrink-0 mt-0.5" />
        }
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white line-clamp-2 break-words">{job.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatDateTimeTZ(job.started_at, tz)}
            {job.printer_name && ` · ${job.printer_name}`}
            {job.duration_hours && ` · ${fmtNum(Number(job.duration_hours), 1)} h`}
          </p>
          {(job.source === 'auto' || !job.success || job.project_name || job.url || needsUsage) && (
            <div className="flex flex-wrap items-center gap-1 mt-1.5">
              {!job.success && <span className="pill pill-crit">{t('prints.failed')}</span>}
              {job.source === 'auto' && <span className="pill pill-info"><Zap size={9} /> auto</span>}
              {job.project_name && <span className="pill max-w-full"><FolderOpen size={9} className="shrink-0" /> <span className="truncate">{job.project_name}</span></span>}
              {needsUsage && (
                <button
                  type="button"
                  className="pill pill-warn hover:brightness-125"
                  onClick={e => { e.stopPropagation(); onLogUsage() }}
                >
                  <Scale size={9} /> {t('prints.usageMissing')}
                </button>
              )}
              {job.url && (
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="pill hover:text-info"
                  title={job.url}
                >
                  <ExternalLink size={9} /> {t('prints.link')}
                </a>
              )}
            </div>
          )}
          {job.description && (
            <p className="text-xs text-gray-400 mt-1 line-clamp-2 break-words">{job.description}</p>
          )}
          {designLabel && (
            <p className="text-xs text-gray-600 flex items-center gap-1 mt-0.5 min-w-0">
              <FileText size={10} className="shrink-0" />
              <span className="truncate">{designLabel}</span>
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm text-white tabular-nums">{fmtNum(job.total_grams, 1)} {t('common.g')}</p>
          {job.total_cost > 0 && <p className="text-xs text-gray-400 tabular-nums">{fmtCurrency(job.total_cost)}</p>}
        </div>
        <Menu
          label={t('prints.actions')}
          triggerClassName="p-1.5 text-gray-400"
          trigger={<Ellipsis size={16} />}
          items={menuItems}
        />
      </div>

      {/* Live status — always visible for active (open) jobs that have a known printer */}
      {!job.finished_at && printer && (
        <LivePrintStatus printerId={printer.id} />
      )}

      {expanded && hasDetail && (
        <div className="mt-3 pt-3 border-t border-surface-3 space-y-3">
          {(job.energy_kwh != null || job.wear_cost != null) && (
            <div className="grid grid-cols-3 gap-3">
              <StatTile label={t('prints.material')} value={fmtCurrency(job.material_cost ?? 0)} />
              {job.energy_kwh != null && (
                <StatTile
                  label={t('prints.energy')}
                  value={`${fmtNum(job.energy_kwh, 2)} kWh`}
                  detail={job.energy_cost != null ? fmtCurrency(job.energy_cost) : undefined}
                />
              )}
              {job.wear_cost != null && <StatTile label={t('prints.wearCost')} value={fmtCurrency(job.wear_cost)} />}
            </div>
          )}
          {job.usages.length > 0 && (
            <div className="space-y-1.5">
              {job.usages.map(u => (
                <div key={u.id} className="flex items-center gap-2 text-xs text-gray-400">
                  <span
                    className="w-3 h-3 rounded-full shrink-0 ring-1 ring-white/10"
                    style={{ background: u.spool ? discBackground(u.spool) : 'rgba(128,128,128,0.4)' }}
                  />
                  <span className="flex-1 min-w-0 truncate">
                    {u.spool
                      ? `${u.spool.brand} ${u.spool.material}${u.spool.subtype ? ` ${u.spool.subtype}` : ''} — ${u.spool.color_name}`
                      : `Spool #${u.spool_id}`}
                  </span>
                  {u.ams_slot && <span className="pill pill-info">{slotLabel(u.ams_slot)}</span>}
                  <span className="tabular-nums text-gray-300 shrink-0">{fmtNum(u.grams_used, 1)} {t('common.g')}</span>
                  {u.cost && <span className="text-gray-500 tabular-nums shrink-0">{fmtCurrency(u.cost)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
