import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useConfirm, useToast } from '../components/ui/Feedback'
import { api } from '../api'
import type { Spool, BrandSpoolWeight, FilamentCatalog, SpoolAuditEntry, Packaging } from '../types'
import { PACKAGING_TYPES } from '../types'
import { Plus, Trash2, X, RotateCcw, Droplet, Flame, Scale } from 'lucide-react'
import Modal from '../components/Modal'
import LabelModal from '../components/LabelModal'
import { useSearchParams } from 'react-router-dom'
import { formatDateOnly, formatDateTimeTZ } from '../utils/time'
import { useHATZ, useCurrencyFormatter, useCurrencySymbol, useHACurrency } from '../hooks/useHATZ'
import { saveBlob } from '../utils/download'
import { parseDecimal, fmtNum } from '../utils/number'
import { AmsSlotSelect } from '../hooks/useAmsSlots'
import { useMediaQuery } from '../hooks/useMediaQuery'
import SpoolToolbar from '../components/spools/SpoolToolbar'
import type { SpoolView } from '../components/spools/SpoolToolbar'
import { SpoolTiles, SpoolList } from '../components/spools/SpoolViews'
import type { ViewActions } from '../components/spools/SpoolViews'
import { SpoolDetailColumn, SpoolDetailSheet } from '../components/spools/SpoolDetail'
import type { DetailActions } from '../components/spools/SpoolDetail'
import {
  EMPTY_FILTER, FILTER_PARAM, defaultDir, filterSpools, isLow, isMoist, loadSort, saveSort, sortSpools,
} from '../components/spools/spoolFilters'
import type { SortKey, SortState, SpoolFilter } from '../components/spools/spoolFilters'

// ── Spool Form ────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  custom_id: '',
  brand: '', material: 'PLA', subtype: '', subtype2: '', color_name: '', color_hex: '#888888',
  color2_hex: '', color3_hex: '', color4_hex: '',
  diameter_mm: '', initial_weight_g: 1000, current_weight_g: 1000,
  spool_weight_g: '',   // own empty-spool tare; '' = take it from the brand config
  purchase_price: '', purchased_at: '', purchase_location: '', storage_location: '',
  article_number: '', last_dried_at: '', packaging: '' as Packaging | '', ams_slot: '', notes: '',
  is_refill_pack: false,
}

