import { useState, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/ui/Feedback'
import { api } from '../../api'
import type { FilamentSubtype, FilamentCatalog } from '../../types'
import { Plus, Trash2, X, Pencil, ChevronDown, ChevronUp, ChevronsUpDown, Download, Upload } from 'lucide-react'

// ── Filament Catalog Section ──────────────────────────────────────────────────

type CatalogEntry = Omit<FilamentCatalog, 'id' | 'created_at' | 'updated_at'>

const EMPTY_CATALOG: CatalogEntry = {
  brand: '', material: '', subtype: null, subtype2: null,
  color_name: '', color_hex: '#888888',
  color2_hex: null, color3_hex: null, color4_hex: null,
  article_number: null,
}

type CatalogSortKey = 'brand' | 'material' | 'subtype' | 'subtype2' | 'color_name' | 'color_hex' | 'color2_hex' | 'color3_hex' | 'color4_hex' | 'article_number'
type CatalogSortDir = 'asc' | 'desc'

function CatalogSortIcon({ col, sort }: { col: CatalogSortKey; sort: { key: CatalogSortKey; dir: CatalogSortDir } }) {
  if (sort.key !== col) return <ChevronsUpDown size={12} className="text-gray-600" />
  return sort.dir === 'asc'
    ? <ChevronUp size={12} className="text-accent" />
    : <ChevronDown size={12} className="text-accent" />
}

// Module-level component — NOT defined inside FilamentDataSection to avoid remount on every render
function CatalogEditRow({ entry, editForm, setEditForm, onSave, onCancel, brands, materials, subtypes, actionsLast, propagate, onPropagateChange }: {
  entry: FilamentCatalog
  editForm: CatalogEntry
  setEditForm: (f: CatalogEntry) => void
  onSave: () => void
  onCancel: () => void
  brands: FilamentSubtype[]
  materials: FilamentSubtype[]
  subtypes: FilamentSubtype[]
  actionsLast: boolean
  propagate: boolean
  onPropagateChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  const set = (k: keyof CatalogEntry, v: string) => setEditForm({ ...editForm, [k]: v })
  const hexValid = /^#[0-9a-fA-F]{6}$/.test(editForm.color_hex)
  const canSave = editForm.brand.trim() && editForm.material.trim() && editForm.color_name.trim() && hexValid
  const colSpan = 11 // actions + 10 data columns
  const actionCell = (
    <td className="px-2 py-1">
      <div className="flex gap-1">
        <button className="btn-primary text-xs px-2 py-0.5" onClick={onSave} disabled={!canSave}>{t('common.save')}</button>
        <button className="btn-ghost text-xs px-2 py-0.5" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </td>
  )
  return (
    <>
      <tr className="bg-surface-2">
        {!actionsLast && actionCell}
        <td className="px-2 py-1"><select className="input text-xs py-0.5 w-full" value={editForm.brand} onChange={e => set('brand', e.target.value)}>
          <option value="">—</option>{brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
        </select></td>
        <td className="px-2 py-1"><select className="input text-xs py-0.5 w-full" value={editForm.material} onChange={e => set('material', e.target.value)}>
          <option value="">—</option>{materials.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select></td>
        <td className="px-2 py-1"><select className="input text-xs py-0.5 w-full" value={editForm.subtype ?? ''} onChange={e => set('subtype', e.target.value)}>
          <option value="">—</option>{subtypes.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select></td>
        <td className="px-2 py-1"><select className="input text-xs py-0.5 w-full" value={editForm.subtype2 ?? ''} onChange={e => set('subtype2', e.target.value)}>
          <option value="">—</option>{subtypes.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select></td>
        <td className="px-2 py-1"><input className="input text-xs py-0.5 w-full" value={editForm.color_name} onChange={e => set('color_name', e.target.value)} /></td>
        <td className="px-2 py-1">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <input type="color" className="w-6 h-6 rounded cursor-pointer border border-surface-3 bg-transparent p-0 shrink-0" value={editForm.color_hex} onChange={e => set('color_hex', e.target.value)} />
              <div className="flex items-center">
                <span className="px-1.5 py-0.5 text-xs text-gray-400 bg-surface-3 border border-r-0 border-surface-3 rounded-l select-none">#</span>
                <input className={`input text-xs py-0.5 w-16 font-mono rounded-l-none ${!hexValid ? 'border-crit focus:border-crit' : ''}`} value={editForm.color_hex.replace(/^#/, '')} onChange={e => set('color_hex', '#' + e.target.value.replace(/^#/, ''))} maxLength={6} />
              </div>
            </div>
            {(['color2_hex', 'color3_hex', 'color4_hex'] as const).map(k => (
              <div key={k} className="flex items-center gap-1">
                <input type="color" className="w-6 h-6 rounded cursor-pointer border border-surface-3 bg-transparent p-0 shrink-0"
                  value={/^#[0-9a-fA-F]{6}$/.test(editForm[k] ?? '') ? editForm[k]! : '#888888'}
                  onChange={e => setEditForm({ ...editForm, [k]: e.target.value })} />
                <div className="flex items-center">
                  <span className="px-1.5 py-0.5 text-xs text-gray-400 bg-surface-3 border border-r-0 border-surface-3 rounded-l select-none">#</span>
                  <input className="input text-xs py-0.5 w-16 font-mono rounded-l-none"
                    value={(editForm[k] ?? '').replace(/^#/, '')}
                    onChange={e => setEditForm({ ...editForm, [k]: e.target.value ? '#' + e.target.value.replace(/^#/, '') : null })}
                    placeholder="opt" maxLength={6} />
                </div>
                {editForm[k] && (
                  <button type="button" className="text-gray-600 hover:text-crit p-0.5"
                    onClick={() => setEditForm({ ...editForm, [k]: null })}>
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </td>
        <td className="px-2 py-1"><input className="input text-xs py-0.5 w-full" value={editForm.article_number ?? ''} onChange={e => set('article_number', e.target.value)} /></td>
        {actionsLast && actionCell}
      </tr>
      <tr className="border-b border-surface-3 bg-surface-2">
        <td colSpan={colSpan} className="px-2 pb-2">
          <label className={`flex items-center gap-2 text-xs cursor-pointer ${!editForm.article_number ? 'opacity-40 cursor-not-allowed' : ''}`}>
            <input
              type="checkbox"
              checked={propagate && !!editForm.article_number}
              disabled={!editForm.article_number}
              onChange={e => onPropagateChange(e.target.checked)}
              className="accent-accent"
            />
            {t('settings.catalog.propagateToSpools', { article: editForm.article_number || '—' })}
          </label>
        </td>
      </tr>
    </>
  )
}

export function FilamentDataSection({ actionsLast }: { actionsLast: boolean }) {
  const toast = useToast()
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<CatalogEntry>({ ...EMPTY_CATALOG })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<CatalogEntry>({ ...EMPTY_CATALOG })
  const [importResult, setImportResult] = useState<{ added: number; updated: number } | null>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)
  const [sort, setSort] = useState<{ key: CatalogSortKey; dir: CatalogSortDir }>({ key: 'brand', dir: 'asc' })
  const [filters, setFilters] = useState<Partial<Record<CatalogSortKey, string>>>({})
  const [propagate, setPropagate] = useState(() => localStorage.getItem('fm_catalog_propagate') === 'true')

  const handlePropagateChange = (v: boolean) => {
    setPropagate(v)
    localStorage.setItem('fm_catalog_propagate', String(v))
  }

  const setFilter = (k: CatalogSortKey, v: string) => setFilters(f => ({ ...f, [k]: v }))
  const toggleSort = (k: CatalogSortKey) =>
    setSort(s => s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' })

  const { data: catalog = [] } = useQuery<FilamentCatalog[]>({
    queryKey: ['filament-catalog'],
    queryFn: api.getFilamentCatalog,
  })
  const { data: brands = [] } = useQuery<FilamentSubtype[]>({
    queryKey: ['filament-brands'], queryFn: api.getFilamentBrands,
  })
  const { data: materials = [] } = useQuery<FilamentSubtype[]>({
    queryKey: ['filament-materials'], queryFn: api.getFilamentMaterials,
  })
  const { data: subtypes = [] } = useQuery<FilamentSubtype[]>({
    queryKey: ['filament-subtypes'], queryFn: api.getFilamentSubtypes,
  })

  const inv = () => qc.invalidateQueries({ queryKey: ['filament-catalog'] })

  const createMut = useMutation({
    mutationFn: () => api.createFilamentCatalog({
      ...form,
      subtype: form.subtype || null,
      subtype2: form.subtype2 || null,
      article_number: form.article_number || null,
    }),
    onSuccess: () => { inv(); setForm({ ...EMPTY_CATALOG }); setShowAdd(false) },
  })
  const updateMut = useMutation({
    mutationFn: (id: number) => api.updateFilamentCatalog(id, {
      ...editForm,
      subtype: editForm.subtype || null,
      subtype2: editForm.subtype2 || null,
      article_number: editForm.article_number || null,
      propagate_to_spools: propagate && !!editForm.article_number,
    }),
    onSuccess: () => {
      inv()
      if (propagate && editForm.article_number) qc.invalidateQueries({ queryKey: ['spools'] })
      setEditingId(null)
    },
  })
  const deleteMut = useMutation({ mutationFn: api.deleteFilamentCatalog, onSuccess: inv })

  const importMut = useMutation({
    mutationFn: api.importFilamentCatalog,
    onSuccess: (result) => { inv(); setImportResult(result) },
  })

  const handleExportCatalogCsv = () => {
    const header = ['Brand', 'Material', 'Subtype', 'Subtype 2', 'Color name', 'Article number', 'Hex-Code']
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`
    const body = catalog.map(e => [
      q(e.brand),
      q(e.material),
      q(e.subtype ?? ''),
      q(e.subtype2 ?? ''),
      q(e.color_name),
      q(e.article_number ?? ''),
      q(e.color_hex),
    ].join(';'))
    const csv = '\uFEFF' + [header.join(';'), ...body].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `filament_catalog_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCsvFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      // Strip UTF-8 BOM (Excel UTF-8 exports include it)
      const text = (e.target?.result as string).replace(/^\uFEFF/, '')
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length < 1) return
      // Detect delimiter from first line
      const delim = lines[0].includes(';') ? ';' : ','
      // Strip surrounding quotes — handles Excel-quoted cells
      const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '')
      // Fixed column order: Brand;Material;Subtype;Subtype 2;Color name;Article number;Hex-Code
      // Skip header row if first cell is "brand" (exported files include a header)
      const dataLines = unquote(lines[0].split(delim)[0]).toLowerCase() === 'brand'
        ? lines.slice(1)
        : lines
      const rows = dataLines.map(line => {
        const c = line.split(delim).map(unquote)
        return {
          brand:          c[0] ?? '',
          material:       c[1] ?? '',
          subtype:        c[2] || null,
          subtype2:       c[3] || null,
          color_name:     c[4] ?? '',
          article_number: c[5] || null,
          color_hex:      c[6] ? `#${c[6].replace(/^#/, '')}` : '#888888',
        }
      }).filter(r => r.brand && r.material && r.color_name)
      if (rows.length > 0) {
        importMut.mutate(rows)
      } else {
        toast.error(t('settings.filamentCatalog.importNoRows'))
      }
    }
    reader.readAsText(file, 'UTF-8')
  }

  const startEdit = (e: FilamentCatalog) => {
    setEditingId(e.id)
    setEditForm({ brand: e.brand, material: e.material, subtype: e.subtype ?? '', subtype2: e.subtype2 ?? '', color_name: e.color_name, color_hex: e.color_hex, color2_hex: e.color2_hex ?? null, color3_hex: e.color3_hex ?? null, color4_hex: e.color4_hex ?? null, article_number: e.article_number ?? '' })
  }

  const addHexValid = /^#[0-9a-fA-F]{6}$/.test(form.color_hex)
  const canAdd = form.brand.trim() && form.material.trim() && form.color_name.trim() && addHexValid

  const processed = useMemo(() => {
    let rows = [...catalog]
    for (const [k, v] of Object.entries(filters)) {
      if (!v) continue
      const lower = v.toLowerCase()
      rows = rows.filter(e => {
        const val = e[k as keyof FilamentCatalog]
        if (val == null) return false
        return String(val).toLowerCase().includes(lower)
      })
    }
    rows.sort((a, b) => {
      const av = a[sort.key] ?? ''
      const bv = b[sort.key] ?? ''
      const cmp = String(av).localeCompare(String(bv))
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [catalog, sort, filters])

  const hasFilter = Object.values(filters).some(v => v)

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 bg-surface pb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300">{t('settings.filamentCatalog.title')}</h3>
        <div className="flex items-center gap-2">
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) { handleCsvFile(f); e.target.value = '' } }}
          />
          <button
            className="btn-ghost text-xs px-2 py-1 flex items-center gap-1"
            onClick={handleExportCatalogCsv}
            disabled={catalog.length === 0}
          >
            <Download size={12} /> {t('settings.filamentCatalog.exportCsv')}
          </button>
          <button
            className="btn-ghost text-xs px-2 py-1 flex items-center gap-1"
            onClick={() => { setImportResult(null); csvInputRef.current?.click() }}
            disabled={importMut.isPending}
          >
            <Upload size={12} /> {t('settings.filamentCatalog.importCsv')}
          </button>
          <button
            className="btn-primary text-xs px-2 py-1 flex items-center gap-1"
            onClick={() => { setShowAdd(v => !v); setEditingId(null) }}
          >
            <Plus size={12} /> {t('common.add')}
          </button>
        </div>
      </div>

      {importResult && (
        <div className="text-xs px-3 py-2 rounded bg-ok/15 border border-ok/40 text-ok flex items-center justify-between">
          <span>{t('settings.filamentCatalog.importResult', { added: importResult.added, updated: importResult.updated })}</span>
          <button className="ml-4 text-ok hover:text-white" onClick={() => setImportResult(null)}>✕</button>
        </div>
      )}

      {/* Add form — shown above the table, not inside it */}
      {showAdd && (
        <div className="card space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="label text-xs">{t('settings.filamentCatalog.brand')} *</label>
              <select className="input text-xs py-1 w-full" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}>
                <option value="">—</option>
                {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">{t('settings.filamentCatalog.material')} *</label>
              <select className="input text-xs py-1 w-full" value={form.material} onChange={e => setForm(f => ({ ...f, material: e.target.value }))}>
                <option value="">—</option>
                {materials.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">{t('settings.filamentCatalog.subtype')}</label>
              <select className="input text-xs py-1 w-full" value={form.subtype ?? ''} onChange={e => setForm(f => ({ ...f, subtype: e.target.value }))}>
                <option value="">—</option>
                {subtypes.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">{t('settings.filamentCatalog.subtype2')}</label>
              <select className="input text-xs py-1 w-full" value={form.subtype2 ?? ''} onChange={e => setForm(f => ({ ...f, subtype2: e.target.value }))}>
                <option value="">—</option>
                {subtypes.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="label text-xs">{t('settings.filamentCatalog.colorName')} *</label>
              <input className="input text-xs py-1 w-full" value={form.color_name} onChange={e => setForm(f => ({ ...f, color_name: e.target.value }))} placeholder="Black" />
            </div>
            <div>
              <label className="label text-xs">{t('settings.filamentCatalog.colorHex')}</label>
              <div className="flex items-center gap-2">
                <input type="color" className="w-8 h-8 rounded cursor-pointer border border-surface-3 bg-transparent p-0.5 shrink-0" value={form.color_hex} onChange={e => setForm(f => ({ ...f, color_hex: e.target.value }))} />
                <div className="flex items-center flex-1">
                  <span className="px-2 py-1 text-xs text-gray-400 bg-surface-3 border border-r-0 border-surface-3 rounded-l select-none">#</span>
                  <input className={`input text-xs py-1 font-mono flex-1 rounded-l-none ${!addHexValid ? 'border-crit focus:border-crit' : ''}`} value={form.color_hex.replace(/^#/, '')} onChange={e => setForm(f => ({ ...f, color_hex: '#' + e.target.value.replace(/^#/, '') }))} maxLength={6} />
                </div>
              </div>
            </div>
            <div>
              <label className="label text-xs">{t('settings.filamentCatalog.articleNumber')}</label>
              <input className="input text-xs py-1 w-full" value={form.article_number ?? ''} onChange={e => setForm(f => ({ ...f, article_number: e.target.value }))} placeholder="BL-PLA-BK-1KG" />
            </div>
            <div className="flex items-end gap-2">
              <button className="btn-primary text-xs px-3 py-1.5" onClick={() => createMut.mutate()} disabled={!canAdd || createMut.isPending}>
                {t('common.add')}
              </button>
              <button className="btn-ghost text-xs px-3 py-1.5" onClick={() => { setShowAdd(false); setForm({ ...EMPTY_CATALOG }) }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['color2_hex', 'color3_hex', 'color4_hex'] as const).map(k => (
              <div key={k}>
                <label className="label text-xs">{t(`settings.filamentCatalog.${k}`)}</label>
                <div className="flex items-center gap-1">
                  <input type="color" className="w-8 h-8 rounded cursor-pointer border border-surface-3 bg-transparent p-0.5 shrink-0"
                    value={/^#[0-9a-fA-F]{6}$/.test(form[k] ?? '') ? form[k]! : '#888888'}
                    onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
                  <div className="flex items-center flex-1">
                    <span className="px-2 py-1 text-xs text-gray-400 bg-surface-3 border border-r-0 border-surface-3 rounded-l select-none">#</span>
                    <input className="input text-xs py-1 font-mono flex-1 rounded-l-none"
                      value={(form[k] ?? '').replace(/^#/, '')}
                      onChange={e => setForm(f => ({ ...f, [k]: e.target.value ? '#' + e.target.value.replace(/^#/, '') : null }))}
                      placeholder={t('common.optional')} maxLength={6} />
                  </div>
                  {form[k] && (
                    <button type="button" className="text-gray-600 hover:text-crit p-0.5"
                      onClick={() => setForm(f => ({ ...f, [k]: null }))}>
                      <X size={10} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-surface-3 bg-surface-2">
        <table className="w-full text-xs text-left" style={{ minWidth: '700px' }}>
          <thead>
            <tr className="border-b border-surface-3">
              {!actionsLast && <th className="sticky top-0 z-10 px-3 py-2 w-16 bg-surface-2" />}
              {([
                ['brand',          t('settings.filamentCatalog.brand')],
                ['material',       t('settings.filamentCatalog.material')],
                ['subtype',        t('settings.filamentCatalog.subtype')],
                ['subtype2',       t('settings.filamentCatalog.subtype2')],
                ['color_name',     t('settings.filamentCatalog.colorName')],
                ['color_hex',      t('settings.filamentCatalog.colorHex')],
                ['color2_hex',     t('settings.filamentCatalog.color2_hex')],
                ['color3_hex',     t('settings.filamentCatalog.color3_hex')],
                ['color4_hex',     t('settings.filamentCatalog.color4_hex')],
                ['article_number', t('settings.filamentCatalog.articleNumber')],
              ] as [CatalogSortKey, string][]).map(([key, label]) => (
                <th
                  key={key}
                  className="sticky top-0 z-10 bg-surface-2 px-3 py-2 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white"
                  onClick={() => toggleSort(key)}
                >
                  <span className="flex items-center gap-1">
                    {label} <CatalogSortIcon col={key} sort={sort} />
                  </span>
                </th>
              ))}
              {actionsLast && <th className="sticky top-0 z-10 px-3 py-2 w-16 bg-surface-2" />}
            </tr>
            <tr className="border-b border-surface-3">
              {!actionsLast && (
                <td className="sticky top-9 z-10 bg-surface-3 px-2 py-1">
                  <button
                    className="text-xs text-gray-500 hover:text-white"
                    onClick={() => setFilters({})}
                    title={t('common.clear')}
                  >✕</button>
                </td>
              )}
              {(['brand', 'material', 'subtype', 'subtype2', 'color_name', 'color_hex', 'color2_hex', 'color3_hex', 'color4_hex', 'article_number'] as CatalogSortKey[]).map(key => (
                <td key={key} className="sticky top-9 z-10 bg-surface-3 px-2 py-1">
                  <input
                    className="w-full bg-surface-3 rounded px-2 py-0.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="filter…"
                    value={filters[key] ?? ''}
                    onChange={e => setFilter(key, e.target.value)}
                  />
                </td>
              ))}
              {actionsLast && (
                <td className="sticky top-9 z-10 bg-surface-3 px-2 py-1">
                  <button
                    className="text-xs text-gray-500 hover:text-white"
                    onClick={() => setFilters({})}
                    title={t('common.clear')}
                  >✕</button>
                </td>
              )}
            </tr>
          </thead>
          <tbody>
            {processed.length === 0 && (
              <tr><td colSpan={11} className="text-xs text-gray-500 py-4 px-3">
                {hasFilter ? t('settings.filamentCatalog.noResults') : t('settings.filamentCatalog.noEntries')}
              </td></tr>
            )}
            {processed.map(entry => editingId === entry.id ? (
              <CatalogEditRow
                key={entry.id}
                entry={entry}
                editForm={editForm}
                setEditForm={setEditForm}
                onSave={() => updateMut.mutate(entry.id)}
                onCancel={() => setEditingId(null)}
                brands={brands}
                materials={materials}
                subtypes={subtypes}
                actionsLast={actionsLast}
                propagate={propagate}
                onPropagateChange={handlePropagateChange}
              />
            ) : (
              <tr key={entry.id} className="border-b border-surface-3/50 hover:bg-surface-3/40 transition-colors">
                {!actionsLast && (
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex gap-1">
                      <button className="btn-ghost p-1 text-gray-400 hover:text-white" onClick={() => startEdit(entry)}><Pencil size={12} /></button>
                      <button className="btn-ghost p-1 text-crit hover:text-crit" onClick={() => deleteMut.mutate(entry.id)}><Trash2 size={12} /></button>
                    </div>
                  </td>
                )}
                <td className="px-3 py-2 font-medium text-white whitespace-nowrap">{entry.brand}</td>
                <td className="px-3 py-2 whitespace-nowrap">{entry.material}</td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-400">{entry.subtype ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-400">{entry.subtype2 ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/10" style={{ background: entry.color_hex }} />
                    {entry.color_name}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap font-mono text-gray-400">{entry.color_hex}</td>
                <td className="px-3 py-2">{entry.color2_hex ? <span className="w-4 h-4 rounded-full block ring-1 ring-white/10" style={{ background: entry.color2_hex }} /> : <span className="text-gray-600">—</span>}</td>
                <td className="px-3 py-2">{entry.color3_hex ? <span className="w-4 h-4 rounded-full block ring-1 ring-white/10" style={{ background: entry.color3_hex }} /> : <span className="text-gray-600">—</span>}</td>
                <td className="px-3 py-2">{entry.color4_hex ? <span className="w-4 h-4 rounded-full block ring-1 ring-white/10" style={{ background: entry.color4_hex }} /> : <span className="text-gray-600">—</span>}</td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-400">{entry.article_number ?? '—'}</td>
                {actionsLast && (
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex gap-1">
                      <button className="btn-ghost p-1 text-gray-400 hover:text-white" onClick={() => startEdit(entry)}><Pencil size={12} /></button>
                      <button className="btn-ghost p-1 text-crit hover:text-crit" onClick={() => deleteMut.mutate(entry.id)}><Trash2 size={12} /></button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
