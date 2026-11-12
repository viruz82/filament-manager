import { useQuery, useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import type { AMSTray, PrinterConfig, Spool } from '../types'

// AMS slot values are stored on the spool as "<printer name>:ams<unit>_tray<n>"
// (legacy data may hold the bare "ams<unit>_tray<n>").

export interface AmsSlotOption {
  value: string        // full key, as stored in spool.ams_slot
  label: string        // e.g. "A1 · Tray 1"
}

const SLOT_RE = /^(?:(.*):)?ams(\d+)_tray(\d+)$/

function shortPrinterName(name: string): string {
  return name.replace(/^Bambu Lab\s+/i, '') || name
}

/** Human-readable label for a stored slot value. */
export function useAmsSlotLabel() {
  const { t } = useTranslation()
  return (slot: string | null | undefined): string => {
    if (!slot) return '—'
    const m = SLOT_RE.exec(slot)
    if (!m) return slot
    const [, printer, unit, tray] = m
    const parts: string[] = []
    if (printer) parts.push(shortPrinterName(printer))
    if (unit !== '1') parts.push(`AMS ${unit}`)
    parts.push(t('spools.amsTray', { tray }))
    return parts.join(' · ')
  }
}

/**
 * All selectable AMS slots of the active cloud printers. Uses the live tray
 * list when available; when the printer is offline (no MQTT data) it falls
 * back to ams_unit_count × 4 trays so slots stay assignable.
 */
export function useAmsSlots(): AmsSlotOption[] {
  const label = useAmsSlotLabel()
  const { data: printers = [] } = useQuery<PrinterConfig[]>({
    queryKey: ['printers'],
    queryFn: api.getPrinters,
  })
  const amsPrinters = printers.filter(p => p.is_active && !!p.bambu_serial)
  const trayResults = useQueries({
    queries: amsPrinters.map(p => ({
      queryKey: ['printer-ams', p.id],
      queryFn: () => api.getPrinterAMS(p.id),
      staleTime: 30_000,
      retry: false,
    })),
  })

  const options: AmsSlotOption[] = []
  amsPrinters.forEach((p, i) => {
    const trays = (trayResults[i]?.data ?? []) as AMSTray[]
    const keys = trays.length
      ? trays.map(tr => tr.slot_key)
      : Array.from({ length: Math.max(1, p.ams_unit_count || 1) }, (_, u) =>
          [1, 2, 3, 4].map(n => `ams${u + 1}_tray${n}`)).flat()
    for (const k of keys) {
      const value = `${p.name}:${k}`
      options.push({ value, label: label(value) })
    }
  })
  return options
}

export function spoolShortName(s: Spool): string {
  return `${s.custom_id != null ? `#${s.custom_id} ` : ''}${s.brand} ${s.material} · ${s.color_name}`
}

/**
 * Dropdown for a spool's AMS slot. Slots held by another spool show that
 * spool; choosing one moves the slot (the backend frees it on the other spool).
 */
export function AmsSlotSelect({
  spoolId,
  value,
  onChange,
  spools,
  disabled,
  className,
}: {
  spoolId?: number
  value: string | null
  onChange: (slot: string | null) => void
  spools: Spool[]
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const options = useAmsSlots()
  const label = useAmsSlotLabel()

  const holderOf = (slot: string) => {
    const bare = slot.includes(':') ? slot.split(':').slice(1).join(':') : slot
    return spools.find(s => s.id !== spoolId && (s.ams_slot === slot || s.ams_slot === bare))
  }

  // Keep an unknown stored value (legacy bare key, renamed printer) selectable
  const all = value && !options.some(o => o.value === value)
    ? [...options, { value, label: label(value) }]
    : options

  return (
    <select
      className={className ?? 'input'}
      value={value ?? ''}
      disabled={disabled}
      onChange={e => onChange(e.target.value || null)}
      onClick={e => e.stopPropagation()}
    >
      <option value="">{t('spools.amsNone')}</option>
      {all.map(o => {
        const holder = holderOf(o.value)
        return (
          <option key={o.value} value={o.value}>
            {o.label}{holder ? ` – ${t('spools.amsOccupied', { name: spoolShortName(holder) })}` : ''}
          </option>
        )
      })}
    </select>
  )
}
