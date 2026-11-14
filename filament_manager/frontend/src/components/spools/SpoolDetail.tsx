// Detail of the selected spool: all fields plus every action.
// Laptop: column next to the list / tiles. Phone & tablet: sheet from the bottom.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Droplet, Flame, Scale, Pencil, QrCode, History, Archive, ArchiveRestore, Copy, Trash2, Cloud, Recycle, ChevronDown, ChevronUp } from 'lucide-react'
import Ring from '../ui/Ring'
import { AmsSlotSelect, useAmsSlotLabel } from '../../hooks/useAmsSlots'
import { useCurrencyFormatter } from '../../hooks/useHATZ'
import { formatDateOnly } from '../../utils/time'
import { fmtNum } from '../../utils/number'
import type { Spool } from '../../types'
import { PillList } from './SpoolViews'
import { spoolTitle } from './spoolFilters'

export interface DetailActions {
  edit: (s: Spool) => void
  weigh: (s: Spool) => void
  moisture: (s: Spool) => void
  label: (s: Spool) => void
  history: (s: Spool) => void
  duplicate: (s: Spool) => void
  remove: (s: Spool) => void
  archive: (s: Spool) => void
  unarchive: (s: Spool) => void
  assignSlot: (s: Spool, slot: string | null) => void
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-gray-400">{k}</dt>
      <dd className="text-right text-gray-100 tabular-nums min-w-0 break-words">{children}</dd>
    </>
  )
}

