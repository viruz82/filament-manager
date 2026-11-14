import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import type { PrintJob, Spool, AMSTray, PrinterConfig, Project } from '../../types'
import { Pencil, X, Download, FolderOpen } from 'lucide-react'
import { useHATZ } from '../../hooks/useHATZ'
import { useAmsSlotLabel } from '../../hooks/useAmsSlots'
import { fmtNum } from '../../utils/number'
import { nowInTZ, utcToLocalInput, localInputToUTC } from '../../utils/time'

// ── Print Form ────────────────────────────────────────────────────────────────

interface UsageRow { spool_id: number; grams_used: number; ams_slot: string }

export function PrintForm({
  initial,
  spools,
  onSave,
  onCancel,
}: {
  initial?: PrintJob
  spools: Spool[]
  onSave: (data: unknown) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const tz = useHATZ()
  const now = nowInTZ(tz)
  const [name, setName] = useState(initial?.name ?? '')
  const [modelName, setModelName] = useState(initial?.model_name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [startedAt, setStartedAt] = useState(
    initial?.started_at ? utcToLocalInput(initial.started_at, tz) : now
  )
  const [finishedAt, setFinishedAt] = useState(
    initial?.finished_at ? utcToLocalInput(initial.finished_at, tz) : ''
  )
  const [durationH, setDurationH] = useState(
    initial?.duration_hours?.toString() ?? ''
  )
  const [success, setSuccess] = useState(initial?.success ?? true)
  const [printerId, setPrinterId] = useState<number | ''>('')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [energyKwh, setEnergyKwh] = useState(initial?.energy_kwh?.toString() ?? '')
  const [energyCost, setEnergyCost] = useState(initial?.energy_cost?.toString() ?? '')
  const [usages, setUsages] = useState<UsageRow[]>(() => {
    // Confirmed usages take priority
    if (initial?.usages && initial.usages.length > 0) {
      return initial.usages.map(u => ({
        spool_id: u.spool_id,
        grams_used: u.grams_used,
        ams_slot: u.ams_slot ?? '',
      }))
    }
    // Unconfirmed auto print: pre-populate from the cloud snapshot so the edit
    // form shows the print-time spool, not whatever is in the slot right now.
    if (initial?.suggested_usages && initial.suggested_usages.length > 0) {
      return initial.suggested_usages
        .filter(s => s.spool_id != null)
        .map(s => ({ spool_id: s.spool_id!, grams_used: s.grams, ams_slot: s.ams_slot }))
    }
    return []
  })
  const [loadingAMS, setLoadingAMS] = useState(false)
  const [showEmptySpools, setShowEmptySpools] = useState(false)
  const [deductWeight, setDeductWeight] = useState(true)
  // For existing jobs usages start read-only; new jobs go straight to edit mode
  const [usageEditMode, setUsageEditMode] = useState(!initial)
  const [fmProjectId, setFmProjectId] = useState<number | ''>(initial?.fm_project_id ?? '')

  const { data: printers = [] } = useQuery<PrinterConfig[]>({
    queryKey: ['printers'],
    queryFn: api.getPrinters,
  })

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: api.getProjects,
  })

  useEffect(() => {
    if (initial?.printer_name && printers.length > 0) {
      const match = printers.find(p => p.name === initial.printer_name)
      if (match) setPrinterId(match.id)
    }
  }, [printers, initial?.printer_name])

  const selectedPrinter = printers.find(p => p.id === printerId) ?? null
  const slotLabel = useAmsSlotLabel()

  // Selectable AMS slots of the print's printer: live trays, else ams_unit_count × 4.
  // Stored value stays the bare key (ams<unit>_tray<n>); unknown old values stay selectable.
  const { data: printerTrays = [] } = useQuery<AMSTray[]>({
    queryKey: ['printer-ams', selectedPrinter?.id],
    queryFn: () => api.getPrinterAMS(selectedPrinter!.id),
    enabled: !!selectedPrinter && usageEditMode,
    staleTime: 30_000,
    retry: false,
  })
  const slotKeys: string[] = printerTrays.length
    ? printerTrays.map(tr => tr.slot_key)
    : Array.from({ length: Math.max(1, selectedPrinter?.ams_unit_count || 1) }, (_, u) =>
        [1, 2, 3, 4].map(n => `ams${u + 1}_tray${n}`)).flat()
  const slotOptionsFor = (current: string) =>
    current && !slotKeys.includes(current) ? [...slotKeys, current] : slotKeys

  // Spools visible in dropdowns: non-empty always shown; empty only when checkbox is on.
  // Always include spools already selected in a usage row so existing rows don't go blank.
  const selectedSpoolIds = new Set(usages.map(u => u.spool_id))
  const visibleSpools = spools.filter(
    s => showEmptySpools || Math.round(s.remaining_pct) > 0 || selectedSpoolIds.has(s.id)
  )

  // Auto-load AMS on first open when printer is known and no usages are set yet.
  // Only for new prints — never overwrite stored usages on an existing job.
  useEffect(() => {
    if (initial) return             // editing existing job — never auto-load
    if (!printerId) return
    if (usages.length > 0) return  // already has data — don't overwrite
    const printer = printers.find(p => p.id === printerId)
    if (!printer) return
    setLoadingAMS(true)
    api.getPrinterAMS(printer.id).then(trays => {
      const rows: UsageRow[] = trays
        .filter(t => t.spool !== null)
        .map(t => ({ spool_id: t.spool!.id, grams_used: 0, ams_slot: t.slot_key }))
      if (rows.length > 0) setUsages(rows)
    }).finally(() => setLoadingAMS(false))
  }, [printerId])

  const loadFromAMS = async () => {
    if (!selectedPrinter) return
    setLoadingAMS(true)
    try {
      const trays = await api.getPrinterAMS(selectedPrinter.id)
      const rows: UsageRow[] = trays
        .filter(t => t.spool !== null)
        .map(t => ({ spool_id: t.spool!.id, grams_used: 0, ams_slot: t.slot_key }))
      setUsages(rows)
    } finally {
      setLoadingAMS(false)
    }
  }

  const addUsage = () => {
    const first = visibleSpools[0]
    if (first) setUsages(u => [...u, { spool_id: first.id, grams_used: 0, ams_slot: '' }])
  }
  const removeUsage = (i: number) => setUsages(u => u.filter((_, idx) => idx !== i))
  const updateUsage = (i: number, k: keyof UsageRow, v: string | number) =>
    setUsages(u => u.map((row, idx) => idx === i ? { ...row, [k]: v } : row))

  const handleSave = () => {
    const payload: Record<string, unknown> = {
      name,
      model_name: modelName || null,
      description: description || null,
      url: url || null,
      started_at: localInputToUTC(startedAt, tz),
      finished_at: finishedAt ? localInputToUTC(finishedAt, tz) : null,
      duration_seconds: durationH ? Math.round(parseFloat(durationH) * 3600) : null,
      success,
      notes: notes || null,
      printer_name: selectedPrinter?.name ?? null,
      fm_project_id: fmProjectId || null,
      energy_kwh: energyKwh ? parseFloat(energyKwh) : null,
      energy_cost: energyCost ? parseFloat(energyCost) : null,
    }
    // Only send usages when the user explicitly entered edit mode — otherwise the
    // backend would revert and re-apply existing usages unchanged, creating noisy
    // audit pairs (print_delete + print_manual) with zero net weight change.
    if (usageEditMode) {
      payload.usages = usages.map(u => ({
        spool_id: Number(u.spool_id),
        grams_used: Number(u.grams_used),
        ams_slot: u.ams_slot || null,
      }))
      payload.deduct_weight = deductWeight
    }
    onSave(payload)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-2 border border-surface-3 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-3">
          <h2 className="font-semibold">{initial ? t('prints.editPrint') : t('prints.logPrint')}</h2>
          <button onClick={onCancel} className="btn-ghost p-1"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">{t('prints.form.printName')} *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)}
              placeholder={t('prints.form.namePlaceholder')} />
          </div>
          <div>
            <label className="label">{t('prints.form.description')}</label>
            <input className="input" value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="label">{t('prints.form.url')}</label>
            <input className="input" type="url" value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://makerworld.com/…" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('prints.form.startedAt')} *</label>
              <input className="input" type="datetime-local" value={startedAt} onChange={e => setStartedAt(e.target.value)} />
            </div>
            <div>
              <label className="label">{t('prints.form.finishedAt')}</label>
              <input
                className={`input ${initial?.finished_at ? 'opacity-60' : ''}`}
                type="datetime-local"
                value={finishedAt}
                onChange={e => setFinishedAt(e.target.value)}
                readOnly={!!initial?.finished_at}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('prints.form.duration')}</label>
              <input className="input" type="number" step="0.1" min="0" value={durationH}
                onChange={e => setDurationH(e.target.value)} placeholder="2.5" />
            </div>
            <div>
              <label className="label">{t('prints.form.printer')}</label>
              {initial ? (
                <p className="input opacity-60 cursor-default select-none">
                  {initial.printer_name ?? t('common.none')}
                </p>
              ) : (
                <select
                  className="input"
                  value={printerId}
                  onChange={e => setPrinterId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">{t('common.none')}</option>
                  {printers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {projects.length > 0 && (
            <div>
              <label className="label flex items-center gap-1"><FolderOpen size={12} /> {t('prints.form.project')}</label>
              <select
                className="input"
                value={fmProjectId}
                onChange={e => setFmProjectId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">{t('common.none')}</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={success} onChange={e => setSuccess(e.target.checked)} />
              {t('prints.form.printSucceeded')}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={deductWeight} onChange={e => setDeductWeight(e.target.checked)} />
              {t('prints.form.deductFromSpool')}
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('prints.form.energyKwh')}</label>
              <input className="input" type="number" step="0.01" min="0" value={energyKwh}
                onChange={e => setEnergyKwh(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="label">{t('prints.form.energyCost')}</label>
              <input className="input" type="number" step="0.01" min="0" value={energyCost}
                onChange={e => setEnergyCost(e.target.value)} placeholder="0.00" />
            </div>
          </div>

          {/* Filament usages */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">{t('prints.form.filamentUsed')}</label>
              <div className="flex items-center gap-2">
                {usageEditMode ? (
                  <>
                    <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showEmptySpools}
                        onChange={e => setShowEmptySpools(e.target.checked)}
                        className="accent-blue-500"
                      />
                      {t('prints.form.showEmptySpools')}
                    </label>
                    <button
                      className="btn-ghost text-xs py-0.5 flex items-center gap-1 disabled:opacity-40"
                      onClick={loadFromAMS}
                      disabled={!selectedPrinter || loadingAMS}
                      title={selectedPrinter ? `Load current AMS tray assignments from ${selectedPrinter.name}` : t('prints.form.selectPrinterFirst')}
                    >
                      <Download size={11} />
                      {loadingAMS ? t('prints.form.loading') : t('prints.form.loadFromAMS')}
                    </button>
                    <button className="btn-ghost text-xs py-0.5" onClick={addUsage}>{t('prints.form.addSpool')}</button>
                  </>
                ) : (
                  <button
                    className="btn-ghost text-xs py-0.5 flex items-center gap-1"
                    onClick={() => setUsageEditMode(true)}
                  >
                    <Pencil size={11} />
                    {t('prints.form.editUsages')}
                  </button>
                )}
              </div>
            </div>

            {/* Read-only usage display */}
            {!usageEditMode && (
              usages.length === 0 ? (
                <p className="text-xs text-gray-500">{t('prints.form.noUsagesRecorded')}</p>
              ) : (
                usages.map((u, i) => {
                  const spool = spools.find(s => s.id === u.spool_id)
                  return (
                    <div key={i} className="flex items-center gap-2 py-1 text-xs text-gray-400">
                      {spool && (
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: spool.color_hex }}
                        />
                      )}
                      <span className="flex-1">
                        {spool
                          ? `${spool.brand} ${spool.material}${spool.subtype ? ` ${spool.subtype}` : ''} — ${spool.color_name}`
                          : `Spool #${u.spool_id}`}
                      </span>
                      <span className="text-gray-300">{fmtNum(u.grams_used, 1)}g</span>
                      {u.ams_slot && <span className="text-info">{slotLabel(u.ams_slot)}</span>}
                    </div>
                  )
                })
              )
            )}

            {/* Editable usage rows */}
            {usageEditMode && (
              <>
                {usages.length === 0 && (
                  <p className="text-xs text-gray-500">
                    {selectedPrinter ? t('prints.form.loadAMSHint') : t('prints.form.noAMSPrinter')}
                  </p>
                )}
                {usages.map((u, i) => (
                  <div key={i} className="flex items-center gap-2 mb-2">
                    <select
                      className="input flex-1 text-xs py-1"
                      value={u.spool_id}
                      onChange={e => updateUsage(i, 'spool_id', e.target.value)}
                    >
                      {visibleSpools.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.brand} {s.material}{s.subtype ? ` ${s.subtype}` : ''} — {s.color_name} ({Math.round(s.remaining_pct)}%)
                        </option>
                      ))}
                    </select>
                    <input
                      className="input w-20 text-xs py-1"
                      type="number" step="0.1" min="0"
                      value={u.grams_used || ''}
                      onChange={e => updateUsage(i, 'grams_used', parseFloat(e.target.value) || 0)}
                      placeholder="g"
                    />
                    <span className="text-xs text-gray-500">g</span>
                    <select
                      className="input w-28 text-xs py-1"
                      value={u.ams_slot}
                      onChange={e => updateUsage(i, 'ams_slot', e.target.value)}
                    >
                      <option value="">{t('spools.amsNone')}</option>
                      {slotOptionsFor(u.ams_slot).map(k => (
                        <option key={k} value={k}>{slotLabel(k)}</option>
                      ))}
                    </select>
                    <button onClick={() => removeUsage(i)} className="text-crit hover:text-crit"><X size={14} /></button>
                  </div>
                ))}
              </>
            )}
          </div>

          <div>
            <label className="label">{t('prints.form.notes')}</label>
            <textarea className="input h-16 resize-none" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-3">
          <button className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn-primary" onClick={handleSave} disabled={!name || !startedAt}>{t('common.save')}</button>
        </div>
      </div>
    </div>
  )
}
