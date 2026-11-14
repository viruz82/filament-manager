import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '../ui/Feedback'
import { api } from '../../api'
import { PACKAGING_TYPES } from '../../types'
import type { Spool, BrandSpoolWeight, SpoolAuditEntry, Packaging } from '../../types'
import { X, RotateCcw, Droplet, Flame, Scale } from 'lucide-react'
import { formatDateTimeTZ } from '../../utils/time'
import { useHATZ } from '../../hooks/useHATZ'
import { parseDecimal, fmtNum } from '../../utils/number'

// ── Spool Audit Modal ─────────────────────────────────────────────────────────

export function SpoolAuditModal({ spool, onClose }: { spool: Spool; onClose: () => void }) {
  const { confirm } = useConfirm()
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: entries = [], isLoading } = useQuery<SpoolAuditEntry[]>({
    queryKey: ['spool-audit', spool.id],
    queryFn: () => api.getSpoolAudit(spool.id),
  })

  const correctMut = useMutation({
    mutationFn: (entryId: number) => api.correctSpoolAudit(spool.id, entryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spool-audit', spool.id] })
      qc.invalidateQueries({ queryKey: ['spools'] })
    },
  })

  const tz = useHATZ()

  const actionLabel = (action: string) => t(`spools.audit.action_${action}`, action)

  const handleCorrect = async (e: SpoolAuditEntry) => {
    const sign = e.delta_g < 0 ? '' : '+'
    const msg = t('spools.audit.correctConfirm', {
      delta: `${sign}${fmtNum(e.delta_g, 1)}`,
      reverse: `${e.delta_g < 0 ? '+' : ''}${fmtNum((-e.delta_g), 1)}`,
    })
    if (await confirm({ title: msg })) correctMut.mutate(e.id)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-2 border border-surface-3 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-3 shrink-0">
          <h2 className="font-semibold text-sm">
            {t('spools.audit.title', { brand: spool.brand, color: spool.color_name })}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto flex-1">
          {isLoading && <p className="text-gray-500 text-sm p-5">{t('common.loading')}</p>}
          {!isLoading && entries.length === 0 && (
            <p className="text-gray-500 text-sm p-5">{t('spools.audit.noEntries')}</p>
          )}
          {entries.length > 0 && (
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-surface-3 text-gray-400 font-medium">
                  <th className="px-4 py-2">{t('spools.audit.date')}</th>
                  <th className="px-4 py-2">{t('spools.audit.action')}</th>
                  <th className="px-4 py-2 text-right">{t('spools.audit.before')}</th>
                  <th className="px-4 py-2 text-right">{t('spools.audit.delta')}</th>
                  <th className="px-4 py-2 text-right">{t('spools.audit.after')}</th>
                  <th className="px-4 py-2">{t('spools.audit.print')}</th>
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
                  const positive = e.delta_g > 0
                  return (
                    <tr key={e.id} className="border-b border-surface-3/40 hover:bg-surface-3/30">
                      <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                        {formatDateTimeTZ(e.changed_at, tz)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${
                          e.action === 'print_auto'    ? 'bg-info/15 text-info' :
                          e.action === 'print_manual'  ? 'bg-extra/15 text-extra' :
                          e.action === 'print_delete'  ? 'bg-ok/15 text-ok' :
                          e.action === 'correction'    ? 'bg-warn/15 text-warn' :
                          'bg-surface-3 text-gray-300'
                        }`}>
                          {actionLabel(e.action)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-gray-400 whitespace-nowrap">
                        {e.weight_before != null ? `${fmtNum(e.weight_before, 1)} g` : '—'}
                      </td>
                      <td className={`px-4 py-2 text-right font-medium whitespace-nowrap ${positive ? 'text-ok' : 'text-crit'}`}>
                        {positive ? '+' : ''}{fmtNum(e.delta_g, 1)} g
                      </td>
                      <td className="px-4 py-2 text-right text-gray-300 whitespace-nowrap">
                        {e.weight_after != null ? `${fmtNum(e.weight_after, 1)} g` : '—'}
                      </td>
                      <td className="px-4 py-2 text-gray-400">
                        {e.print_name ?? '—'}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          onClick={() => handleCorrect(e)}
                          disabled={correctMut.isPending}
                          className="btn-ghost p-1 text-gray-500 hover:text-warn"
                          title={t('spools.audit.correctBtn')}
                        >
                          <RotateCcw size={11} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Moisture ──────────────────────────────────────────────────────────────────

const MOISTURE_COLOR: Record<string, string> = {
  dry: 'text-ok', good: 'text-info', warning: 'text-warn',
  critical: 'text-crit', drying: 'text-warn', unknown: 'text-gray-500',
}
const MOISTURE_BAR: Record<string, string> = {
  dry: '#4ade80', good: '#38bdf8', warning: '#fbbf24', critical: '#f87171', drying: '#fb923c', unknown: '#6b7280',
}

export function MoistureModal({ spool, onClose }: { spool: Spool; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: fresh } = useQuery<Spool>({ queryKey: ['spool', spool.id], queryFn: () => api.getSpool(spool.id), initialData: spool })
  const s = fresh ?? spool
  const m = s.moisture
  const done = () => {
    qc.invalidateQueries({ queryKey: ['spools'] })
    qc.invalidateQueries({ queryKey: ['spool', spool.id] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
  const act = useMutation({
    mutationFn: (what: 'start' | 'finish' | 'cancel' | 'dry') =>
      what === 'start' ? api.startDrying(s.id)
      : what === 'finish' ? api.finishDrying(s.id)
      : what === 'cancel' ? api.cancelDrying(s.id)
      : api.markSpoolDry(s.id),
    onSuccess: done,
  })
  const pack = useMutation({
    mutationFn: (packaging: Packaging | null) => api.updateSpool(s.id, { packaging }),
    onSuccess: done,
  })
  const days = m.days_since_dried
  const daysText = days == null ? t('moisture.neverDried')
    : days < 1 ? t('moisture.driedToday')
    : t('moisture.driedDaysAgo', { n: Math.round(days) })

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-2 border border-surface-3 rounded-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-3">
          <h2 className="font-semibold flex items-center gap-2"><Droplet size={16} /> {t('moisture.title')}</h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-4 h-4 rounded-full shrink-0 ring-1 ring-white/10" style={{ background: s.color_hex }} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {s.custom_id ? `#${s.custom_id} ` : ''}{s.brand} {s.material}{s.subtype ? ` ${s.subtype}` : ''}
              </p>
              <p className="text-xs text-gray-400 truncate">{s.color_name}</p>
            </div>
          </div>

          <div>
            <div className={`flex items-center justify-between text-sm font-semibold ${MOISTURE_COLOR[m.level]}`}>
              <span className="flex items-center gap-1.5">
                {m.level === 'drying' ? <Flame size={14} /> : <Droplet size={14} />}
                {t(`moisture.level.${m.level}`)}
              </span>
              {m.pct != null && <span>{Math.round(m.pct)} %</span>}
            </div>
            <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden mt-1.5">
              <div className="h-full rounded-full" style={{ width: `${m.pct ?? (m.level === 'drying' ? 100 : 0)}%`, background: MOISTURE_BAR[m.level] }} />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {m.level === 'drying' ? t('moisture.inDryerHint') : daysText}
              {m.storage === 'ams' && m.level !== 'drying' ? ` · ${t('moisture.inAms')}` : ''}
            </p>
          </div>

          <div>
            <label className="label">{t('spools.form.packaging')}</label>
            <select
              className="input"
              value={s.packaging ?? ''}
              disabled={pack.isPending}
              onChange={e => pack.mutate((e.target.value || null) as Packaging | null)}
            >
              <option value="">{t('moisture.storage.unknown')}</option>
              {PACKAGING_TYPES.map(k => <option key={k} value={k}>{t(`moisture.storage.${k}`)}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            {s.is_drying ? (
              <>
                <button className="btn-primary w-full flex items-center justify-center gap-1.5" disabled={act.isPending} onClick={() => act.mutate('finish')}>
                  <Droplet size={14} /> {t('moisture.finishDrying')}
                </button>
                <button className="btn-ghost w-full text-xs" disabled={act.isPending} onClick={() => act.mutate('cancel')}>
                  {t('moisture.cancelDrying')}
                </button>
              </>
            ) : (
              <>
                <button className="btn-primary w-full flex items-center justify-center gap-1.5" disabled={act.isPending} onClick={() => act.mutate('dry')}>
                  <Droplet size={14} /> {t('moisture.markDry')}
                </button>
                <button className="btn-ghost w-full flex items-center justify-center gap-1.5 border border-surface-3" disabled={act.isPending} onClick={() => act.mutate('start')}>
                  <Flame size={14} /> {t('moisture.startDrying')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Weigh Modal ───────────────────────────────────────────────────────────────

export function WeighModal({ spool, onClose }: { spool: Spool; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [gross, setGross] = useState('')
  const { data: brandWeights = [] } = useQuery<BrandSpoolWeight[]>({ queryKey: ['brand-weights'], queryFn: api.getBrandWeights })
  const brandTare = brandWeights.find(b => b.brand.toLowerCase() === spool.brand.toLowerCase())?.spool_weight_g ?? 0
  const tare = spool.spool_weight_g || brandTare
  const grossG = parseDecimal(gross)
  const remaining = grossG != null ? Math.max(0, Math.round((grossG - tare) * 10) / 10) : null
  const delta = remaining != null ? Math.round((remaining - spool.current_weight_g) * 10) / 10 : null
  const pct = remaining != null && spool.initial_weight_g ? (remaining / spool.initial_weight_g) * 100 : null

  const weighMut = useMutation({
    mutationFn: () => api.weighSpool(spool.id, grossG!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spools'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    },
  })
  const canSave = grossG != null && grossG >= 0 && !weighMut.isPending

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-2 border border-surface-3 rounded-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-3">
          <h2 className="font-semibold flex items-center gap-2"><Scale size={16} /> {t('spools.weigh.title')}</h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-4 h-4 rounded-full shrink-0 ring-1 ring-white/10" style={{ background: spool.color_hex }} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {spool.custom_id ? `#${spool.custom_id} ` : ''}{spool.brand} {spool.material}{spool.subtype ? ` ${spool.subtype}` : ''}
              </p>
              <p className="text-xs text-gray-400 truncate">{spool.color_name}</p>
            </div>
          </div>

          <div>
            <label className="label">{t('spools.form.scaleReading')}</label>
            <div className="flex items-center gap-2">
              <input
                className="input text-lg"
                type="text"
                inputMode="decimal"
                autoFocus
                value={gross}
                onChange={e => setGross(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && canSave && weighMut.mutate()}
                placeholder={String(Math.round(spool.current_weight_g + tare))}
              />
              <span className="text-xs text-gray-500 shrink-0">g</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {tare > 0
                ? t('spools.weigh.tare', { g: fmtNum(tare, 0) })
                : t('spools.weigh.noTare')}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-surface-3/40 rounded-lg py-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">{t('spools.weigh.before')}</p>
              <p className="text-sm text-gray-300 tabular-nums">{fmtNum(spool.current_weight_g, 0)} g</p>
            </div>
            <div className="bg-surface-3/40 rounded-lg py-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">{t('spools.weigh.after')}</p>
              <p className="text-sm text-white font-semibold tabular-nums">
                {remaining != null ? `${fmtNum(remaining, 0)} g` : '—'}
              </p>
              {pct != null && <p className="text-[10px] text-gray-500 tabular-nums">{fmtNum(pct, 0)} %</p>}
            </div>
            <div className="bg-surface-3/40 rounded-lg py-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">{t('spools.weigh.delta')}</p>
              <p className={`text-sm tabular-nums ${delta == null || delta === 0 ? 'text-gray-400' : delta < 0 ? 'text-warn' : 'text-ok'}`}>
                {delta != null ? `${delta > 0 ? '+' : ''}${fmtNum(delta, 0)} g` : '—'}
              </p>
            </div>
          </div>
          {weighMut.isError && <p className="text-xs text-crit">{String(weighMut.error)}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-3">
          <button className="btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn-primary" onClick={() => weighMut.mutate()} disabled={!canSave}>{t('common.save')}</button>
        </div>
      </div>
    </div>
  )
}
