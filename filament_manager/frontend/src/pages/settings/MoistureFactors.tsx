import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { Plus, X } from 'lucide-react'

// ── Percent field + moisture factors ─────────────────────────────────────────

export function PctField({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="label text-xs mb-1 block">{label}</label>
      <div className="flex items-center gap-2">
        <input
          className="input text-xs py-1 w-20"
          type="number"
          min={1}
          max={100}
          value={value}
          onChange={e => onChange(Math.max(1, Math.min(100, parseInt(e.target.value) || value)))}
        />
        <span className="text-xs text-gray-400">%</span>
      </div>
      <p className="text-[11px] text-gray-600 mt-0.5">{hint}</p>
    </div>
  )
}

export function MoistureFactorsSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['moisture-settings'], queryFn: api.getMoistureSettings })
  const [materials, setMaterials] = useState<[string, string][]>([])
  const [storage, setStorage] = useState<Record<string, string>>({})
  const [newMat, setNewMat] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!cfg) return
    setMaterials(Object.entries(cfg.material_factors).map(([k, v]) => [k, String(v)]))
    setStorage(Object.fromEntries(Object.entries(cfg.storage_factors).map(([k, v]) => [k, String(v)])))
  }, [cfg])

  const num = (v: string) => parseFloat(v.replace(',', '.'))
  const onDone = () => {
    qc.invalidateQueries({ queryKey: ['moisture-settings'] })
    qc.invalidateQueries({ queryKey: ['spools'] })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  const saveMut = useMutation({
    mutationFn: () => api.saveMoistureFactors({
      material_factors: Object.fromEntries(materials.filter(([k, v]) => k.trim() && !isNaN(num(v))).map(([k, v]) => [k.trim(), num(v)])),
      storage_factors: Object.fromEntries(Object.entries(storage).filter(([, v]) => !isNaN(num(v))).map(([k, v]) => [k, num(v)])),
    }),
    onSuccess: onDone,
  })
  const resetMut = useMutation({ mutationFn: () => api.saveMoistureFactors({}), onSuccess: onDone })

  if (!cfg) return null
  const storageKeys = ['vacuum', 'drybox', 'ams', 'sealed', 'original', 'open', 'unknown']

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-300">{t('settings.moisture.title')}</h3>
        <p className="text-xs text-gray-500 mt-1">
          {t('settings.moisture.formula', { m: cfg.multiplier, d: cfg.default_material_factor })}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <p className="text-xs font-medium text-gray-400 mb-2">{t('settings.moisture.storage')}</p>
          <div className="space-y-1">
            {storageKeys.map(k => (
              <div key={k} className="flex items-center gap-2">
                <span className="text-xs text-gray-300 flex-1 min-w-0 truncate">{t(`moisture.storage.${k}`)}</span>
                <input className="input text-xs py-0.5 w-16 text-right" inputMode="decimal"
                  value={storage[k] ?? ''} onChange={e => setStorage(s => ({ ...s, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-400 mb-2">{t('settings.moisture.material')}</p>
          <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
            {materials.map(([k, v], i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-gray-300 flex-1 min-w-0 truncate">{k}</span>
                <input className="input text-xs py-0.5 w-16 text-right" inputMode="decimal" value={v}
                  onChange={e => setMaterials(m => m.map((row, j) => j === i ? [row[0], e.target.value] : row))} />
                <button className="btn-ghost p-0.5 text-gray-500 hover:text-crit" title={t('common.delete')}
                  onClick={() => setMaterials(m => m.filter((_, j) => j !== i))}><X size={12} /></button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <input className="input text-xs py-0.5 flex-1 min-w-0" placeholder={t('settings.moisture.addMaterial')}
              value={newMat} onChange={e => setNewMat(e.target.value)} />
            <button className="btn-ghost p-1" disabled={!newMat.trim()}
              onClick={() => { setMaterials(m => [...m, [newMat.trim(), String(cfg.default_material_factor)]]); setNewMat('') }}>
              <Plus size={13} />
            </button>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <button className="btn-primary text-xs px-3 py-1.5" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          {t('common.save')}
        </button>
        <button className="btn-ghost text-xs px-3 py-1.5" onClick={() => resetMut.mutate()} disabled={resetMut.isPending}>
          {t('settings.moisture.reset')}
        </button>
        {saved && <span className="text-xs text-ok">✓</span>}
      </div>
    </div>
  )
}
