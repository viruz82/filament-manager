import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '../../components/ui/Feedback'
import { api } from '../../api'
import type { BrandSpoolWeight, FilamentSubtype } from '../../types'
import { Plus, Trash2, X, Pencil, ArrowDownToLine } from 'lucide-react'
import { fmtNum } from '../../utils/number'

// ── Brand Spool Weights ───────────────────────────────────────────────────────

export function BrandWeightsSection({ actionsLast }: { actionsLast: boolean }) {
  const { confirm } = useConfirm()
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [newBrand, setNewBrand] = useState('')
  const [newWeight, setNewWeight] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editBrand, setEditBrand] = useState('')
  const [editWeight, setEditWeight] = useState('')

  const { data: entries = [] } = useQuery<BrandSpoolWeight[]>({
    queryKey: ['brand-weights'],
    queryFn: api.getBrandWeights,
  })
  // Suggestions: brands from the brand list that have no weight yet (free text stays possible for variants)
  const { data: brandList = [] } = useQuery<FilamentSubtype[]>({
    queryKey: ['filament-brands-suggest'],
    queryFn: api.getFilamentBrands,
  })
  const brandOptions = brandList.filter(b => !entries.some(e => e.brand.toLowerCase() === b.name.toLowerCase()))

  const inv = () => qc.invalidateQueries({ queryKey: ['brand-weights'] })

  const createMut = useMutation({
    mutationFn: () => api.createBrandWeight({ brand: newBrand.trim(), spool_weight_g: parseFloat(newWeight) }),
    onSuccess: () => { inv(); setNewBrand(''); setNewWeight('') },
  })
  const updateMut = useMutation({
    mutationFn: ({ id }: { id: number }) =>
      api.updateBrandWeight(id, { brand: editBrand.trim(), spool_weight_g: parseFloat(editWeight) }),
    onSuccess: () => { inv(); setEditingId(null) },
  })
  const deleteMut = useMutation({ mutationFn: api.deleteBrandWeight, onSuccess: inv })
  const [applied, setApplied] = useState<{ id: number; updated: number } | null>(null)
  const applyMut = useMutation({
    mutationFn: (id: number) => api.applyBrandWeight(id),
    onSuccess: (data, id) => { setApplied({ id, updated: data.updated }); qc.invalidateQueries({ queryKey: ['spools'] }) },
  })
  const confirmApply = async (e: BrandSpoolWeight) => {
    if (await confirm({ title: t('settings.brandWeights.applyConfirm', { brand: e.brand, g: fmtNum(e.spool_weight_g, 0) }) })) {
      applyMut.mutate(e.id)
    }
  }

  const startEdit = (e: BrandSpoolWeight) => {
    setEditingId(e.id); setEditBrand(e.brand); setEditWeight(e.spool_weight_g.toString())
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-300 mb-1">{t('settings.brandWeights.title')}</h3>
      <p className="text-xs text-gray-500 mb-3">{t('settings.brandWeights.hint')}</p>

      <div className="card space-y-2">
        <datalist id="fm-brand-names">
          {brandOptions.map(b => <option key={b.id} value={b.name} />)}
        </datalist>
        <div className="flex items-center gap-2 pb-2 border-b border-surface-3">
          <input
            className="input flex-1 text-sm py-1"
            value={newBrand}
            onChange={e => setNewBrand(e.target.value)}
            placeholder={t('settings.brandWeights.brandPlaceholder')}
            list="fm-brand-names"
            autoComplete="off"
            onKeyDown={e => e.key === 'Enter' && newBrand.trim() && newWeight && createMut.mutate()}
          />
          <input
            className="input w-24 text-sm py-1 text-right"
            type="number" min="0" step="1"
            value={newWeight}
            onChange={e => setNewWeight(e.target.value)}
            placeholder="250"
          />
          <span className="text-xs text-gray-500 shrink-0">g</span>
          <button
            className="btn-primary text-xs px-2 py-1 flex items-center gap-1 shrink-0"
            onClick={() => createMut.mutate()}
            disabled={!newBrand.trim() || !newWeight || createMut.isPending}
          >
            <Plus size={12} /> {t('common.add')}
          </button>
        </div>

        <div className="overflow-y-auto max-h-64 space-y-2">
        {entries.length === 0 && (
          <p className="text-xs text-gray-500 py-1">{t('settings.brandWeights.noEntries')}</p>
        )}

        {entries.map(e => (
          <div key={e.id} className="flex items-center gap-2">
            {editingId === e.id ? (
              <>
                <input
                  className="input flex-1 text-sm py-1"
                  value={editBrand}
                  onChange={ev => setEditBrand(ev.target.value)}
                  placeholder={t('settings.brandWeights.brand')}
                  list="fm-brand-names"
                  autoComplete="off"
                  autoFocus
                />
                <input
                  className="input w-24 text-sm py-1 text-right"
                  type="number" min="0" step="1"
                  value={editWeight}
                  onChange={ev => setEditWeight(ev.target.value)}
                />
                <span className="text-xs text-gray-500 shrink-0">g</span>
                <button
                  className="btn-primary text-xs px-2 py-1"
                  onClick={() => updateMut.mutate({ id: e.id })}
                  disabled={!editBrand || !editWeight}
                >
                  {t('common.save')}
                </button>
                <button className="btn-ghost p-1" onClick={() => setEditingId(null)}><X size={12} /></button>
              </>
            ) : (
              <>
                {!actionsLast && (
                  <>
                    <button className="btn-ghost p-1" onClick={() => startEdit(e)}><Pencil size={12} /></button>
                    <button className="btn-ghost p-1 text-crit" onClick={() => deleteMut.mutate(e.id)}><Trash2 size={12} /></button>
                  </>
                )}
                <span className="flex-1 min-w-0 text-sm text-white truncate">
                  {e.brand}
                  {applied?.id === e.id && (
                    <span className="ml-2 text-[11px] text-ok">{t('settings.brandWeights.applied', { count: applied.updated })}</span>
                  )}
                </span>
                <span className="text-sm text-gray-300 tabular-nums">{fmtNum(e.spool_weight_g, 0)} g</span>
                <button
                  className="btn-ghost p-1"
                  onClick={() => confirmApply(e)}
                  disabled={applyMut.isPending}
                  title={t('settings.brandWeights.apply')}
                  aria-label={t('settings.brandWeights.apply')}
                >
                  <ArrowDownToLine size={12} />
                </button>
                {actionsLast && (
                  <>
                    <button className="btn-ghost p-1" onClick={() => startEdit(e)}><Pencil size={12} /></button>
                    <button className="btn-ghost p-1 text-crit" onClick={() => deleteMut.mutate(e.id)}><Trash2 size={12} /></button>
                  </>
                )}
              </>
            )}
          </div>
        ))}
        </div>
      </div>
    </div>
  )
}

