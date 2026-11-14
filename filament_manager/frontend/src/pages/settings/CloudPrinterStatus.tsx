import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import type { PrinterConfig } from '../../types'
import { RefreshCw, Pencil, Download, Wifi, WifiOff } from 'lucide-react'
import { StandbySection, EnergyConfigSection } from './PrinterCard'

// ── Cloud printer live status (used in Experiments tab) ───────────────────────

export function CloudPrinterStatus({ printer, onEdit }: { printer: PrinterConfig; onEdit?: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [reconnecting, setReconnecting] = useState(false)

  const { data: status, refetch, isFetching } = useQuery({
    queryKey: ['cloud-status', printer.bambu_serial],
    queryFn: () => api.getBambuCloudPrinterStatus(printer.bambu_serial!),
    refetchInterval: 10_000,
    enabled: !!printer.bambu_serial,
  })

  const { data: trays, refetch: refetchTrays } = useQuery({
    queryKey: ['cloud-ams', printer.bambu_serial],
    queryFn: () => api.getBambuCloudPrinterAMS(printer.bambu_serial!),
    refetchInterval: 10_000,
    enabled: !!printer.bambu_serial,
  })

  const { data: debugInfo, refetch: refetchDebug } = useQuery({
    queryKey: ['cloud-debug'],
    queryFn: () => api.getBambuCloudDebug(),
    refetchInterval: 10_000,
  })
  const rawCache = printer.bambu_serial && debugInfo?.printer_status_cache
    ? debugInfo.printer_status_cache[printer.bambu_serial] ?? {}
    : {}
  const rawAmsCache = printer.bambu_serial && debugInfo?.ams_cache
    ? debugInfo.ams_cache[printer.bambu_serial] ?? {}
    : {}

  // MQTT connection status for this serial
  const mqttInfo = printer.bambu_serial && debugInfo?.mqtt_clients
    ? debugInfo.mqtt_clients[printer.bambu_serial] ?? null
    : null
  const mqttConnected = mqttInfo?.connected === true

  const handleReconnect = async () => {
    setReconnecting(true)
    try {
      await api.bambuCloudReconnect()
      // Poll debug endpoint until MQTT shows connected for this serial (max 15s)
      const serial = printer.bambu_serial
      if (serial) {
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 1000))
          const dbg = await api.getBambuCloudDebug()
          if (dbg.mqtt_clients?.[serial]?.connected) break
        }
      }
      await Promise.all([refetch(), refetchTrays(), refetchDebug()])
      qc.invalidateQueries({ queryKey: ['printer-ams'] })
    } finally {
      setReconnecting(false)
    }
  }

  const handleRefreshAll = () => {
    refetch()
    refetchTrays()
    refetchDebug()
  }

  const [activeUnit, setActiveUnit] = useState(1)
  const [showRaw, setShowRaw] = useState(false)
  const [downloadingTasks, setDownloadingTasks] = useState(false)

  const handleDownloadTasks = async () => {
    if (!printer.bambu_serial) return
    setDownloadingTasks(true)
    try {
      const data = await api.getBambuCloudTasksRaw(printer.bambu_serial)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tasks_${printer.bambu_serial}.json`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloadingTasks(false)
    }
  }

  const LABELS: Record<string, string> = {
    print_stage: t('settings.bambuCloud.statusStage'), print_progress: t('settings.bambuCloud.statusProgress'),
    remaining_time: t('settings.bambuCloud.statusRemaining'), nozzle_temp: t('settings.bambuCloud.statusNozzle'),
    bed_temp: t('settings.bambuCloud.statusBed'), current_file: t('settings.bambuCloud.statusFile'),
    active_tray: t('settings.bambuCloud.statusActiveTray'),
  }
  const UNITS: Record<string, string> = {
    nozzle_temp: '°C', bed_temp: '°C', print_progress: '%', remaining_time: ' min',
  }

  const statusEntries = status
    ? Object.entries(status as Record<string, string | null>).filter(([, v]) => v != null && v !== '')
    : []

  // Group AMS trays by unit
  const amsUnits = trays
    ? Array.from(new Set(trays.map(tr => {
        const m = tr.slot_key.match(/^ams(\d+)_/)
        return m ? parseInt(m[1]) : 1
      }))).sort()
    : []
  const visibleUnit = amsUnits.includes(activeUnit) ? activeUnit : (amsUnits[0] ?? 1)

  return (
    <div className="bg-surface-2 border border-surface-3 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-semibold text-white">{printer.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-gray-500">{'•'.repeat(8)}{printer.bambu_serial?.slice(-4) ?? '—'}</p>
            {/* MQTT connection indicator */}
            {mqttInfo !== null && (
              mqttConnected
                ? <span className="flex items-center gap-1 text-[10px] text-ok"><Wifi size={10} /> MQTT</span>
                : <span className="flex items-center gap-1 text-[10px] text-crit"><WifiOff size={10} /> {t('settings.bambuCloud.notConnected')}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="btn-ghost p-1 text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
            onClick={handleDownloadTasks}
            disabled={downloadingTasks}
            title="Download full task list from Bambu Cloud as JSON"
          >
            <Download size={11} className={downloadingTasks ? 'animate-pulse' : ''} />
            {downloadingTasks ? t('settings.bambuCloud.fetchingTasks') : t('settings.bambuCloud.tasks')}
          </button>
          <button
            className="btn-ghost p-1 text-xs text-info hover:text-info flex items-center gap-1"
            onClick={handleReconnect}
            disabled={reconnecting}
            title="Reconnect MQTT and request fresh data"
          >
            <RefreshCw size={11} className={reconnecting ? 'animate-spin' : ''} />
            {reconnecting ? t('settings.bambuCloud.reconnecting') : t('settings.bambuCloud.reconnect')}
          </button>
          <button className="btn-ghost p-1" onClick={handleRefreshAll} title="Refresh cache">
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Printer sensor values */}
      {statusEntries.length > 0 ? (
        <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs text-gray-400 mb-3">
          {statusEntries.map(([key, val]) => (
            key === 'current_file' ? (
              <span key={key} className="col-span-3 flex gap-1 min-w-0">
                <span className="shrink-0">{LABELS[key]}:</span>
                <span className="text-white truncate" title={val ?? ''}>{val}</span>
              </span>
            ) : (
              <span key={key}>{LABELS[key] ?? key}: <span className="text-white">{val}{UNITS[key] ?? ''}</span></span>
            )
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500 mb-3">{t('settings.bambuCloud.noStatusData')}</p>
      )}

      {/* AMS tray values — grouped by unit */}
      {trays && trays.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-xs font-medium text-gray-400">{t('settings.printers.amsAssignment')}</p>
            {amsUnits.length > 1 && (
              <div className="flex rounded overflow-hidden border border-surface-3 text-xs">
                {amsUnits.map(u => (
                  <button
                    key={u}
                    onClick={() => setActiveUnit(u)}
                    className={`px-2.5 py-0.5 transition-colors ${
                      visibleUnit === u ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    AMS {u}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1">
            {trays
              .filter(tr => {
                const m = tr.slot_key.match(/^ams(\d+)_/)
                return m ? parseInt(m[1]) === visibleUnit : true
              })
              .map(tray => (
                <div key={tray.slot_key} className="flex items-center gap-2 bg-surface-3/40 rounded-lg px-3 py-1.5 text-xs">
                  <span className="font-mono text-gray-400 w-20 shrink-0">{tray.slot_key}</span>
                  {tray.ha_color_hex ? (
                    <span className="w-3 h-3 rounded-full border border-white/20 shrink-0" style={{ background: tray.ha_color_hex }} />
                  ) : (
                    <span className="w-3 h-3 rounded-full bg-surface-3 border border-white/10 shrink-0" />
                  )}
                  <span className="text-gray-300 flex-1">{tray.ha_material ?? '—'}</span>
                  <span className="text-gray-400">{tray.ha_remaining != null ? `${tray.ha_remaining}%` : '—'}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Energy sensor config (with live check and edit button) */}
      <EnergyConfigSection printer={printer} />
      {onEdit && (
        <div className="mt-2">
          <button className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1" onClick={onEdit}>
            <Pencil size={12} /> {t('common.edit')}
          </button>
        </div>
      )}

      {/* Standby energy */}
      {printer.energy_sensor_entity_id && (
        <StandbySection printer={printer} />
      )}

      {/* Raw MQTT cache dump */}
      <div className="mt-3 border-t border-surface-3 pt-2">
        <div className="flex items-center justify-between gap-2">
          <button
            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
            onClick={() => setShowRaw(r => !r)}
          >
            {showRaw ? '▾' : '▸'} Raw MQTT cache ({Object.keys(rawCache).length} printer fields, {Object.keys(rawAmsCache).length} AMS slots)
          </button>
          {debugInfo && printer.bambu_serial && (
            <button
              className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
              title="Download full MQTT cache as JSON"
              onClick={() => {
                const serial = printer.bambu_serial!
                const payload = {
                  serial,
                  exported_at: new Date().toISOString(),
                  printer_status: debugInfo.printer_status_cache?.[serial] ?? {},
                  ams_cache: debugInfo.ams_cache?.[serial] ?? {},
                  mqtt_client: debugInfo.mqtt_clients?.[serial] ?? {},
                }
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `mqtt_cache_${serial}.json`
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              <Download size={11} /> Download JSON
            </button>
          )}
        </div>
        {showRaw && (
          <div className="mt-2 space-y-3">
            {/* Printer status fields */}
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Printer status</p>
              {Object.keys(rawCache).length === 0 ? (
                <span className="text-[11px] font-mono text-gray-600">No data in cache yet</span>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] font-mono">
                  {Object.entries(rawCache).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
                    <span key={k} className="text-gray-500 truncate">
                      {k}: <span className="text-gray-300">{String(v)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* AMS tray fields */}
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">AMS tray cache</p>
              {Object.keys(rawAmsCache).length === 0 ? (
                <span className="text-[11px] font-mono text-gray-600">No AMS data in cache yet</span>
              ) : (
                <div className="space-y-1">
                  {Object.entries(rawAmsCache).sort(([a], [b]) => a.localeCompare(b)).map(([slot, td]) => (
                    <div key={slot} className="text-[11px] font-mono">
                      <span className="text-info">{slot}</span>
                      <span className="text-gray-600"> → </span>
                      {Object.entries(td as Record<string, unknown>).map(([k, v]) => (
                        <span key={k} className="text-gray-500 mr-3">
                          {k}: <span className="text-gray-300">{String(v)}</span>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
