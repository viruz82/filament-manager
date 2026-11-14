import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/ui/Feedback'
import { api } from '../../api'
import type { PrinterConfig, AMSTray, Spool } from '../../types'
import { RefreshCw, Sparkles } from 'lucide-react'
import { findBestSpoolMatch } from '../../utils/amsMatch'

// ── AMS Tray Panel ────────────────────────────────────────────────────────────

export function AMSTrayPanel({ printer }: { printer: PrinterConfig }) {
  const toast = useToast()
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [activeUnit, setActiveUnit] = useState(1)
  // Sort order of the spool dropdowns: by name (brand/material/colour) or by spool number
  const [spoolSort, setSpoolSort] = useState<'name' | 'number'>(() => {
    try { return localStorage.getItem('fm_ams_spool_sort') === 'number' ? 'number' : 'name' } catch { return 'name' }
  })
  const changeSpoolSort = (v: 'name' | 'number') => {
    setSpoolSort(v)
    try { localStorage.setItem('fm_ams_spool_sort', v) } catch { /* ignore */ }
  }

  const { data: trays, isLoading, refetch } = useQuery<AMSTray[]>({
    queryKey: ['printer-ams', printer.id],
    queryFn: () => api.getPrinterAMS(printer.id),
    refetchInterval: 30_000,
  })

  const { data: spools = [] } = useQuery<Spool[]>({
    queryKey: ['spools'],
    queryFn: () => api.getSpools(),
  })

  const assignMut = useMutation({
    mutationFn: ({ slot, spoolId }: { slot: string; spoolId: number | null }) =>
      api.assignAMSTray(printer.id, slot, spoolId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['printer-ams'] })  // all printers — spool may have moved
      qc.invalidateQueries({ queryKey: ['spools'] })
      if (result.previous_slot) {
        const parts = result.previous_slot.split(':')
        const [prevPrinter, prevSlot] = parts.length === 2 ? parts : ['', parts[0]]
        const slotLabel = prevSlot.replace(/ams(\d+)_tray(\d+)/, 'AMS $1 Tray $2')
        const location = prevPrinter ? `${prevPrinter} / ${slotLabel}` : slotLabel
        toast(`Spool was already assigned to ${location} — it has been moved here.`)
      }
    },
  })

  const [syncingSlot, setSyncingSlot] = useState<string | null>(null)

  const syncSlotMut = useMutation({
    mutationFn: (slotKey: string) => api.syncAMSTrayWeight(printer.id, slotKey),
    onMutate: (slotKey) => setSyncingSlot(slotKey),
    onSettled: () => setSyncingSlot(null),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['spools'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast(`Updated ${result.spool_name}: ${result.remaining_pct}% → ${result.new_weight_g} g`)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Sync failed — no valid HA data for this tray')
    },
  })

  const syncAllMut = useMutation({
    mutationFn: () => api.syncAMSWeights(printer.id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['spools'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      const n = result.updated.length
      toast(n > 0 ? `Synced ${n} Bambu Lab spool${n > 1 ? 's' : ''}` : 'No Bambu Lab spools to sync')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Sync all failed')
    },
  })

  const autoMatchAllMut = useMutation({
    mutationFn: async () => {
      const visibleTrays = (trays ?? []).filter(t => t.ams_id === visibleUnit)
      let matched = 0
      // seed with spools already assigned to other AMS units on this printer
      const assignedIds = new Set<number>(
        (trays ?? [])
          .filter(t => t.ams_id !== visibleUnit && t.spool?.id != null)
          .map(t => t.spool!.id)
      )
      for (const tray of visibleTrays) {
        const best = findBestSpoolMatch(tray, spools as Spool[], assignedIds)
        if (best && best.id !== tray.spool?.id) {
          await api.assignAMSTray(printer.id, tray.slot_key, best.id)
          matched++
        }
        if (best) assignedIds.add(best.id)
      }
      return matched
    },
    onSuccess: (matched) => {
      qc.invalidateQueries({ queryKey: ['printer-ams'] })
      qc.invalidateQueries({ queryKey: ['spools'] })
      toast(matched > 0
        ? `${t('settings.printers.autoMatchResult', { count: matched })}`
        : t('settings.printers.autoMatchNone'))
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Auto-match failed')
    },
  })

  if (isLoading) return <p className="text-xs text-gray-500 py-2">{t('settings.printers.loadingAMS')}</p>
  if (!trays?.length) return <p className="text-xs text-gray-500 py-2">{t('settings.printers.noAMSData')}</p>

  const units = Array.from(new Set(trays.map(t => t.ams_id))).sort()
  const visibleUnit = units.includes(activeUnit) ? activeUnit : units[0]

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-gray-400">{t('settings.printers.amsAssignment')}</p>
          {units.length > 1 && (
            <div className="flex rounded overflow-hidden border border-surface-3 text-xs">
              {units.map(u => (
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
        <div className="flex items-center gap-1 flex-wrap justify-end">
          <div className="flex items-center gap-1 text-xs text-gray-500 mr-1">
            <span>{t('settings.printers.sortBy')}</span>
            <div className="flex rounded overflow-hidden border border-surface-3">
              {(['name', 'number'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => changeSpoolSort(v)}
                  className={`px-2 py-0.5 transition-colors ${
                    spoolSort === v ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {v === 'name' ? t('settings.printers.sortName') : t('settings.printers.sortNumber')}
                </button>
              ))}
            </div>
          </div>
          <button
            className="btn-ghost px-2 py-0.5 text-xs flex items-center gap-1"
            onClick={() => autoMatchAllMut.mutate()}
            disabled={autoMatchAllMut.isPending}
            title={t('settings.printers.autoMatchAll')}
          >
            <Sparkles size={10} />
            {t('settings.printers.autoMatchAll')}
          </button>
          <button
            className="btn-ghost px-2 py-0.5 text-xs"
            onClick={() => syncAllMut.mutate()}
            disabled={syncAllMut.isPending}
            title="Sync remaining % for all Bambu Lab spools"
          >
            {syncAllMut.isPending ? <RefreshCw size={10} className="animate-spin" /> : t('settings.printers.syncAll')}
          </button>
          <button className="btn-ghost p-1" onClick={() => refetch()} title="Refresh display">
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {trays.filter(t => t.ams_id === visibleUnit).map(tray => {
          const otherAssigned = new Set<number>(
            trays
              .filter(t => t.slot_key !== tray.slot_key && t.spool?.id != null)
              .map(t => t.spool!.id)
          )
          return (
            <AMSTrayRow
              key={tray.slot_key}
              tray={tray}
              spools={spools}
              onAssign={(spoolId) => assignMut.mutate({ slot: tray.slot_key, spoolId })}
              saving={assignMut.isPending}
              onSyncWeight={() => syncSlotMut.mutate(tray.slot_key)}
              syncingWeight={syncingSlot === tray.slot_key}
              canSync={tray.ha_remaining != null && parseFloat(tray.ha_remaining) >= 0}
              excludeIds={otherAssigned}
              sortBy={spoolSort}
            />
          )
        })}
      </div>
    </div>
  )
}

function AMSTrayRow({
  tray,
  spools,
  onAssign,
  saving,
  onSyncWeight,
  syncingWeight,
  canSync,
  excludeIds,
  sortBy = 'name',
}: {
  tray: AMSTray
  spools: Spool[]
  onAssign: (spoolId: number | null) => void
  saving: boolean
  onSyncWeight: () => void
  syncingWeight: boolean
  canSync: boolean
  excludeIds?: Set<number>
  sortBy?: 'name' | 'number'
}) {
  const { t } = useTranslation()
  const selectedId = tray.spool?.id ?? null
  const [showInfo, setShowInfo] = useState(false)

  // Tray badge: AMS colour with the tray number, outer ring = remaining %
  const pct = tray.ha_remaining != null ? Math.max(0, Math.min(100, Math.round(parseFloat(tray.ha_remaining)))) : null
  const hex = tray.ha_color_hex ? tray.ha_color_hex.slice(0, 7) : null
  const lum = hex && /^#[0-9a-fA-F]{6}$/.test(hex)
    ? (0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16)) / 255
    : 0
  const info = `${tray.ha_material ?? '—'} · ${pct != null ? `${pct}%` : '—'}`

  return (
    <div className="flex items-center gap-2 bg-surface-3/40 rounded-lg px-2 sm:px-3 py-1.5 sm:py-2">
      <button
        type="button"
        onClick={() => setShowInfo(v => !v)}
        title={`T${tray.tray} · ${info}`}
        className="w-7 h-7 rounded-full shrink-0 grid place-items-center"
        style={{ background: pct != null ? `conic-gradient(#3b82f6 ${pct * 3.6}deg, rgba(255,255,255,0.12) 0)` : 'rgba(255,255,255,0.12)' }}
      >
        <span
          className="w-[22px] h-[22px] rounded-full grid place-items-center text-[11px] font-semibold border border-black/30"
          style={{ background: hex ?? '#2a2a2e', color: hex ? (lum > 0.6 ? '#111' : '#fff') : '#9ca3af' }}
        >
          {tray.tray}
        </span>
      </button>

      <span className={`text-xs text-gray-500 shrink-0 whitespace-nowrap ${showInfo ? 'inline' : 'hidden'} sm:inline sm:w-20`}>
        {info}
      </span>

      <select
        className="input text-xs flex-1 py-1 min-w-0"
        value={selectedId ?? ''}
        disabled={saving}
        onChange={e => onAssign(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{t('settings.printers.unassigned')}</option>
        {spools
          .filter(s => Math.round(s.remaining_pct) > 0)
          .sort((a, b) => {
            if (sortBy === 'number') {
              // Spools without a number go last
              if (a.custom_id != null && b.custom_id != null && a.custom_id !== b.custom_id) return a.custom_id - b.custom_id
              if ((a.custom_id == null) !== (b.custom_id == null)) return a.custom_id == null ? 1 : -1
            }
            const bc = a.brand.localeCompare(b.brand)
            if (bc !== 0) return bc
            const mc = a.material.localeCompare(b.material)
            if (mc !== 0) return mc
            return a.color_name.localeCompare(b.color_name)
          })
          .map(s => (
            <option key={s.id} value={s.id}>
              {s.custom_id != null ? `#${s.custom_id} ` : ''}{s.brand} {s.material}{s.subtype ? ` ${s.subtype}` : ''} · {s.color_name} ({Math.round(s.remaining_pct)}%)
            </option>
          ))}
      </select>

      {/* Auto-match button — only when printer reports material+color for this tray */}
      {tray.ha_material && tray.ha_color_hex && (() => {
        const match = findBestSpoolMatch(tray, spools, excludeIds)
        const alreadyOptimal = match != null && tray.spool?.id === match.id
        return (
          <button
            onClick={() => match && onAssign(match.id)}
            disabled={!match || saving}
            title={match
              ? `${t('settings.printers.autoMatchTray')}: ${match.custom_id != null ? `#${match.custom_id} ` : ''}${match.brand} ${match.material} · ${match.color_name} (${Math.round(match.remaining_pct)}%)`
              : t('settings.printers.autoMatchNone')}
            className={`btn-ghost p-1 shrink-0 ${
              alreadyOptimal ? 'text-ok cursor-default' :
              match ? 'text-warn hover:text-warn' :
              'text-gray-600 cursor-not-allowed'
            }`}
          >
            <Sparkles size={10} />
          </button>
        )
      })()}

      {tray.spool ? (
        <>
          <span
            className="hidden sm:block w-3 h-3 rounded-full border border-white/20 shrink-0"
            style={{ background: tray.spool.color_hex }}
            title={tray.spool.color_name}
          />
          {canSync ? (
            <button
              className="btn-ghost p-1 shrink-0 text-gray-400 hover:text-white"
              onClick={onSyncWeight}
              disabled={syncingWeight}
              title="Sync weight from AMS"
            >
              <RefreshCw size={10} className={syncingWeight ? 'animate-spin' : ''} />
            </button>
          ) : (
            <span className="w-6 h-6 shrink-0" />
          )}
        </>
      ) : (
        <span className="hidden sm:block w-3 h-3 shrink-0" />
      )}
    </div>
  )
}