// ── Generic name-list section (subtypes / materials / brands) ─────────────────

export function NameListSection({
  title,
  hint,
  queryKey,
  fetchFn,
  createFn,
  updateFn,
  deleteFn,
  placeholder,
  noEntries,
  actionsLast,
}: {
  title: string
  hint?: string
  queryKey: string
  fetchFn: () => Promise<FilamentSubtype[]>
  createFn: (name: string) => Promise<FilamentSubtype>
  updateFn: (id: number, name: string) => Promise<FilamentSubtype>
  deleteFn: (id: number) => Promise<void>
  placeholder: string
  noEntries: string
  actionsLast: boolean
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')

  const { data: entries = [] } = useQuery<FilamentSubtype[]>({
    queryKey: [queryKey],
    queryFn: fetchFn,
  })

  const inv = () => qc.invalidateQueries({ queryKey: [queryKey] })

  const createMut = useMutation({
    mutationFn: () => createFn(newName.trim()),
    onSuccess: () => { inv(); setNewName('') },
  })
  const updateMut = useMutation({
    mutationFn: ({ id }: { id: number }) => updateFn(id, editName.trim()),
    onSuccess: () => { inv(); setEditingId(null) },
  })
  const deleteMut = useMutation({ mutationFn: deleteFn, onSuccess: inv })

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-300 mb-1">{title}</h3>
      {hint && <p className="text-xs text-gray-500 mb-3">{hint}</p>}

      <div className="card space-y-2">
        <div className="flex items-center gap-2 pb-2 border-b border-surface-3">
          <input
            className="input flex-1 text-sm py-1"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={placeholder}
            onKeyDown={e => e.key === 'Enter' && newName.trim() && createMut.mutate()}
          />
          <button
            className="btn-primary text-xs px-2 py-1 flex items-center gap-1 shrink-0"
            onClick={() => createMut.mutate()}
            disabled={!newName.trim() || createMut.isPending}
          >
            <Plus size={12} /> {t('common.add')}
          </button>
        </div>

        <div className="overflow-y-auto max-h-64 space-y-2">
        {entries.length === 0 && (
          <p className="text-xs text-gray-500 py-1">{noEntries}</p>
        )}

        {entries.map(e => (
          <div key={e.id} className="flex items-center gap-2">
            {editingId === e.id ? (
              <>
                <input
                  className="input flex-1 text-sm py-1"
                  value={editName}
                  onChange={ev => setEditName(ev.target.value)}
                  autoFocus
                  onKeyDown={ev => ev.key === 'Enter' && editName.trim() && updateMut.mutate({ id: e.id })}
                />
                <button
                  className="btn-primary text-xs px-2 py-1"
                  onClick={() => updateMut.mutate({ id: e.id })}
                  disabled={!editName.trim()}
                >{t('common.save')}</button>
                <button className="btn-ghost p-1" onClick={() => setEditingId(null)}><X size={12} /></button>
              </>
            ) : (
              <>
                {!actionsLast && (
                  <>
                    <button className="btn-ghost p-1" onClick={() => { setEditingId(e.id); setEditName(e.name) }}><Pencil size={12} /></button>
                    <button className="btn-ghost p-1 text-crit" onClick={() => deleteMut.mutate(e.id)}><Trash2 size={12} /></button>
                  </>
                )}
                <span className="flex-1 text-sm text-white">{e.name}</span>
                {actionsLast && (
                  <>
                    <button className="btn-ghost p-1" onClick={() => { setEditingId(e.id); setEditName(e.name) }}><Pencil size={12} /></button>
                    <button className="btn-ghost p-1 text-crit" onClick={() => deleteMut.mutate(e.id)}><Trash2 size={12} /></button>
                  </>
                )}
              </>
            )}
          </div>
        ))}
        </div>
      </div>
    </div>
  )
}