function SpoolForm({
  initial,
  isNew,
  onSave,
  onCancel,
}: {
  initial?: Partial<Spool>
  isNew?: boolean
  onSave: (data: typeof EMPTY_FORM, quantity: number) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const currencySymbol = useCurrencySymbol()
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    ...initial,
    subtype: initial?.subtype ?? '',
    subtype2: initial?.subtype2 ?? '',
    purchase_price: initial?.purchase_price?.toString() ?? '',
    purchased_at: initial?.purchased_at ? initial.purchased_at.slice(0, 10) : '',
    purchase_location: initial?.purchase_location ?? '',
    storage_location: initial?.storage_location ?? '',
    article_number: initial?.article_number ?? '',
    last_dried_at: initial?.last_dried_at ? initial.last_dried_at.slice(0, 10) : '',
    packaging: (initial?.packaging ?? '') as Packaging | '',
    initial_weight_g: initial?.initial_weight_g ?? 1000,
    current_weight_g: initial?.current_weight_g ?? 1000,
    spool_weight_g: initial?.spool_weight_g ? String(initial.spool_weight_g) : '',
    color2_hex: initial?.color2_hex ?? '',
    color3_hex: initial?.color3_hex ?? '',
    color4_hex: initial?.color4_hex ?? '',
  })

  const [measuredTotal, setMeasuredTotal] = useState('')
  const [quantity, setQuantity] = useState(1)
  const weightInputRef = useRef<HTMLInputElement>(null)

  const { data: materials = [] } = useQuery({ queryKey: ['materials'], queryFn: api.getMaterials })
  const { data: subtypes = [] } = useQuery({ queryKey: ['subtypes'], queryFn: api.getSubtypes })
  const { data: brandWeights = [] } = useQuery<BrandSpoolWeight[]>({ queryKey: ['brand-weights'], queryFn: api.getBrandWeights })
  const { data: brands = [] } = useQuery<{ id: number; name: string }[]>({ queryKey: ['filament-brands'], queryFn: api.getFilamentBrands })
  const { data: locations = [] } = useQuery<{ id: number; name: string }[]>({ queryKey: ['purchase-locations'], queryFn: api.getPurchaseLocations })
  const { data: storageLocations = [] } = useQuery<{ id: number; name: string }[]>({ queryKey: ['storage-locations'], queryFn: api.getStorageLocations })
  const { data: filamentCatalog = [] } = useQuery<FilamentCatalog[]>({ queryKey: ['filament-catalog'], queryFn: api.getFilamentCatalog })
  const { data: activeSpools = [] } = useQuery<Spool[]>({ queryKey: ['spools', false], queryFn: () => api.getSpools(false) })

  const matchedBrand = brandWeights.find(b => b.brand.toLowerCase() === form.brand.toLowerCase())
  const brandTareG = matchedBrand?.spool_weight_g ?? 0
  const ownTareG = parseDecimal(form.spool_weight_g as string)
  const tareG = ownTareG ?? brandTareG
  // Tare variants of the same brand, e.g. "SUNLU (V1)" / "SUNLU (V2)"
  const tareVariants = form.brand.trim()
    ? brandWeights.filter(b => b.brand.toLowerCase().startsWith(form.brand.trim().toLowerCase()))
    : []

  const recalcFromScale = (total: string, tare: number) => {
    const totalG = parseFloat(total)
    if (!isNaN(totalG)) {
      setForm(f => ({ ...f, current_weight_g: Math.max(0, Math.round((totalG - tare) * 10) / 10) }))
    }
  }

  const onBrandChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // A new brand brings its own tare: drop the per-spool value
    setForm(f => ({ ...f, brand: e.target.value, spool_weight_g: '' }))
  }

  const setOwnTare = (val: string) => {
    setForm(f => ({ ...f, spool_weight_g: val }))
    if (measuredTotal) recalcFromScale(measuredTotal, parseDecimal(val) ?? brandTareG)
  }

  const onMeasuredChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setMeasuredTotal(val)
    recalcFromScale(val, tareG)
  }

  const set = (k: keyof typeof EMPTY_FORM) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-2 border border-surface-3 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-3">
          <h2 className="font-semibold">{initial?.id ? t('spools.editSpool') : t('spools.addSpool')}</h2>
          <button onClick={onCancel} className="btn-ghost p-1"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">{t('spools.form.articleNumber')}</label>
            <select
              className="input"
              autoFocus={isNew}
              value={form.article_number ?? ''}
              onChange={e => {
                const val = e.target.value
                const entry = filamentCatalog.find(c => c.article_number === val)
                if (entry) {
                  setForm(f => ({
                    ...f,
                    article_number: val,
                    brand: entry.brand,
                    material: entry.material,
                    subtype: entry.subtype ?? '',
                    subtype2: entry.subtype2 ?? '',
                    color_name: entry.color_name,
                    color_hex: entry.color_hex,
                    color2_hex: entry.color2_hex ?? '',
                    color3_hex: entry.color3_hex ?? '',
                    color4_hex: entry.color4_hex ?? '',
                  }))
                  setTimeout(() => weightInputRef.current?.focus(), 0)
                } else {
                  setForm(f => ({ ...f, article_number: val }))
                }
              }}
            >
              <option value="">{t('common.select')}</option>
              {filamentCatalog.filter(c => c.article_number).map(c => (
                <option key={c.id} value={c.article_number!}>
                  {c.article_number} — {c.brand} {c.material} {c.color_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">{t('spools.form.customId')}</label>
            <input
              className="input w-28"
              type="number"
              min="1"
              max="9999"
              step="1"
              placeholder="—"
              value={form.custom_id ?? ''}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 4)
                setForm(f => ({ ...f, custom_id: v }))
              }}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t('spools.form.brand')} *</label>
              <input className="input" value={form.brand} onChange={onBrandChange}
                placeholder={t('spools.form.brandPlaceholder')}
                list="brand-list" />
              <datalist id="brand-list">
                {brands.map(b => <option key={b.id} value={b.name} />)}
              </datalist>
            </div>
            <div>
              <label className="label">{t('spools.form.material')} *</label>
              <select className="input" value={form.material} onChange={set('material')}>
                {materials.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t('spools.form.subtype')}</label>
              <select className="input" value={form.subtype ?? ''} onChange={set('subtype')}>
                <option value="">{t('common.none')}</option>
                {subtypes.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('spools.form.subtype2')}</label>
              <select className="input" value={form.subtype2 ?? ''} onChange={set('subtype2')}>
                <option value="">{t('common.none')}</option>
                {subtypes.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t('spools.form.diameter')}</label>
              <select className="input" value={form.diameter_mm} onChange={set('diameter_mm')}>
                <option value={1.75}>1.75 mm</option>
                <option value={2.85}>2.85 mm</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t('spools.form.colorName')} *</label>
              <input className="input" value={form.color_name} onChange={set('color_name')}
                placeholder={t('spools.form.colorPlaceholder')} />
            </div>
            <div>
              <label className="label">{t('spools.form.colorSwatch')}</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-9 w-16 rounded cursor-pointer bg-surface-3 border border-surface-3"
                  value={/^#[0-9a-fA-F]{6}$/.test(form.color_hex) ? form.color_hex : '#888888'}
                  onChange={set('color_hex')}
                />
                <div className="flex items-center flex-1">
                  <span className="px-2 py-1.5 text-sm text-gray-400 bg-surface-3 border border-r-0 border-surface-3 rounded-l-lg select-none">#</span>
                  <input
                    className={`input flex-1 rounded-l-none ${form.color_hex && !/^#[0-9a-fA-F]{6}$/.test(form.color_hex) ? 'border-crit focus:border-crit' : ''}`}
                    value={form.color_hex.replace(/^#/, '')}
                    onChange={e => setForm(f => ({ ...f, color_hex: '#' + e.target.value.replace(/^#/, '') }))}
                    placeholder="ffffff"
                    maxLength={6}
                  />
                </div>
              </div>
              {form.color_hex && !/^#[0-9a-fA-F]{6}$/.test(form.color_hex) && (
                <p className="text-xs text-crit mt-1">{t('spools.form.colorHexInvalid')}</p>
              )}
            </div>
          </div>

          {/* Optional extra colors for multicolor filaments */}
          {(['color2_hex', 'color3_hex', 'color4_hex'] as const).map((key, i) => (
            <div key={key} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div />
              <div>
                <label className="label">{t(`spools.form.${key}`)}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    className="h-9 w-16 rounded cursor-pointer bg-surface-3 border border-surface-3"
                    value={/^#[0-9a-fA-F]{6}$/.test(form[key]) ? form[key] : '#888888'}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  />
                  <div className="flex items-center flex-1">
                    <span className="px-2 py-1.5 text-sm text-gray-400 bg-surface-3 border border-r-0 border-surface-3 rounded-l-lg select-none">#</span>
                    <input
                      className="input flex-1 rounded-l-none"
                      value={form[key].replace(/^#/, '')}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value ? '#' + e.target.value.replace(/^#/, '') : '' }))}
                      placeholder={t('common.optional')}
                      maxLength={6}
                    />
                  </div>
                  {form[key] && (
                    <button type="button" className="text-gray-500 hover:text-crit p-1" onClick={() => setForm(f => ({ ...f, [key]: '' }))}>
                      <X size={14} />
                    </button>
                  )}
                </div>
                {form[key] && !/^#[0-9a-fA-F]{6}$/.test(form[key]) && (
                  <p className="text-xs text-crit mt-1">{t('spools.form.colorHexInvalid')}</p>
                )}
              </div>
            </div>
          ))}

          {/* Weight section */}
          <div className="rounded-xl border border-surface-3 p-3 space-y-3 bg-surface-3/20">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{t('spools.form.weight')}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{t('spools.form.nominalWeight')} *</label>
                <div className="flex items-center gap-2">
                  <input
                    ref={weightInputRef}
                    className="input" type="number" step="50" min="0"
                    value={form.initial_weight_g}
                    onChange={e => setForm(f => ({
                      ...f,
                      initial_weight_g: parseFloat(e.target.value) || 0,
                      current_weight_g: initial?.id ? f.current_weight_g : parseFloat(e.target.value) || 0,
                    }))}
                    placeholder="1000"
                  />
                  <span className="text-xs text-gray-500 shrink-0">g</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{t('spools.form.nominalWeightHint')}</p>
              </div>

              <div>
                <label className="label">{t('spools.form.emptySpoolTare')}</label>
                <div className="flex items-center gap-2">
                  <input
                    className="input"
                    type="text"
                    inputMode="decimal"
                    value={form.spool_weight_g as string}
                    onChange={e => setOwnTare(e.target.value)}
                    placeholder={brandTareG > 0 ? String(brandTareG) : '—'}
                  />
                  <span className="text-xs text-gray-500 shrink-0">g</span>
                </div>
                {ownTareG != null ? (
                  <p className="text-xs text-gray-400 mt-0.5">{t('spools.form.tareOwn')}</p>
                ) : matchedBrand ? (
                  <p className="text-xs text-ok mt-0.5">{t('spools.form.brandConfig', { brand: form.brand })}</p>
                ) : form.brand ? (
                  <p className="text-xs text-gray-500 mt-0.5">{t('spools.form.noBrandConfig')}</p>
                ) : null}
                {tareVariants.length > 1 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {tareVariants.map(v => (
                      <button
                        key={v.id}
                        type="button"
                        className={`text-[11px] px-1.5 py-0.5 rounded border transition-colors ${
                          tareG === v.spool_weight_g ? 'border-accent text-white' : 'border-surface-3 text-gray-400 hover:text-white'
                        }`}
                        onClick={() => setOwnTare(String(v.spool_weight_g))}
                      >
                        {v.brand} · {fmtNum(v.spool_weight_g, 0)} g
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Scale-based remaining calculator */}
            <div className="border-t border-surface-3 pt-3">
              <p className="text-xs text-gray-400 mb-2">{t('spools.form.scaleHint')}</p>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="label">{t('spools.form.scaleReading')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      className="input" type="number" step="1" min="0"
                      value={measuredTotal}
                      onChange={onMeasuredChange}
                      placeholder="750"
                    />
                    <span className="text-xs text-gray-500 shrink-0">g</span>
                  </div>
                </div>
                <div className="text-gray-500 text-xs mt-4">→</div>
                <div className="flex-1">
                  <label className="label">{t('spools.form.remainingFilament')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      className="input" type="number" step="1" min="0"
                      value={form.current_weight_g}
                      onChange={e => {
                        setMeasuredTotal('')
                        setForm(f => ({ ...f, current_weight_g: parseFloat(e.target.value) || 0 }))
                      }}
                    />
                    <span className="text-xs text-gray-500 shrink-0">g</span>
                  </div>
                </div>
              </div>
              {form.initial_weight_g > 0 && (
                <p className="text-xs text-gray-500 mt-1.5">
                  {t('spools.form.percentRemaining', { pct: fmtNum(((form.current_weight_g / form.initial_weight_g) * 100), 1) })}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t('spools.form.purchasePrice')}</label>
              {/* type="text" + inputMode="decimal": a native number input rejects the
                  comma decimal separator German/etc. keyboards produce (issue #18) */}
              <div className="flex items-center gap-2">
                <input
                  className={`input ${form.purchase_price.trim() !== '' && parseDecimal(form.purchase_price) === null ? 'border-crit focus:border-crit' : ''}`}
                  type="text" inputMode="decimal"
                  value={form.purchase_price}
                  onChange={set('purchase_price')}
                  placeholder={t('spools.form.purchasePricePlaceholder')}
                />
                <span className="text-xs text-gray-500 shrink-0">{currencySymbol}</span>
              </div>
            </div>
            <div>
              <label className="label">{t('spools.form.purchaseDate')}</label>
              <input className="input" type="date" value={form.purchased_at} onChange={set('purchased_at')} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox" className="accent-accent"
              checked={form.is_refill_pack}
              onChange={e => setForm(f => ({ ...f, is_refill_pack: e.target.checked }))}
            />
            {t('spools.form.refillPack')}
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t('spools.form.purchaseLocation')}</label>
              <select className="input" value={form.purchase_location} onChange={set('purchase_location')}>
                <option value="">{t('common.select')}</option>
                {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('spools.form.storageLocation')}</label>
              <select className="input" value={form.storage_location} onChange={set('storage_location')}>
                <option value="">{t('common.select')}</option>
                {storageLocations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t('spools.form.amsSlot')}</label>
              <AmsSlotSelect
                spoolId={isNew ? undefined : initial?.id}
                value={form.ams_slot || null}
                onChange={slot => setForm(f => ({ ...f, ams_slot: slot ?? '' }))}
                spools={activeSpools}
              />
            </div>
            <div>
              <label className="label">{t('spools.form.lastDried')}</label>
              <input className="input" type="date" value={form.last_dried_at ?? ''} onChange={set('last_dried_at')} />
              {isNew && (
                <label className="flex items-center gap-2 mt-1.5 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={form.last_dried_at === new Date().toISOString().slice(0, 10)}
                    onChange={e => setForm(f => ({ ...f, last_dried_at: e.target.checked ? new Date().toISOString().slice(0, 10) : '' }))}
                  />
                  {t('spools.form.justDried')}
                </label>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t('spools.form.packaging')}</label>
              <select className="input" value={form.packaging ?? ''} onChange={e => setForm(f => ({ ...f, packaging: e.target.value as Packaging | '' }))}>
                <option value="">{t('common.select')}</option>
                {PACKAGING_TYPES.map(k => <option key={k} value={k}>{t(`moisture.storage.${k}`)}</option>)}
              </select>
              <p className="text-xs text-gray-500 mt-0.5">{t('spools.form.packagingHint')}</p>
            </div>
          </div>

          <div>
            <label className="label">{t('spools.form.notes')}</label>
            <textarea className="input h-16 resize-none" value={form.notes ?? ''} onChange={set('notes')} />
          </div>

        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-surface-3 gap-3">
          {isNew && (
            <div className="flex items-center gap-2 shrink-0">
              <label className="text-xs text-gray-400">{t('spools.form.qty')}</label>
              <input
                className="input w-16 text-sm py-1 text-center"
                type="number" min="1" max="50"
                value={quantity}
                onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>
          )}
          <div className="flex gap-2 ml-auto">
            <button className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
            <button
              className="btn-primary"
              onClick={() => onSave(form as typeof EMPTY_FORM, quantity)}
              disabled={!form.brand || !form.material || !form.color_name || !/^#[0-9a-fA-F]{6}$/.test(form.color_hex) || (form.purchase_price.trim() !== '' && parseDecimal(form.purchase_price) === null)}
            >
              {isNew && quantity > 1 ? t('spools.form.addN', { n: quantity }) : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Spool Audit Modal ─────────────────────────────────────────────────────────

function SpoolAuditModal({ spool, onClose }: { spool: Spool; onClose: () => void }) {
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

function MoistureModal({ spool, onClose }: { spool: Spool; onClose: () => void }) {
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

function WeighModal({ spool, onClose }: { spool: Spool; onClose: () => void }) {
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Spools() {
  const { choose } = useConfirm()
  const toast = useToast()
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const currency = useHACurrency()
  const fmtCurrency = useCurrencyFormatter()
  const isLaptop = useMediaQuery('(min-width: 1024px)')
  const [inventoryBusy, setInventoryBusy] = useState(false)
  const downloadInventory = async () => {
    setInventoryBusy(true)
    try {
      const blob = await api.inventoryReportPdf(i18n.resolvedLanguage ?? i18n.language ?? 'en', currency)
      saveBlob(blob, `${t('spools.inventoryPdf')}_${new Date().toISOString().slice(0, 10)}.pdf`)
    } catch (e: unknown) {
      toast.error(t('common.pdfFailed') + ': ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setInventoryBusy(false)
    }
  }
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Spool | null>(null)
  const [duplicating, setDuplicating] = useState<Spool | null>(null)
  const [auditSpool, setAuditSpool] = useState<Spool | null>(null)
  // Chosen view is remembered per browser; without a choice the phone starts with the list
  const [view, setViewState] = useState<SpoolView>(() => {
    try {
      const v = localStorage.getItem('fm_spool_view')
      if (v === 'cards' || v === 'table') return v
    } catch { /* private mode etc. */ }
    return window.matchMedia('(min-width: 1024px)').matches ? 'cards' : 'table'
  })
  const setView = (v: SpoolView) => {
    setViewState(v)
    try { localStorage.setItem('fm_spool_view', v) } catch { /* private mode etc. */ }
  }
  const [filter, setFilter] = useState<SpoolFilter>(EMPTY_FILTER)
  const [sort, setSortState] = useState<SortState>(loadSort)
  const setSort = (s: SortState) => { setSortState(s); saveSort(s) }
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Label dialog: ids of the spools to print; labelPick = choose from the list
  const [labelIds, setLabelIds] = useState<number[] | null>(null)
  const [labelPick, setLabelPick] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()

  const includeArchived = filter.quick === 'archived'
  const { data: spools = [], isLoading } = useQuery<Spool[]>({
    queryKey: ['spools', includeArchived],
    queryFn: () => api.getSpools(includeArchived),
  })
  const { data: prefs } = useQuery({ queryKey: ['user-prefs'], queryFn: api.getUserPrefs, staleTime: Infinity })
  const lowPct = prefs?.low_stock_threshold_pct ?? 20

  // Deep link from the Home Assistant buttons (#/spools?filter=wenig|feucht|ams|archiv)
  useEffect(() => {
    const raw = searchParams.get('filter')
    if (!raw) return
    const quick = FILTER_PARAM[raw.toLowerCase()]
    if (quick) setFilter(f => ({ ...f, quick }))
    const next = new URLSearchParams(searchParams); next.delete('filter'); setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  // Deep link from a spool label's QR code (#/spools?spool=12): show that spool
  useEffect(() => {
    const id = Number(searchParams.get('spool'))
    if (!id || isLoading) return
    const hit = spools.find(s => s.id === id)
    if (hit) { setFilter(f => ({ ...f, quick: hit.archived ? 'archived' : 'all' })); setSelectedId(hit.id) }
    else if (!includeArchived) { setFilter(f => ({ ...f, quick: 'archived' })); return }
    const next = new URLSearchParams(searchParams); next.delete('spool'); setSearchParams(next, { replace: true })
  }, [searchParams, spools, isLoading, includeArchived, setSearchParams])

  // Deep link from the label dialog's "open in browser" (#/spools?labels=12,15)
  useEffect(() => {
    const raw = searchParams.get('labels')
    if (!raw || isLoading) return
    const ids = raw.split(',').map(Number).filter(id => spools.some(s => s.id === id))
    if (ids.length) { setLabelPick(false); setLabelIds(ids) }
    const next = new URLSearchParams(searchParams); next.delete('labels'); setSearchParams(next, { replace: true })
  }, [searchParams, spools, isLoading, setSearchParams])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['spools'] })
  const [weighing, setWeighing] = useState<Spool | null>(null)
  const [moistureSpool, setMoistureSpool] = useState<Spool | null>(null)

  const active = useMemo(() => spools.filter(s => !s.archived), [spools])
  const counts = useMemo(() => ({
    all: active.length,
    moist: active.filter(isMoist).length,
    low: active.filter(s => isLow(s, lowPct)).length,
    ams: active.filter(s => !!s.ams_slot).length,
  }), [active, lowPct])
  const materials = useMemo(() => [...new Set(spools.map(s => s.material).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [spools])
  const locations = useMemo(() => [...new Set(spools.map(s => s.storage_location).filter((l): l is string => !!l))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [spools])
  const shown = useMemo(() => sortSpools(filterSpools(spools, filter, lowPct), sort), [spools, filter, lowPct, sort])
  const totalKg = shown.reduce((sum, s) => sum + s.current_weight_g, 0) / 1000
  const totalValue = shown.reduce((sum, s) => sum + (s.cost_per_gram ?? 0) * s.current_weight_g, 0)
  const selected = selectedId != null ? spools.find(s => s.id === selectedId) ?? null : null

  const createMut = useMutation({ mutationFn: api.createSpool, onSuccess: invalidate })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Spool> }) => api.updateSpool(id, data),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['printer-ams'] }); setEditing(null) },
  })
  const deleteMut = useMutation({ mutationFn: api.deleteSpool, onSuccess: invalidate })
  // Direct AMS slot assignment — the backend frees the slot on whichever spool held it before.
  const assignSlotMut = useMutation({
    mutationFn: ({ id, slot }: { id: number; slot: string | null }) => api.updateSpool(id, { ams_slot: slot }),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['printer-ams'] }) },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Saving failed'),
  })
  const archiveMut = useMutation({ mutationFn: (id: number) => api.archiveSpool(id), onSuccess: invalidate })
  const unarchiveMut = useMutation({ mutationFn: (id: number) => api.unarchiveSpool(id), onSuccess: invalidate })
  const buildPayload = (form: typeof EMPTY_FORM): Partial<Spool> => {
    // the form state is seeded with the whole spool: never send the moisture
    // state back (the dryer buttons own it; a stale copy would overwrite it)
    const { is_drying: _d, drying_started_at: _ds, moisture: _m, ...rest } = form as typeof form & Partial<Spool>
    void _d; void _ds; void _m
    return {
    ...rest,
    custom_id: form.custom_id !== '' ? parseInt(form.custom_id as string, 10) || null : null,
    diameter_mm: form.diameter_mm !== '' ? parseFloat(form.diameter_mm as string) : 1.75,
    purchase_price: parseDecimal(form.purchase_price as string),
    purchased_at: form.purchased_at || null,
    purchase_location: form.purchase_location || null,
    storage_location: form.storage_location || null,
    article_number: form.article_number || null,
    last_dried_at: form.last_dried_at || null,
    packaging: form.packaging || null,
    subtype: form.subtype || null,
    subtype2: form.subtype2 || null,
    color2_hex: (form.color2_hex && /^#[0-9a-fA-F]{6}$/.test(form.color2_hex)) ? form.color2_hex : null,
    color3_hex: (form.color3_hex && /^#[0-9a-fA-F]{6}$/.test(form.color3_hex)) ? form.color3_hex : null,
    color4_hex: (form.color4_hex && /^#[0-9a-fA-F]{6}$/.test(form.color4_hex)) ? form.color4_hex : null,
    ams_slot: form.ams_slot || null,
    notes: form.notes || null,
    // null → backend takes the tare from the brand config
    spool_weight_g: parseDecimal(form.spool_weight_g as string),
  } as unknown as Partial<Spool>
  }

  const handleSave = async (form: typeof EMPTY_FORM, quantity: number) => {
    const payload = buildPayload(form)
    if (editing) {
      updateMut.mutate({ id: editing.id, data: payload })
    } else {
      for (let i = 0; i < quantity; i++) {
        await api.createSpool(payload)
      }
      invalidate()
      setShowForm(false)
      setDuplicating(null)
    }
  }

  const spoolLabel = (s: Spool) => `${s.brand} ${s.material}${s.color_name ? ` · ${s.color_name}` : ''}`
  // Archive / restore without a prompt, but with an undo message (8 s).
  const archiveSpool = (s: Spool) => archiveMut.mutate(s.id, {
    onSuccess: () => toast({
      message: t('spools.archivedToast', { name: spoolLabel(s) }),
      actionLabel: t('common.undo'),
      onAction: () => unarchiveMut.mutate(s.id),
    }),
  })
  const unarchiveSpool = (s: Spool) => unarchiveMut.mutate(s.id, {
    onSuccess: () => toast({
      message: t('spools.unarchivedToast', { name: spoolLabel(s) }),
      actionLabel: t('common.undo'),
      onAction: () => archiveMut.mutate(s.id),
    }),
  })
  const handleDelete = async (spool: Spool) => {
    const choice = await choose({
      title: t('spools.confirmDelete', { brand: spool.brand, color: spool.color_name }),
      message: t('spools.deleteHint'),
      danger: true,
      altLabel: spool.archived ? undefined : t('spools.actions.archive'),
    })
    if (choice === 'confirm') deleteMut.mutate(spool.id)
    else if (choice === 'alt') archiveSpool(spool)
  }

  const anyModal = !!(showForm || editing || duplicating || auditSpool || weighing || moistureSpool || labelIds)
  // Esc closes the detail column (the phone sheet handles Esc itself)
  useEffect(() => {
    if (!selected || !isLaptop || anyModal) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.key === 'Escape' && !(el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName))) setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, isLaptop, anyModal])

  const viewActions: ViewActions = {
    select: s => setSelectedId(s.id),
    weigh: s => setWeighing(s),
    moisture: s => setMoistureSpool(s),
    label: s => setLabelIds([s.id]),
  }
  const detailActions: DetailActions = {
    edit: s => setEditing(s),
    weigh: s => setWeighing(s),
    moisture: s => setMoistureSpool(s),
    label: s => setLabelIds([s.id]),
    history: s => setAuditSpool(s),
    duplicate: s => setDuplicating(s),
    remove: handleDelete,
    archive: archiveSpool,
    unarchive: unarchiveSpool,
    assignSlot: (s, slot) => assignSlotMut.mutate({ id: s.id, slot }),
  }
  const toggleSortKey = (key: SortKey) =>
    setSort(sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir(key) })

  return (
    <div className="flex flex-col gap-3 h-full">
      <SpoolToolbar
        filter={filter}
        onFilter={setFilter}
        counts={counts}
        materials={materials}
        locations={locations}
        view={view}
        onView={setView}
        sort={sort}
        onSort={setSort}
        onAdd={() => setShowForm(true)}
        onInventory={downloadInventory}
        inventoryBusy={inventoryBusy}
        onLabels={() => { setLabelPick(true); setLabelIds([]) }}
        total={shown.length}
        kg={totalKg}
        value={totalValue}
        fmtCurrency={fmtCurrency}
      />

      {isLoading && <p className="text-gray-500 text-sm">{t('common.loading')}</p>}

      <div className="flex-1 min-h-0 flex gap-4">
        <div className="flex-1 min-w-0 overflow-y-auto">
          {!isLoading && shown.length === 0 ? (
            <p className="text-gray-500 text-sm py-6 text-center">{spools.length === 0 ? t('spools.noSpools') : t('spools.noMatch')}</p>
          ) : view === 'cards' ? (
            <SpoolTiles spools={shown} selectedId={selectedId} lowPct={lowPct} actions={viewActions} />
          ) : (
            <SpoolList spools={shown} selectedId={selectedId} lowPct={lowPct} sort={sort} onSortKey={toggleSortKey} actions={viewActions} />
          )}
        </div>
        {selected && isLaptop && (
          <SpoolDetailColumn spool={selected} spools={spools} lowPct={lowPct} actions={detailActions} onClose={() => setSelectedId(null)} sheet={false} />
        )}
      </div>
      {selected && !isLaptop && (
        <SpoolDetailSheet spool={selected} spools={spools} lowPct={lowPct} actions={detailActions} onClose={() => setSelectedId(null)} />
      )}

      {labelIds && (
        <Modal>
          <LabelModal
            spools={labelPick ? shown : spools.filter(s => labelIds.includes(s.id))}
            initialIds={labelIds}
            onClose={() => { setLabelIds(null); setLabelPick(false) }}
          />
        </Modal>
      )}

      {editing && (
        <Modal>
          <SpoolForm
            initial={editing}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {showForm && (
        <Modal>
          <SpoolForm
            isNew
            onSave={handleSave}
            onCancel={() => setShowForm(false)}
          />
        </Modal>
      )}

      {duplicating && (
        <Modal>
          <SpoolForm
            isNew
            initial={{
              ...duplicating,
              purchase_price: null,
              purchased_at: null,
              purchase_location: null,
              storage_location: null,
              article_number: null,
              ams_slot: null,
              // Whether THIS purchase was a refill pack is specific to each
              // physical spool bought — must not silently carry over from
              // the source spool being duplicated (issue #72).
              is_refill_pack: false,
            }}
            onSave={handleSave}
            onCancel={() => setDuplicating(null)}
          />
        </Modal>
      )}

      {auditSpool && (
        <Modal>
          <SpoolAuditModal spool={auditSpool} onClose={() => setAuditSpool(null)} />
        </Modal>
      )}

      {weighing && (
        <Modal>
          <WeighModal spool={weighing} onClose={() => setWeighing(null)} />
        </Modal>
      )}

      {moistureSpool && (
        <Modal>
          <MoistureModal spool={moistureSpool} onClose={() => setMoistureSpool(null)} />
        </Modal>
      )}
    </div>
  )
}
