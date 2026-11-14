import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import type { PrintJob, Spool, AMSTray, PrinterConfig, SuggestedUsage } from '../../types'
import { X, RefreshCw } from 'lucide-react'
import { fmtNum } from '../../utils/number'

// ── Log Usage Modal ───────────────────────────────────────────────────────────

export function LogUsageModal({
  job,
  onSave,
  onCancel,
  onEdit,
}: {
  job: PrintJob
  onSave: (usages: { spool_id: number; grams_used: number; ams_slot: string }[]) => void
  onCancel: () => void
  onEdit: () => void
}) {
  const { t } = useTranslation()

  const { data: spools = [] } = useQuery<Spool[]>({
    queryKey: ['spools'],
    queryFn: () => api.getSpools(),
  })

  // Backward-compat fallback: for old suggestions without a spool_id, look up current AMS tray.
  const { data: printers = [] } = useQuery<PrinterConfig[]>({
    queryKey: ['printers'],
    queryFn: api.getPrinters,
  })
  const printer = printers.find(p => p.name === job.printer_name) ?? null
  const { data: trays = [], isLoading: traysLoading, refetch: refetchTrays } = useQuery<AMSTray[]>({
    queryKey: ['printer-ams', printer?.id],
    queryFn: () => api.getPrinterAMS(printer!.id),
    enabled: !!printer && (job.suggested_usages ?? []).length > 0,
  })
  const traysBySlot = Object.fromEntries(trays.map(t => [t.slot_key, t]))

  const suggestions = job.suggested_usages ?? []

  const hasUnresolved = !traysLoading && suggestions.some(s =>
    s.spool_id
      ? !spools.some(sp => sp.id === s.spool_id)
      : !traysBySlot[s.ams_slot]?.spool
  )

  // Grams state keyed by index (not ams_slot) — swap scenario has two entries for same slot
  const [grams, setGrams] = useState<Record<number, string>>(() =>
    Object.fromEntries(suggestions.map((s, i) => [i, String(s.grams)]))
  )

  const handleSave = () => {
    const usages: { spool_id: number; grams_used: number; ams_slot: string }[] = []
    suggestions.forEach((s, i) => {
      const gramsVal = parseFloat(grams[i] || '0')
      const spoolId = s.spool_id ?? traysBySlot[s.ams_slot]?.spool?.id ?? null
      if (gramsVal <= 0 || spoolId == null) return
      usages.push({ spool_id: spoolId, grams_used: gramsVal, ams_slot: s.ams_slot })
    })
    onSave(usages)
  }

  // Group suggestions by ams_slot to detect swap rows
  const grouped = suggestions.reduce<Record<string, Array<SuggestedUsage & { _idx: number }>>>(
    (acc, s, i) => {
      if (!acc[s.ams_slot]) acc[s.ams_slot] = []
      acc[s.ams_slot].push({ ...s, _idx: i })
      return acc
    }, {}
  )

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-2 border border-surface-3 rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-3">
          <div>
            <h2 className="font-semibold">{t('prints.logUsage')}</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{job.name}</p>
          </div>
          <button onClick={onCancel} className="btn-ghost p-1"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-info bg-info/15 rounded px-3 py-1.5">
            {t('prints.cloudSuggestion')}
          </p>

          {suggestions.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">{t('prints.noCloudData')}</p>
              <button className="btn-secondary w-full" onClick={onEdit}>
                {t('prints.logManually')}
              </button>
            </div>
          )}

          {Object.entries(grouped).map(([slot, entries]) => {
            const isSwap = entries.length > 1
            return (
              <div key={slot} className={isSwap ? 'rounded-lg border border-warn/40 bg-warn/15 p-3 space-y-2' : ''}>
                {isSwap && (
                  <p className="text-xs text-warn font-medium">
                    {t('prints.spoolSwapDetected')} · {slot}
                  </p>
                )}
                {entries.map(s => {
                  const spool = s.spool_id
                    ? (spools.find(sp => sp.id === s.spool_id) ?? null)
                    : (traysBySlot[s.ams_slot]?.spool ?? null)
                  const swapLabel = s.swap_index === 0
                    ? t('prints.swapOriginal')
                    : s.swap_index === 1
                      ? t('prints.swapReplacement')
                      : null
                  return (
                    <div key={s._idx} className="flex items-center gap-3">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ background: spool?.color_hex ?? s.color ?? '#888' }}
                      />
                      <div className="flex-1 min-w-0">
                        {spool ? (
                          <>
                            <p className="text-sm text-white truncate">
                              {spool.brand} {spool.material}
                              {spool.subtype ? ` ${spool.subtype}` : ''} · {spool.color_name}
                              {swapLabel && (
                                <span className="ml-1.5 text-xs text-warn">({swapLabel})</span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500">
                              {!isSwap && `${slot} · `}{spool.remaining_pct}%
                              {` (${fmtNum((spool.current_weight_g / 1000), 3)} kg)`}
                              {s.estimated && (
                                <span className="ml-1.5 text-warn">{t('common.est')}</span>
                              )}
                            </p>
                          </>
                        ) : (
                          <div>
                            <p className="text-sm text-gray-400">
                              {slot}{s.filament_type ? ` · ${s.filament_type}` : ''}
                              {swapLabel && (
                                <span className="ml-1.5 text-xs text-warn">({swapLabel})</span>
                              )}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-xs text-warn">{t('prints.spoolNotMatched')}</p>
                              <button
                                className="text-xs text-info hover:text-info flex items-center gap-0.5"
                                onClick={() => refetchTrays()}
                                disabled={traysLoading}
                                title={t('prints.reloadSlot')}
                              >
                                <RefreshCw size={10} className={traysLoading ? 'animate-spin' : ''} />
                                {t('prints.reloadSlot')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          className="input w-20 text-sm py-1 text-right"
                          type="number"
                          min="0"
                          step="0.1"
                          placeholder="0"
                          value={grams[s._idx] ?? ''}
                          onChange={e => setGrams(g => ({ ...g, [s._idx]: e.target.value }))}
                        />
                        <span className="text-xs text-gray-500">g</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}

          <p className="text-xs text-gray-500 pt-1">{t('prints.gramsHint')}</p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-3">
          <button className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
          {hasUnresolved && suggestions.length > 0 && (
            <button className="btn-secondary" onClick={onEdit}>
              {t('prints.logManually')}
            </button>
          )}
          <button className="btn-primary" onClick={handleSave}>
            {t('prints.saveUsage')}
          </button>
        </div>
      </div>
    </div>
  )
}
