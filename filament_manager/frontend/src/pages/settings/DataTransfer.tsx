import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/ui/Feedback'
import { api } from '../../api'
import { CheckCircle, AlertCircle, Download, Upload } from 'lucide-react'

// ── Data Transfer ─────────────────────────────────────────────────────────────

export function DataTransferSection() {
  const toast = useToast()
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const csvSpoolsRef = useRef<HTMLInputElement>(null)
  const spoolmanJsonRef = useRef<HTMLInputElement>(null)
  const [exporting, setExporting] = useState(false)
  const [exportingSpoolsCsv, setExportingSpoolsCsv] = useState(false)
  const [exportingSpoolman, setExportingSpoolman] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<Record<string, number> | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importingSpoolsCsv, setImportingSpoolsCsv] = useState(false)
  const [importSpoolsCsvResult, setImportSpoolsCsvResult] = useState<{ created: number; updated: number; skipped: number } | null>(null)
  const [importSpoolsCsvError, setImportSpoolsCsvError] = useState<string | null>(null)
  const [importingCloud, setImportingCloud] = useState(false)
  const [cloudImportResult, setCloudImportResult] = useState<{ imported: number; skipped: number; total: number } | null>(null)
  const [cloudImportError, setCloudImportError] = useState<string | null>(null)
  const [importingSpoolman, setImportingSpoolman] = useState(false)
  const [importSpoolmanResult, setImportSpoolmanResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [importSpoolmanError, setImportSpoolmanError] = useState<string | null>(null)

  const { data: cloudStatus } = useQuery({
    queryKey: ['bambu-cloud-status'],
    queryFn: api.getBambuCloudStatus,
  })
  const cloudConnected = cloudStatus?.status === 'connected'

  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await api.exportData()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `filament_manager_export_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      toast.error('Export failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExporting(false)
    }
  }

  const handleExportSpoolsCsv = async () => {
    setExportingSpoolsCsv(true)
    try {
      const blob = await api.exportSpoolsCsv()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `spools_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      toast.error('Export failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExportingSpoolsCsv(false)
    }
  }

  const handleImportSpoolsCsv = async (e: { target: HTMLInputElement }) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportingSpoolsCsv(true)
    setImportSpoolsCsvResult(null)
    setImportSpoolsCsvError(null)
    try {
      const result = await api.importSpoolsCsv(file)
      setImportSpoolsCsvResult(result)
      qc.invalidateQueries({ queryKey: ['spools'] })
    } catch (err: unknown) {
      setImportSpoolsCsvError(err instanceof Error ? err.message : String(err))
    } finally {
      setImportingSpoolsCsv(false)
      if (csvSpoolsRef.current) csvSpoolsRef.current.value = ''
    }
  }

  const handleExportSpoolman = async () => {
    setExportingSpoolman(true)
    try {
      const blob = await api.exportSpoolman()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `spoolman_export_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      toast.error('Export failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExportingSpoolman(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    setImportError(null)
    try {
      const text = await file.text()
      const bundle = JSON.parse(text)
      const result = await api.importData(bundle)
      setImportResult(result.imported)
      qc.invalidateQueries()
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleCloudImport = async () => {
    setImportingCloud(true)
    setCloudImportResult(null)
    setCloudImportError(null)
    try {
      const result = await api.bambuCloudImportPrints()
      setCloudImportResult({ imported: result.imported, skipped: result.skipped, total: result.total })
      qc.invalidateQueries({ queryKey: ['prints'] })
      qc.invalidateQueries({ queryKey: ['prints-count'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (e: unknown) {
      setCloudImportError(e instanceof Error ? e.message : String(e))
    } finally {
      setImportingCloud(false)
    }
  }

  const handleImportSpoolmanJson = async (e: { target: HTMLInputElement }) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportingSpoolman(true)
    setImportSpoolmanResult(null)
    setImportSpoolmanError(null)
    try {
      const result = await api.importSpoolmanJson(file)
      setImportSpoolmanResult(result)
      qc.invalidateQueries({ queryKey: ['spools'] })
    } catch (err: unknown) {
      setImportSpoolmanError(err instanceof Error ? err.message : String(err))
    } finally {
      setImportingSpoolman(false)
      if (spoolmanJsonRef.current) spoolmanJsonRef.current.value = ''
    }
  }

  const [transferTab, setTransferTab] = useState<'fm' | 'spools' | 'bambu' | 'experimental'>('fm')

  const TRANSFER_TABS = [
    { id: 'fm'           as const, label: t('settings.dataTransfer.tabs.fm') },
    { id: 'spools'       as const, label: t('settings.dataTransfer.tabs.spools') },
    { id: 'bambu'        as const, label: t('settings.dataTransfer.tabs.bambu') },
    { id: 'experimental' as const, label: t('settings.dataTransfer.tabs.experimental') },
  ]

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('settings.dataTransfer.title')}</h3>

      {/* Sub-tab bar */}
      <div className="flex border-b border-surface-3 gap-0 mb-5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {TRANSFER_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setTransferTab(tab.id)}
            className={`pb-2 pt-0.5 px-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 -mb-px ${
              transferTab === tab.id
                ? 'border-accent text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Filament Manager ── */}
      {transferTab === 'fm' && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">{t('settings.dataTransfer.fmDesc')}</p>
          <div className="flex flex-wrap gap-3">
            <button onClick={handleExport} disabled={exporting} className="btn-primary flex items-center gap-2">
              <Download size={14} />
              {exporting ? t('settings.dataTransfer.exporting') : t('settings.dataTransfer.exportBtn')}
            </button>
            <label className={`btn-ghost flex items-center gap-2 cursor-pointer ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
              <Upload size={14} />
              {importing ? t('settings.dataTransfer.importing') : t('settings.dataTransfer.importBtn')}
              <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFileChange} disabled={importing} />
            </label>
          </div>
          {importResult && (
            <div className="rounded-lg bg-ok/15 border border-ok/40 p-4 text-sm text-ok">
              <div className="flex items-center gap-2 font-medium mb-2">
                <CheckCircle size={16} /> {t('settings.dataTransfer.importSuccessTitle')}
              </div>
              <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-ok">
                {Object.entries(importResult).map(([key, count]) => (
                  <li key={key} className="flex justify-between">
                    <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                    <span className="font-medium">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {importError && (
            <div className="rounded-lg bg-crit/15 border border-crit/40 p-4 text-sm text-crit flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{importError}</span>
            </div>
          )}
          <p className="text-xs text-gray-500">{t('settings.dataTransfer.importNote')}</p>
        </div>
      )}

      {/* ── Tab: Spools CSV ── */}
      {transferTab === 'spools' && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">{t('settings.dataTransfer.spoolsDesc')}</p>
          <div className="flex flex-wrap gap-3">
            <button onClick={handleExportSpoolsCsv} disabled={exportingSpoolsCsv} className="btn-primary flex items-center gap-2">
              <Download size={14} />
              {exportingSpoolsCsv ? t('settings.dataTransfer.exporting') : t('settings.dataTransfer.exportSpoolsCsvBtn')}
            </button>
            <label className={`btn-ghost flex items-center gap-2 cursor-pointer ${importingSpoolsCsv ? 'opacity-50 pointer-events-none' : ''}`}>
              <Upload size={14} />
              {importingSpoolsCsv ? t('settings.dataTransfer.importing') : t('settings.dataTransfer.importSpoolsCsvBtn')}
              <input ref={csvSpoolsRef} type="file" accept=".csv" className="hidden" onChange={handleImportSpoolsCsv} disabled={importingSpoolsCsv} />
            </label>
          </div>
          {importSpoolsCsvResult && (
            <div className="rounded-lg bg-ok/15 border border-ok/40 p-3 text-sm text-ok flex items-center justify-between">
              <span>{t('settings.dataTransfer.importSpoolsCsvResult', { created: importSpoolsCsvResult.created, updated: importSpoolsCsvResult.updated, skipped: importSpoolsCsvResult.skipped })}</span>
              <button className="ml-4 text-ok hover:text-white" onClick={() => setImportSpoolsCsvResult(null)}>✕</button>
            </div>
          )}
          {importSpoolsCsvError && (
            <div className="rounded-lg bg-crit/15 border border-crit/40 p-3 text-sm text-crit flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{importSpoolsCsvError}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Bambu Cloud ── */}
      {transferTab === 'bambu' && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">{t('settings.dataTransfer.bambuDesc')}</p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleCloudImport}
              disabled={importingCloud || !cloudConnected}
              title={!cloudConnected ? t('settings.dataTransfer.bambuNotConnected') : undefined}
              className="btn-primary flex items-center gap-2 disabled:opacity-40"
            >
              <Download size={14} />
              {importingCloud ? t('settings.dataTransfer.importingCloud') : t('settings.dataTransfer.importCloudBtn')}
            </button>
          </div>
          {!cloudConnected && (
            <p className="text-xs text-warn">{t('settings.dataTransfer.bambuNotConnected')}</p>
          )}
          {cloudImportResult && (
            <div className="rounded-lg bg-ok/15 border border-ok/40 p-3 text-sm text-ok">
              <CheckCircle size={14} className="inline mr-1.5 mb-0.5" />
              {t('settings.dataTransfer.importCloudResult', cloudImportResult)}
            </div>
          )}
          {cloudImportError && (
            <div className="rounded-lg bg-crit/15 border border-crit/40 p-3 text-sm text-crit flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{t('settings.dataTransfer.importCloudError', { error: cloudImportError })}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Experimental ── */}
      {transferTab === 'experimental' && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">{t('settings.dataTransfer.experimentalDesc')}</p>

          {/* Export for Spoolman */}
          <div className="flex flex-wrap gap-3">
            <button onClick={handleExportSpoolman} disabled={exportingSpoolman} className="btn-ghost flex items-center gap-2">
              <Download size={14} />
              {exportingSpoolman ? t('settings.dataTransfer.exporting') : t('settings.dataTransfer.exportSpoolmanBtn')}
              <span className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-warn/15 text-warn border border-warn/40">
                {t('settings.dataTransfer.experimental')}
              </span>
            </button>
          </div>
          <p className="text-xs text-gray-500">{t('settings.dataTransfer.exportSpoolmanHint')}</p>

          <hr className="border-surface-3" />

          {/* Import from Spoolman */}
          <div className="flex flex-wrap gap-3">
            <label className={`btn-ghost flex items-center gap-2 cursor-pointer ${importingSpoolman ? 'opacity-50 pointer-events-none' : ''}`}>
              <Upload size={14} />
              {importingSpoolman ? t('settings.dataTransfer.importingSpoolman') : t('settings.dataTransfer.importSpoolmanBtn')}
              <span className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-warn/15 text-warn border border-warn/40">
                {t('settings.dataTransfer.experimental')}
              </span>
              <input ref={spoolmanJsonRef} type="file" accept=".json" className="hidden" onChange={handleImportSpoolmanJson} disabled={importingSpoolman} />
            </label>
          </div>
          {importSpoolmanResult && (
            <div className="rounded-lg bg-ok/15 border border-ok/40 p-3 text-sm text-ok flex items-center justify-between">
              <span>{t('settings.dataTransfer.importSpoolmanResult', importSpoolmanResult)}</span>
              <button className="ml-4 text-ok hover:text-white" onClick={() => setImportSpoolmanResult(null)}>✕</button>
            </div>
          )}
          {importSpoolmanError && (
            <div className="rounded-lg bg-crit/15 border border-crit/40 p-3 text-sm text-crit flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{importSpoolmanError}</span>
            </div>
          )}
          <p className="text-xs text-gray-500">{t('settings.dataTransfer.importSpoolmanHint')}</p>
        </div>
      )}
    </div>
  )
}
