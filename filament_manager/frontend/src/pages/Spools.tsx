import { useState, useMemo, useEffect, lazy, Suspense } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useConfirm, useToast } from '../components/ui/Feedback'
import { api } from '../api'
import type { Spool } from '../types'
import Modal from '../components/Modal'
import { Spinner } from '../components/ui/Loading'
import { useSearchParams } from 'react-router-dom'
import { useCurrencyFormatter, useHACurrency } from '../hooks/useHATZ'
import { saveBlob } from '../utils/download'
import { parseDecimal } from '../utils/number'
import { useMediaQuery } from '../hooks/useMediaQuery'
import SpoolToolbar from '../components/spools/SpoolToolbar'
import type { SpoolView } from '../components/spools/SpoolToolbar'
import { SpoolTiles, SpoolList } from '../components/spools/SpoolViews'
import type { ViewActions } from '../components/spools/SpoolViews'
import { SpoolDetailColumn, SpoolDetailSheet } from '../components/spools/SpoolDetail'
import type { DetailActions } from '../components/spools/SpoolDetail'
import { EMPTY_FILTER, FILTER_PARAM, defaultDir, filterSpools, isLow, isMoist, loadSort, saveSort, sortSpools } from '../components/spools/spoolFilters'
import type { SortKey, SortState, SpoolFilter } from '../components/spools/spoolFilters'
import { EMPTY_FORM, SpoolForm } from '../components/spools/SpoolForm'
import { SpoolAuditModal, MoistureModal, WeighModal } from '../components/spools/SpoolModals'

// Label dialog pulls in niimbluelib + qrcode; only load it when it is opened.
const LabelModal = lazy(() => import('../components/LabelModal'))

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
          <Suspense fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"><Spinner className="" /></div>
          }>
          <LabelModal
            spools={labelPick ? shown : spools.filter(s => labelIds.includes(s.id))}
            initialIds={labelIds}
            onClose={() => { setLabelIds(null); setLabelPick(false) }}
          />
          </Suspense>
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