function DetailBody({ spool, spools, lowPct, actions, onClose, sheet }: {
  spool: Spool; spools: Spool[]; lowPct: number; actions: DetailActions; onClose: () => void; sheet: boolean
}) {
  const { t } = useTranslation()
  const fmtCurrency = useCurrencyFormatter()
  const slotLabel = useAmsSlotLabel()
  const [more, setMore] = useState(false)
  const pct = spool.remaining_pct
  const m = spool.moisture
  const dash = <span className="text-gray-500">—</span>
  const moistText = spool.archived || m.pct == null ? dash : `${Math.round(m.pct)} % · ${t(`moisture.level.${m.level}`)}`
  const storageText = m.storage === 'ams' ? t('moisture.storage.ams') : m.storage === 'unknown' ? dash : t(`moisture.storage.${m.storage}`)
  const subtypes = [spool.subtype, spool.subtype2].filter(Boolean).join(' · ')

  const btn = 'btn bg-surface-3 hover:bg-surface-4 flex items-center justify-center gap-1.5 text-sm'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Ring spool={spool} pct={pct} size={52} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-white leading-snug break-words">{spoolTitle(spool)}</h3>
          <p className="text-xs text-gray-400 break-words">{spool.color_name}{spool.ams_slot ? ` · ${slotLabel(spool.ams_slot)}` : ''}</p>
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            <PillList spool={spool} lowPct={lowPct} max={4} />
            {spool.bambu_spool_id && <span className="pill pill-info" title={t('spools.bambuLinked')}><Cloud size={10} />{t('spools.bambuLinked')}</span>}
            {spool.is_refill_pack && <span className="pill pill-extra" title={t('spools.refillBadge')}><Recycle size={10} />{t('spools.refillBadge')}</span>}
          </div>
        </div>
        <button
          className="p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-surface-3 shrink-0"
          onClick={onClose}
          aria-label={t('common.close')}
        ><X size={18} /></button>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <span><span className="text-2xl font-bold text-white tabular-nums">{fmtNum(spool.current_weight_g, 0)} g</span> <span className="text-xs text-gray-400">{t('spools.remaining')}</span></span>
          <span className="text-sm text-gray-300 tabular-nums">{fmtNum(pct, Number.isInteger(pct) ? 0 : 1)} %</span>
        </div>
        <div className="h-2 rounded-full bg-surface-3 overflow-hidden mt-1.5">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: pct < lowPct ? 'rgb(var(--fm-crit))' : 'rgb(var(--fm-accent))' }} />
        </div>
      </div>

      {!spool.archived && (
        <label className="flex items-center gap-2 text-xs">
          <span className="text-gray-400 shrink-0">{t('spools.table.amsSlot')}</span>
          <AmsSlotSelect
            spoolId={spool.id}
            value={spool.ams_slot}
            onChange={slot => actions.assignSlot(spool, slot)}
            spools={spools}
            className={`input text-xs !py-1.5 flex-1 min-w-0 ${spool.ams_slot ? 'text-info' : 'text-gray-400'}`}
          />
        </label>
      )}

      {/* Actions: the one-tap handgrips first, rare ones behind "More" */}
      <div className="grid grid-cols-2 gap-2">
        {!spool.archived && (
          <button className="btn-primary flex items-center justify-center gap-1.5 text-sm" onClick={() => actions.moisture(spool)}>
            {m.level === 'drying' ? <Flame size={15} /> : <Droplet size={15} />}{t('spools.actions.dry')}
          </button>
        )}
        <button className={btn} onClick={() => actions.weigh(spool)}><Scale size={15} />{t('spools.actions.weigh')}</button>
        <button className={btn} onClick={() => actions.edit(spool)}><Pencil size={15} />{t('spools.actions.edit')}</button>
        <button className={btn} onClick={() => actions.label(spool)}>
          <QrCode size={15} className={spool.label_printed_at ? 'text-ok' : ''} />{t('labels.action')}
        </button>
        <button className={btn} onClick={() => actions.history(spool)}><History size={15} />{t('spools.actions.history')}</button>
        {spool.archived
          ? <button className={btn} onClick={() => actions.unarchive(spool)}><ArchiveRestore size={15} />{t('spools.actions.unarchive')}</button>
          : <button className={btn} onClick={() => actions.archive(spool)}><Archive size={15} />{t('spools.actions.archive')}</button>}
      </div>
      <div>
        <button
          className="btn w-full flex items-center justify-center gap-1.5 text-sm text-gray-300 hover:bg-surface-3"
          onClick={() => setMore(v => !v)}
          aria-expanded={more}
        >{t('nav.more')}{more ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
        {more && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button className={btn} onClick={() => actions.duplicate(spool)}><Copy size={15} />{t('spools.actions.duplicate')}</button>
            <button className="btn bg-crit/15 text-crit hover:bg-crit/25 flex items-center justify-center gap-1.5 text-sm" onClick={() => actions.remove(spool)}>
              <Trash2 size={15} />{t('spools.actions.delete')}
            </button>
          </div>
        )}
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
        <Row k={t('spools.table.material')}>{spool.material}{subtypes ? ` · ${subtypes}` : ''}</Row>
        <Row k={t('spools.detail.initial')}>{fmtNum(spool.initial_weight_g / 1000, 2)} kg</Row>
        <Row k={t('spools.detail.spoolWeight')}>{spool.spool_weight_g ? `${fmtNum(spool.spool_weight_g, 0)} g` : dash}</Row>
        <Row k={t('spools.detail.diameter')}>{fmtNum(spool.diameter_mm, 2)} mm</Row>
        <Row k={t('spools.table.pricePerKg')}>{spool.price_per_kg != null ? `${fmtCurrency(spool.price_per_kg)}/kg` : dash}</Row>
        <Row k={t('spools.detail.purchasePrice')}>{spool.purchase_price != null ? fmtCurrency(spool.purchase_price) : dash}</Row>
        <Row k={t('spools.table.purchaseDate')}>{spool.purchased_at ? formatDateOnly(spool.purchased_at) : dash}</Row>
        <Row k={t('spools.table.location')}>{spool.purchase_location || dash}</Row>
        <Row k={t('spools.table.storageLocation')}>{spool.storage_location || dash}</Row>
        <Row k={t('spools.table.articleNumber')}>{spool.article_number || dash}</Row>
        <Row k={t('moisture.title')}>{moistText}</Row>
        <Row k={t('spools.form.packaging')}>{storageText}</Row>
        <Row k={t('spools.table.lastDried')}>{spool.last_dried_at ? formatDateOnly(spool.last_dried_at) : dash}</Row>
        <Row k={t('spools.detail.labelPrinted')}>{spool.label_printed_at ? formatDateOnly(spool.label_printed_at) : dash}</Row>
      </dl>
      {spool.notes && (
        <div className="text-xs">
          <p className="text-gray-400 mb-0.5">{t('spools.form.notes')}</p>
          <p className="text-gray-200 whitespace-pre-line break-words">{spool.notes}</p>
        </div>
      )}
      {sheet && <div className="h-1" />}
    </div>
  )
}

/** Laptop: column. The page puts it next to the list; it scrolls on its own. */
export function SpoolDetailColumn(props: React.ComponentProps<typeof DetailBody>) {
  return (
    <aside className="hidden lg:block w-[320px] shrink-0 min-h-0 overflow-y-auto rounded-2xl bg-surface-2 p-4" aria-label={spoolTitle(props.spool)}>
      <DetailBody {...props} sheet={false} />
    </aside>
  )
}

/** Phone / tablet: sheet from the bottom with a backdrop. */
export function SpoolDetailSheet(props: Omit<React.ComponentProps<typeof DetailBody>, 'sheet'>) {
  const { t } = useTranslation()
  const { onClose } = props
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="lg:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={spoolTitle(props.spool)}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-label={t('common.close')} />
      <div
        className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto bg-surface-2 rounded-t-2xl shadow-2xl px-4 pt-2"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        <div className="w-9 h-1 rounded-full bg-surface-4 mx-auto mb-3" />
        <DetailBody {...props} sheet />
      </div>
    </div>
  )
}
