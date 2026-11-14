import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import type { PrinterConfig, BambuCloudStatus, BambuCloudDevice } from '../../types'
import { X, AlertCircle } from 'lucide-react'
import { useCurrencySymbol } from '../../hooks/useHATZ'
import { parseDecimal } from '../../utils/number'

// ── Cloud Printer Form ────────────────────────────────────────────────────────

function CloudPrinterFormContent({
  initial,
  onSave,
  onCancel,
  cloudStatus,
  existingPrinters,
}: {
  initial?: PrinterConfig
  onSave: (data: Record<string, unknown>) => void
  onCancel: () => void
  cloudStatus: BambuCloudStatus | undefined
  existingPrinters: PrinterConfig[]
}) {
  const { t } = useTranslation()
  const currencySymbol = useCurrencySymbol()
  const [selectedSerial, setSelectedSerial] = useState(initial?.bambu_serial ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)
  const [autoDeduct, setAutoDeduct] = useState(initial?.auto_deduct ?? false)
  const [energySensorEntityId, setEnergySensorEntityId] = useState(initial?.energy_sensor_entity_id ?? '')
  const [priceSensorEntityId, setPriceSensorEntityId] = useState(initial?.price_sensor_entity_id ?? '')
  const [wearCostPerHour, setWearCostPerHour] = useState(
    initial?.wear_cost_per_hour != null ? String(initial.wear_cost_per_hour).replace('.', ',') : ''
  )
  const [energySensorPreview, setEnergySensorPreview] = useState<number | null | undefined>(undefined)
  const [priceSensorPreview, setPriceSensorPreview] = useState<number | null | undefined>(undefined)
  const [activeAmsUnit, setActiveAmsUnit] = useState(1)
  const { data: energyEntities = [] } = useQuery({ queryKey: ['ha-entities', 'energy'], queryFn: () => api.getHAEntities('energy'), staleTime: 60_000, retry: false })
  const { data: priceEntities = [] } = useQuery({ queryKey: ['ha-entities', 'price'], queryFn: () => api.getHAEntities('price'), staleTime: 60_000, retry: false })

  const fetchSensorPreview = async (entityId: string, setter: (v: number | null | undefined) => void) => {
    if (!entityId.trim()) { setter(undefined); return }
    setter(undefined) // reset to loading
    try {
      const res = await api.getHASensorValue(entityId.trim())
      setter(res.value)
    } catch {
      setter(null)
    }
  }

  const isConnected = cloudStatus?.status === 'connected'

  // Serials already configured as cloud printers (excluding the one being edited)
  const configuredSerials = new Set(
    existingPrinters
      .filter(p => p.bambu_source === 'cloud' && p.bambu_serial && p.id !== initial?.id)
      .map(p => p.bambu_serial!)
  )

  const { data: devices = [] } = useQuery<BambuCloudDevice[]>({
    queryKey: ['bambu-cloud-devices'],
    queryFn: api.getBambuCloudDevices,
    enabled: isConnected,
  })

  // Devices not yet configured as a cloud printer
  const availableDevices = (devices as BambuCloudDevice[]).filter(d => !configuredSerials.has(d.serial))

  const { data: liveStatus } = useQuery({
    queryKey: ['cloud-status', selectedSerial],
    queryFn: () => api.getBambuCloudPrinterStatus(selectedSerial),
    enabled: !!selectedSerial,
    refetchInterval: 10_000,
  })

  const { data: amsTrays } = useQuery({
    queryKey: ['cloud-ams', selectedSerial],
    queryFn: () => api.getBambuCloudPrinterAMS(selectedSerial),
    enabled: !!selectedSerial,
    refetchInterval: 10_000,
  })

  const handleSelectDevice = (serial: string, deviceName: string) => {
    setSelectedSerial(serial)
    if (!initial && !name) setName(deviceName)
  }

  // Detect AMS units from tray slot_keys
  const amsUnits = amsTrays
    ? Array.from(new Set(amsTrays.map(tr => {
        const m = tr.slot_key.match(/^ams(\d+)_/)
        return m ? parseInt(m[1]) : 1
      }))).sort()
    : []
  const visibleAmsUnit = amsUnits.includes(activeAmsUnit) ? activeAmsUnit : (amsUnits[0] ?? 1)

  const STATUS_LABELS: Record<string, string> = {
    print_stage: t('settings.bambuCloud.statusStage'), print_progress: t('settings.bambuCloud.statusProgress'),
    remaining_time: t('settings.bambuCloud.statusRemaining'), nozzle_temp: t('settings.bambuCloud.statusNozzle'),
    bed_temp: t('settings.bambuCloud.statusBed'), current_file: t('settings.bambuCloud.statusFile'),
  }
  const STATUS_UNITS: Record<string, string> = {
    nozzle_temp: '°C', bed_temp: '°C', print_progress: '%', remaining_time: ' min',
  }

  const statusEntries = liveStatus
    ? Object.entries(liveStatus as Record<string, string | null>).filter(([, v]) => v != null && v !== '')
    : []

  const canSave = isConnected && !!selectedSerial && !!name.trim()

  return (
    <>
      <div className="p-5 space-y-4">
        {!isConnected ? (
          <div className="flex items-start gap-2 text-xs text-warn bg-warn/15 border border-warn/40 rounded px-3 py-3">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{t('settings.bambuCloud.notConnectedHint')}</span>
          </div>
        ) : (
          <>
            {/* Device picker — dropdown for new printers; locked serial for edit */}
            {!initial ? (
              <div>
                <label className="label">{t('settings.bambuCloud.selectDevice')}</label>
                {availableDevices.length === 0 && devices.length > 0 ? (
                  <p className="text-xs text-gray-500">All cloud printers are already configured.</p>
                ) : availableDevices.length === 0 ? (
                  <p className="text-xs text-gray-500">{t('settings.bambuCloud.noDevices')}</p>
                ) : (
                  <select
                    className="input w-full"
                    value={selectedSerial}
                    onChange={e => {
                      const serial = e.target.value
                      const device = availableDevices.find(d => d.serial === serial)
                      if (device) handleSelectDevice(serial, device.name)
                      else setSelectedSerial('')
                    }}
                  >
                    <option value="">{t('settings.bambuCloud.selectDevice')}…</option>
                    {availableDevices.map(d => (
                      <option key={d.serial} value={d.serial}>
                        {d.name}  {d.model}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs bg-surface-3/40 rounded-lg px-3 py-2">
                <span className="text-gray-400">{t('settings.bambuCloud.serial')}:</span>
                <span className="font-mono text-gray-300">{'•'.repeat(8)}{initial.bambu_serial?.slice(-4)}</span>
                <span className="text-gray-600 text-[10px] ml-1">(locked)</span>
              </div>
            )}

            <div>
              <label className="label">{t('settings.printers.name')} *</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="My Printer" />
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
              {t('settings.printers.monitorPrinter')}
            </label>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={autoDeduct} onChange={e => setAutoDeduct(e.target.checked)} />
              <span>{t('settings.printers.autoDeduct')}</span>
              <span className="text-[10px] text-warn border border-warn/40 rounded px-1 py-0.5 leading-none">{t('common.experimental')}</span>
            </label>

            <div className="border-t border-surface-3 pt-3 space-y-3">
              <p className="text-xs font-medium text-gray-400">{t('settings.printers.energyTracking')}</p>
              <div>
                <label className="label">{t('settings.printers.energySensor')}</label>
                <input
                  className="input"
                  value={energySensorEntityId}
                  onChange={e => { setEnergySensorEntityId(e.target.value); setEnergySensorPreview(undefined) }}
                  onBlur={() => fetchSensorPreview(energySensorEntityId, setEnergySensorPreview)}
                  placeholder="sensor.shelly_energy_total"
                  list="fm-energy-entities"
                  autoComplete="off"
                />
                <datalist id="fm-energy-entities">
                  {energyEntities.map(e => <option key={e.entity_id} value={e.entity_id}>{e.name} · {e.value} {e.unit}</option>)}
                </datalist>
                {energySensorEntityId && energySensorPreview !== undefined && (
                  <p className={`text-[11px] mt-1 font-mono ${energySensorPreview === null ? 'text-crit' : 'text-ok'}`}>
                    {energySensorPreview === null ? '✗ entity not found or not numeric' : `✓ ${energySensorPreview} kWh`}
                  </p>
                )}
                <p className="text-[11px] text-gray-500 mt-1">{t('settings.printers.energySensorHint')}</p>
                {energyEntities.length > 0 && (
                  <p className="text-[11px] text-gray-500">{t('settings.printers.sensorSuggestions', { count: energyEntities.length })}</p>
                )}
              </div>
              <div>
                <label className="label">{t('settings.printers.priceSensor')}</label>
                <input
                  className="input"
                  value={priceSensorEntityId}
                  onChange={e => { setPriceSensorEntityId(e.target.value); setPriceSensorPreview(undefined) }}
                  onBlur={() => fetchSensorPreview(priceSensorEntityId, setPriceSensorPreview)}
                  placeholder="input_number.electricity_price"
                  list="fm-price-entities"
                  autoComplete="off"
                />
                <datalist id="fm-price-entities">
                  {priceEntities.map(e => <option key={e.entity_id} value={e.entity_id}>{e.name} · {e.value} {e.unit}</option>)}
                </datalist>
                {priceSensorEntityId && priceSensorPreview !== undefined && (
                  <p className={`text-[11px] mt-1 font-mono ${priceSensorPreview === null ? 'text-crit' : 'text-ok'}`}>
                    {priceSensorPreview === null ? '✗ entity not found or not numeric' : `✓ ${priceSensorPreview} ${currencySymbol}/kWh`}
                  </p>
                )}
                <p className="text-[11px] text-gray-500 mt-1">{t('settings.printers.priceSensorHint')}</p>
                {priceEntities.length > 0 && (
                  <p className="text-[11px] text-gray-500">{t('settings.printers.sensorSuggestions', { count: priceEntities.length })}</p>
                )}
              </div>
              <div>
                <label className="label">{t('settings.printers.wearCost')}</label>
                <div className="flex items-center gap-2">
                  <input
                    className="input"
                    type="text"
                    inputMode="decimal"
                    value={wearCostPerHour}
                    onChange={e => setWearCostPerHour(e.target.value)}
                    placeholder="0,20"
                  />
                  <span className="text-xs text-gray-500 shrink-0">{currencySymbol}/h</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">{t('settings.printers.wearCostHint')}</p>
              </div>
            </div>

            {/* Live preview when a device is selected */}
            {selectedSerial && (
              <div className="bg-surface-3/40 rounded-xl p-3 space-y-3">
                {statusEntries.length > 0 ? (
                  <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs text-gray-400">
                    {statusEntries.map(([key, val]) => (
                      <span key={key}>{STATUS_LABELS[key] ?? key}: <span className="text-white">{val}{STATUS_UNITS[key] ?? ''}</span></span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">{t('settings.bambuCloud.noStatusData')}</p>
                )}

                {amsTrays && amsTrays.length > 0 && (
                  <div className="border-t border-surface-3 pt-2">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-xs font-medium text-gray-400">{t('settings.printers.amsAssignment')}</p>
                      {amsUnits.length > 1 && (
                        <div className="flex rounded overflow-hidden border border-surface-3 text-xs">
                          {amsUnits.map(u => (
                            <button
                              key={u}
                              onClick={() => setActiveAmsUnit(u)}
                              className={`px-2.5 py-0.5 transition-colors ${
                                visibleAmsUnit === u ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-200'
                              }`}
                            >
                              AMS {u}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      {amsTrays
                        .filter(tr => {
                          const m = tr.slot_key.match(/^ams(\d+)_/)
                          return m ? parseInt(m[1]) === visibleAmsUnit : true
                        })
                        .map(tr => (
                          <div key={tr.slot_key} className="flex items-center gap-2 bg-surface-3/40 rounded px-2 py-1 text-xs">
                            <span className="font-mono text-gray-400 w-20 shrink-0">{tr.slot_key}</span>
                            {tr.ha_color_hex ? (
                              <span className="w-3 h-3 rounded-full border border-white/20 shrink-0" style={{ background: tr.ha_color_hex }} />
                            ) : (
                              <span className="w-3 h-3 rounded-full bg-surface-3 border border-white/10 shrink-0" />
                            )}
                            <span className="text-gray-300 flex-1">{tr.ha_material ?? '—'}</span>
                            <span className="text-gray-400">{tr.ha_remaining != null ? `${tr.ha_remaining}%` : '—'}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-3">
        <button className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button
          className="btn-primary"
          onClick={() => onSave({
            name: name.trim(),
            bambu_serial: selectedSerial,
            bambu_source: 'cloud',
            is_active: isActive,
            auto_deduct: autoDeduct,
            energy_sensor_entity_id: energySensorEntityId.trim() || null,
            price_sensor_entity_id: priceSensorEntityId.trim() || null,
            wear_cost_per_hour: parseDecimal(wearCostPerHour),
          })}
          disabled={!canSave}
        >
          {t('common.save')}
        </button>
      </div>
    </>
  )
}

// ── Printer Form Modal ────────────────────────────────────────────────────────

export function PrinterFormModal({
  initial,
  onSave,
  onCancel,
  cloudStatus,
  existingPrinters,
}: {
  initial?: PrinterConfig
  onSave: (data: Record<string, unknown>) => void
  onCancel: () => void
  cloudStatus: BambuCloudStatus | undefined
  existingPrinters: PrinterConfig[]
}) {
  const { t } = useTranslation()
  const title = initial ? t('settings.printers.editPrinter') : t('settings.printers.addPrinter')

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-2 border border-surface-3 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onCancel} className="btn-ghost p-1"><X size={16} /></button>
        </div>
        <CloudPrinterFormContent initial={initial} onSave={onSave} onCancel={onCancel} cloudStatus={cloudStatus} existingPrinters={existingPrinters} />
      </div>
    </div>
  )
}
