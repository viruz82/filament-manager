import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '../../components/ui/Feedback'
import { api } from '../../api'
import type { PrinterConfig } from '../../types'
import { Trash2, RefreshCw, Pencil } from 'lucide-react'
import { useCurrencySymbol, useCurrencyFormatter } from '../../hooks/useHATZ'
import { fmtNum } from '../../utils/number'
import { AMSTrayPanel } from './AmsTrays'

// ── Standby Section (inside PrinterCard) ─────────────────────────────────────

export function StandbySection({ printer }: { printer: PrinterConfig }) {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const resetMut = useMutation({
    mutationFn: () => api.resetPrinterStandby(printer.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['printers'] }),
  })

  return (
    <div className="mt-3 border-t border-surface-3 pt-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-0.5">{t('settings.printers.standbyKwh')}</p>
          <p className="text-sm text-gray-200">
            {printer.standby_kwh != null ? `${fmtNum(printer.standby_kwh, 3)} kWh` : '—'}
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">{t('settings.printers.standbyHint')}</p>
        </div>
        <button
          className="btn-ghost text-xs px-3 py-1.5 shrink-0"
          onClick={() => resetMut.mutate()}
          disabled={resetMut.isPending}
          title={t('settings.printers.resetStandby')}
        >
          {t('settings.printers.resetStandby')}
        </button>
      </div>
    </div>
  )
}

// ── Energy configuration (sensors + status), shown on the printer card ──────

function SensorLine({ label, entityId, unit }: { label: string; entityId: string | null; unit: string }) {
  const { t } = useTranslation()
  const { data, isPending } = useQuery({
    queryKey: ['ha-sensor-value', entityId],
    queryFn: () => api.getHASensorValue(entityId!),
    enabled: !!entityId,
    staleTime: 30_000,
    retry: false,
  })

  let status: React.ReactNode
  if (!entityId) {
    status = <span className="text-crit">✗ {t('settings.printers.sensorNotSet')}</span>
  } else if (isPending) {
    status = <span className="text-gray-500">…</span>
  } else if (data?.value == null) {
    status = <span className="text-crit">✗ {t('settings.printers.sensorMissing')}</span>
  } else {
    status = <span className="text-ok">✓ {data.value} {unit}</span>
  }

  return (
    <div className="text-xs">
      <p className="text-gray-500">{label}</p>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {entityId && <span className="font-mono text-gray-300 break-all">{entityId}</span>}
        {status}
      </p>
    </div>
  )
}

export function EnergyConfigSection({ printer }: { printer: PrinterConfig }) {
  const { t } = useTranslation()
  const currencySymbol = useCurrencySymbol()
  return (
    <div className="mt-3 border-t border-surface-3 pt-2 space-y-2">
      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{t('settings.printers.energyTracking')}</p>
      <SensorLine label={t('settings.printers.energySensor')} entityId={printer.energy_sensor_entity_id} unit="kWh" />
      <SensorLine label={t('settings.printers.priceSensor')} entityId={printer.price_sensor_entity_id} unit={`${currencySymbol}/kWh`} />
    </div>
  )
}

// ── Wear Section (inside PrinterCard) ────────────────────────────────────────

function WearSection({ printer, onEdit }: { printer: PrinterConfig; onEdit?: () => void }) {
  const { confirm } = useConfirm()
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fmtCurrency = useCurrencyFormatter()
  const [result, setResult] = useState<{ updated: number; total_wear_cost: number } | null>(null)

  const recalcMut = useMutation({
    mutationFn: () => api.recalculatePrinterWear(printer.id),
    onSuccess: data => {
      setResult(data)
      qc.invalidateQueries({ queryKey: ['prints'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const rate = printer.wear_cost_per_hour ?? 0

  return (
    <div className="mt-3 border-t border-surface-3 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-0.5">{t('settings.printers.wearCost')}</p>
          <p className="text-sm text-gray-200">{rate > 0 ? `${fmtCurrency(rate)} / h` : '—'}</p>
          {result && (
            <p className="text-[10px] text-ok mt-0.5">
              {t('settings.printers.wearRecalcDone', { count: result.updated, total: fmtCurrency(result.total_wear_cost) })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {onEdit && (
            <button className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1" onClick={onEdit}>
              <Pencil size={12} /> {t('common.edit')}
            </button>
          )}
          <button
            className="btn-ghost text-xs px-3 py-1.5"
            onClick={async () => {
              if (await confirm({ title: t('settings.printers.wearRecalcConfirm', { name: printer.name }) })) recalcMut.mutate()
            }}
            disabled={recalcMut.isPending}
            title={t('settings.printers.wearRecalcHint')}
          >
            {t('settings.printers.wearRecalc')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Printer Card ──────────────────────────────────────────────────────────────

export function PrinterCard({ printer, onEdit, onDelete }: {
  printer: PrinterConfig
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  const { data: status, refetch, isFetching } = useQuery({
    queryKey: ['printer-status', printer.id],
    queryFn: () => api.getPrinterStatus(printer.id),
    refetchInterval: 30_000,
    enabled: printer.is_active,
  })

  const stage = (status as Record<string, string | null> | undefined)?.print_stage?.toLowerCase() ?? 'unknown'
  const isPrinting = ['printing', 'auto_bed_leveling', 'heatbed_preheating'].includes(stage)

  const LABELS: Record<string, string> = {
    print_progress: t('settings.bambuCloud.statusProgress'), remaining_time: t('settings.bambuCloud.statusRemaining'),
    nozzle_temp: t('settings.bambuCloud.statusNozzle'), bed_temp: t('settings.bambuCloud.statusBed'), current_file: t('settings.bambuCloud.statusFile'),
  }
  const UNITS: Record<string, string> = {
    nozzle_temp: '°C', bed_temp: '°C', print_progress: '%', remaining_time: ' min',
  }

  return (
    <div className="bg-surface-2 border border-surface-3 rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold text-white">{printer.name}</p>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              isPrinting ? 'bg-info/15 text-info' :
              stage === 'finish' ? 'bg-ok/15 text-ok' :
              'bg-surface-3 text-gray-400'
            }`}>{stage}</span>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button className="btn-ghost p-1" onClick={() => refetch()} title="Refresh">
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          </button>
          <button className="btn-ghost px-2 py-1 text-xs flex items-center gap-1" onClick={onEdit}>
            <Pencil size={12} /> {t('common.edit')}
          </button>
          <button className="btn-ghost p-1 text-crit" onClick={onDelete}><Trash2 size={12} /></button>
        </div>
      </div>

      {/* Status values */}
      {status && (
        <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs text-gray-400 mb-3">
          {Object.entries(status as unknown as Record<string, string | null>).map(([key, val]) => (
            val && key !== 'print_stage' ? (
              key === 'current_file' ? (
                <span key={key} className="col-span-3 flex gap-1 min-w-0">
                  <span className="shrink-0">{LABELS[key]}:</span>
                  <span className="text-white truncate" title={val}>{val}</span>
                </span>
              ) : (
                <span key={key}>{LABELS[key] ?? key}: <span className="text-white">{val}{UNITS[key] ?? ''}</span></span>
              )
            ) : null
          ))}
        </div>
      )}

      {/* AMS tray assignment — always visible */}
      <AMSTrayPanel printer={printer} />

      {/* Energy sensors (with live check) */}
      <EnergyConfigSection printer={printer} />

      {/* Wear / depreciation cost */}
      <WearSection printer={printer} onEdit={onEdit} />
    </div>
  )
}
