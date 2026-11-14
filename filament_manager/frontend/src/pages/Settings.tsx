import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '../components/ui/Feedback'
import { api } from '../api'
import type { PrinterConfig } from '../types'
import { Plus } from 'lucide-react'
import Modal from '../components/Modal'
import BambuCloudSection from '../components/BambuCloudSection'
import FilamentSyncSection from '../components/FilamentSyncSection'
import { CloudPrinterStatus } from './settings/CloudPrinterStatus'
import { BrandWeightsSection, NameListSection } from './settings/DataLists'
import { DataTransferSection } from './settings/DataTransfer'
import { FilamentDataSection } from './settings/FilamentCatalog'
import { PctField, MoistureFactorsSection } from './settings/MoistureFactors'
import { PrinterCard } from './settings/PrinterCard'
import { PrinterFormModal } from './settings/PrinterForm'

// ── Page ──────────────────────────────────────────────────────────────────────

type MainTab = 'printers' | 'data' | 'transfer' | 'experiments' | 'appearance'
type DataSubTab = 'brandWeights' | 'brands' | 'materials' | 'subtypes' | 'locations' | 'storageLocations' | 'filamentData'

export default function Settings() {
  const { confirm } = useConfirm()
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [mainTab, setMainTab] = useState<MainTab>('printers')
  const [dataTab, setDataTab] = useState<DataSubTab>('brandWeights')
  const [activePrinterId, setActivePrinterId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<PrinterConfig | null>(null)

  const { data: printers = [] } = useQuery<PrinterConfig[]>({
    queryKey: ['printers'],
    queryFn: api.getPrinters,
  })
  const { data: cloudStatus } = useQuery({
    queryKey: ['bambu-cloud-status'],
    queryFn: api.getBambuCloudStatus,
    refetchInterval: 5_000,
  })
  const { data: versionData } = useQuery({
    queryKey: ['version'],
    queryFn: api.getVersion,
    staleTime: Infinity,
  })

  const isCloudConnected = cloudStatus?.status === 'connected'
  const invalidate = () => qc.invalidateQueries({ queryKey: ['printers'] })

  const createMut = useMutation({ mutationFn: api.createPrinter, onSuccess: () => { invalidate(); setShowForm(false) } })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: unknown }) => api.updatePrinter(id, data),
    onSuccess: () => { invalidate(); setEditing(null) },
  })
  const deleteMut = useMutation({ mutationFn: api.deletePrinter, onSuccess: invalidate })

  const activePrinter = printers.find(p => p.id === activePrinterId) ?? printers[0] ?? null

  const MAIN_TABS: { id: MainTab; label: string; dot?: boolean }[] = [
    { id: 'printers',   label: t('settings.tabs.printers') },
    { id: 'data',       label: t('settings.tabs.data') },
    { id: 'transfer',   label: t('settings.tabs.transfer') },
    { id: 'experiments',label: t('settings.tabs.experiments'), dot: isCloudConnected },
    { id: 'appearance', label: t('settings.tabs.appearance') },
  ]

  const DATA_SUBTABS: { id: DataSubTab; label: string }[] = [
    { id: 'brandWeights', label: t('settings.dataTabs.brandWeights') },
    { id: 'brands',       label: t('settings.dataTabs.brands') },
    { id: 'materials',    label: t('settings.dataTabs.materials') },
    { id: 'subtypes',     label: t('settings.dataTabs.subtypes') },
    { id: 'locations',        label: t('settings.dataTabs.locations') },
    { id: 'storageLocations', label: t('settings.dataTabs.storageLocations') },
    { id: 'filamentData',     label: t('settings.dataTabs.filamentData') },
  ]

  // Experiments tab: all printers with a serial (regardless of source)
  const cloudPrinters = printers.filter(p => p.bambu_serial)

  const isFilamentData = mainTab === 'data' && dataTab === 'filamentData'

  const [actionsLast, setActionsLast] = useState(
    () => localStorage.getItem('fm_actions_last') === 'true'
  )
  const toggleActionsLast = (val: boolean) => {
    setActionsLast(val)
    localStorage.setItem('fm_actions_last', String(val))
  }

  // Regional overrides
  const { data: userPrefs } = useQuery({
    queryKey: ['user-prefs'],
    queryFn: api.getUserPrefs,
    staleTime: Infinity,
  })
  const { data: haLocale } = useQuery({
    queryKey: ['ha-locale'],
    queryFn: api.getHALocale,
    staleTime: Infinity,
  })
  const [tzInput, setTzInput] = useState('')
  const [curInput, setCurInput] = useState('')
  const [ctyInput, setCtyInput] = useState('')
  const [lowStockPct, setLowStockPct] = useState(20)
  const [almostEmptyPct, setAlmostEmptyPct] = useState(8)
  const [moistWarnPct, setMoistWarnPct] = useState(50)
  const [moistCritPct, setMoistCritPct] = useState(25)
  const [prefsSaved, setPrefsSaved] = useState(false)

  // Populate inputs once prefs load
  useEffect(() => {
    if (userPrefs) {
      setTzInput(userPrefs.timezone_override ?? '')
      setCurInput(userPrefs.currency_override ?? '')
      setCtyInput(userPrefs.country_override ?? '')
      setLowStockPct(userPrefs.low_stock_threshold_pct ?? 20)
      setAlmostEmptyPct(userPrefs.almost_empty_threshold_pct ?? 8)
      setMoistWarnPct(userPrefs.moisture_warning_pct ?? 50)
      setMoistCritPct(userPrefs.moisture_critical_pct ?? 25)
    }
  }, [userPrefs])

  const savePrefs = useMutation({
    mutationFn: () => api.saveUserPrefs({
      timezone_override: tzInput.trim() || null,
      currency_override: curInput.trim() || null,
      country_override:  ctyInput.trim() || null,
      low_stock_threshold_pct: lowStockPct,
      almost_empty_threshold_pct: almostEmptyPct,
      moisture_warning_pct: moistWarnPct,
      moisture_critical_pct: moistCritPct,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-prefs'] })
      qc.invalidateQueries({ queryKey: ['spools'] })
      qc.invalidateQueries({ queryKey: ['moisture-settings'] })
      qc.invalidateQueries({ queryKey: ['ha-locale'] })
      setPrefsSaved(true)
      setTimeout(() => setPrefsSaved(false), 2000)
    },
  })

  return (
    <div className={`space-y-4 ${isFilamentData ? '' : 'max-w-2xl'}`}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold">{t('settings.title')}</h2>
        {versionData && <span className="text-xs text-gray-500">v{versionData.version}</span>}
      </div>

      {/* Main tab bar */}
      <div className="flex border-b border-surface-3 gap-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {MAIN_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setMainTab(tab.id)}
            className={`pb-2.5 pt-1 px-2.5 sm:px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 -mb-px ${
              mainTab === tab.id
                ? 'border-accent text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
            {tab.dot && <span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0" />}
          </button>
        ))}
      </div>

      {/* ── Tab: Printers ── */}
      {mainTab === 'printers' && (
        <div className="card">
          <div className="flex justify-end mb-4">
            <button className="btn-primary flex items-center gap-1.5 text-xs" onClick={() => setShowForm(true)}>
              <Plus size={13} /> {t('settings.printers.addPrinter')}
            </button>
          </div>

          {printers.length === 0 ? (
            <p className="text-sm text-gray-500">{t('settings.printers.noPrintersHint')}</p>
          ) : (
            <>
              {printers.length > 1 && (
                <div className="flex border-b border-surface-3 mb-4 gap-0 -mx-5 px-5 overflow-x-auto shrink-0">
                  {printers.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setActivePrinterId(p.id)}
                      className={`pb-2.5 pt-2 px-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                        activePrinter?.id === p.id
                          ? 'border-accent text-white'
                          : 'border-transparent text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}

              {activePrinter && (
                <PrinterCard
                  printer={activePrinter}
                  onEdit={() => setEditing(activePrinter)}
                  onDelete={async () => {
                    if (await confirm({ title: t('settings.printers.confirmDelete', { name: activePrinter.name }), danger: true }))
                      deleteMut.mutate(activePrinter.id)
                  }}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* ── Tab: Data ── */}
      {mainTab === 'data' && (
        <>
          {/* Subtab bar + small-list content stay inside a constrained card */}
          <div className={`card ${isFilamentData ? 'pb-0' : ''}`}>
            {/* Scrollable subtab bar — scrollbar hidden visually */}
            <div
              className="flex border-b border-surface-3 gap-0 -mx-5 px-5 pt-1"
              style={{ overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {DATA_SUBTABS.map(st => (
                <button
                  key={st.id}
                  onClick={() => setDataTab(st.id)}
                  className={`pb-2.5 pt-1 px-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${
                    dataTab === st.id
                      ? 'border-accent text-white'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {!isFilamentData && (
              <div className="mt-5">
                {dataTab === 'brandWeights' && <BrandWeightsSection actionsLast={actionsLast} />}
                {dataTab === 'brands' && (
                  <NameListSection
                    title={t('settings.brands.title')}
                    queryKey="filament-brands"
                    fetchFn={api.getFilamentBrands}
                    createFn={api.createFilamentBrand}
                    updateFn={api.updateFilamentBrand}
                    deleteFn={api.deleteFilamentBrand}
                    placeholder={t('settings.brands.placeholder')}
                    noEntries={t('settings.brands.noEntries')}
                    actionsLast={actionsLast}
                  />
                )}
                {dataTab === 'materials' && (
                  <NameListSection
                    title={t('settings.materials.title')}
                    queryKey="filament-materials"
                    fetchFn={api.getFilamentMaterials}
                    createFn={api.createFilamentMaterial}
                    updateFn={api.updateFilamentMaterial}
                    deleteFn={api.deleteFilamentMaterial}
                    placeholder={t('settings.materials.placeholder')}
                    noEntries={t('settings.materials.noEntries')}
                    actionsLast={actionsLast}
                  />
                )}
                {dataTab === 'subtypes' && (
                  <NameListSection
                    title={t('settings.subtypes.title')}
                    queryKey="filament-subtypes"
                    fetchFn={api.getFilamentSubtypes}
                    createFn={api.createFilamentSubtype}
                    updateFn={api.updateFilamentSubtype}
                    deleteFn={api.deleteFilamentSubtype}
                    placeholder={t('settings.subtypes.placeholder')}
                    noEntries={t('settings.subtypes.noEntries')}
                    actionsLast={actionsLast}
                  />
                )}
                {dataTab === 'locations' && (
                  <NameListSection
                    title={t('settings.purchaseLocations.title')}
                    queryKey="purchase-locations"
                    fetchFn={api.getPurchaseLocations}
                    createFn={api.createPurchaseLocation}
                    updateFn={api.updatePurchaseLocation}
                    deleteFn={api.deletePurchaseLocation}
                    placeholder={t('settings.purchaseLocations.placeholder')}
                    noEntries={t('settings.purchaseLocations.noEntries')}
                    actionsLast={actionsLast}
                  />
                )}
                {dataTab === 'storageLocations' && (
                  <NameListSection
                    title={t('settings.storageLocations.title')}
                    queryKey="storage-locations"
                    fetchFn={api.getStorageLocations}
                    createFn={api.createStorageLocation}
                    updateFn={api.updateStorageLocation}
                    deleteFn={api.deleteStorageLocation}
                    placeholder={t('settings.storageLocations.placeholder')}
                    noEntries={t('settings.storageLocations.noEntries')}
                    actionsLast={actionsLast}
                  />
                )}
              </div>
            )}
          </div>

          {/* Filament Data renders outside the card for full-width table */}
          {isFilamentData && <FilamentDataSection actionsLast={actionsLast} />}
        </>
      )}

      {/* ── Tab: Export / Import ── */}
      {mainTab === 'transfer' && <DataTransferSection />}

      {/* ── Tab: Appearance ── */}
      {mainTab === 'appearance' && (
        <div className="space-y-4">
          {/* Display */}
          <div className="card space-y-4">
            <h3 className="text-sm font-semibold text-gray-300">{t('settings.appearance.title')}</h3>
            <div className="flex items-start gap-3">
              <input
                id="actions-last"
                type="checkbox"
                className="mt-0.5 accent-blue-500"
                checked={actionsLast}
                onChange={e => toggleActionsLast(e.target.checked)}
              />
              <label htmlFor="actions-last" className="cursor-pointer">
                <p className="text-sm text-gray-200">{t('settings.appearance.actionsLast')}</p>
                <p className="text-xs text-gray-500 mt-0.5">{t('settings.appearance.actionsLastHint')}</p>
              </label>
            </div>
          </div>

          {/* Regional Settings */}
          <div className="card space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-300">{t('settings.appearance.regionalTitle')}</h3>
              <p className="text-xs text-gray-500 mt-1">{t('settings.appearance.regionalHint')}</p>
            </div>
            <div className="space-y-3">
              {/* Timezone */}
              <div>
                <label className="label text-xs mb-1 block">{t('settings.appearance.timezone')}</label>
                <input
                  className="input text-xs py-1 w-full max-w-xs"
                  value={tzInput}
                  onChange={e => setTzInput(e.target.value)}
                  placeholder={haLocale?.time_zone ?? 'UTC'}
                />
                <p className="text-[11px] text-gray-600 mt-0.5">
                  {t('settings.appearance.currentValue')}: {haLocale?.time_zone ?? 'UTC'}
                  {userPrefs?.timezone_override ? ` (${t('settings.appearance.override')})` : ` (${t('settings.appearance.fromHA')})`}
                </p>
              </div>
              {/* Currency */}
              <div>
                <label className="label text-xs mb-1 block">{t('settings.appearance.currency')}</label>
                <input
                  className="input text-xs py-1 w-24 font-mono uppercase"
                  value={curInput}
                  onChange={e => setCurInput(e.target.value.toUpperCase().slice(0, 3))}
                  placeholder={haLocale?.currency ?? 'EUR'}
                  maxLength={3}
                />
                <p className="text-[11px] text-gray-600 mt-0.5">
                  {t('settings.appearance.currentValue')}: {haLocale?.currency ?? 'EUR'}
                  {userPrefs?.currency_override ? ` (${t('settings.appearance.override')})` : ` (${t('settings.appearance.fromHA')})`}
                </p>
              </div>
              {/* Country */}
              <div>
                <label className="label text-xs mb-1 block">{t('settings.appearance.country')}</label>
                <input
                  className="input text-xs py-1 w-20 font-mono uppercase"
                  value={ctyInput}
                  onChange={e => setCtyInput(e.target.value.toUpperCase().slice(0, 2))}
                  placeholder={haLocale?.country || '—'}
                  maxLength={2}
                />
                <p className="text-[11px] text-gray-600 mt-0.5">
                  {t('settings.appearance.currentValue')}: {haLocale?.country || '—'}
                  {userPrefs?.country_override ? ` (${t('settings.appearance.override')})` : ` (${t('settings.appearance.fromHA')})`}
                </p>
              </div>
              {/* Low stock threshold */}
              <div>
                <label className="label text-xs mb-1 block">{t('settings.appearance.lowStockThreshold')}</label>
                <div className="flex items-center gap-2">
                  <input
                    className="input text-xs py-1 w-20"
                    type="number"
                    min={1}
                    max={100}
                    value={lowStockPct}
                    onChange={e => setLowStockPct(Math.max(1, Math.min(100, parseInt(e.target.value) || 20)))}
                  />
                  <span className="text-xs text-gray-400">%</span>
                </div>
                <p className="text-[11px] text-gray-600 mt-0.5">{t('settings.appearance.lowStockHint')}</p>
              </div>
              {/* Almost empty threshold */}
              <PctField label={t('settings.appearance.almostEmptyThreshold')} hint={t('settings.appearance.almostEmptyHint')}
                value={almostEmptyPct} onChange={setAlmostEmptyPct} />
              {/* Moisture thresholds */}
              <PctField label={t('settings.appearance.moistureWarning')} hint={t('settings.appearance.moistureWarningHint')}
                value={moistWarnPct} onChange={setMoistWarnPct} />
              <PctField label={t('settings.appearance.moistureCritical')} hint={t('settings.appearance.moistureCriticalHint')}
                value={moistCritPct} onChange={setMoistCritPct} />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                className="btn-primary text-xs px-3 py-1.5"
                onClick={() => savePrefs.mutate()}
                disabled={savePrefs.isPending}
              >
                {prefsSaved ? t('settings.appearance.regionalSaved') : t('settings.appearance.regionalSave')}
              </button>
              {prefsSaved && <span className="text-xs text-ok">✓</span>}
            </div>
          </div>

          <MoistureFactorsSection />
        </div>
      )}

      {/* ── Tab: Experiments ── */}
      {mainTab === 'experiments' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-300">{t('settings.bambuCloud.title')}</h3>
            </div>
            <p className="text-xs text-gray-500 mb-4">{t('settings.bambuCloud.hint')}</p>
            <BambuCloudSection />
          </div>

          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold text-gray-300">{t('settings.filamentSync.title')}</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-warn/15 border border-warn/40 text-warn">{t('common.experimental')}</span>
            </div>
            <FilamentSyncSection isCloudConnected={isCloudConnected} />
          </div>

          {isCloudConnected && cloudPrinters.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                {t('settings.bambuCloud.liveStatus')}
              </p>
              {cloudPrinters.map(p => (
                <CloudPrinterStatus key={p.id} printer={p} onEdit={() => setEditing(p)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Printer form modal */}
      {(showForm || editing) && (
        <Modal>
          <PrinterFormModal
            initial={editing ?? undefined}
            cloudStatus={cloudStatus}
            existingPrinters={printers}
            onSave={data => {
              if (editing) updateMut.mutate({ id: editing.id, data })
              else createMut.mutate(data)
            }}
            onCancel={() => { setShowForm(false); setEditing(null) }}
          />
        </Modal>
      )}
    </div>
  )
}
