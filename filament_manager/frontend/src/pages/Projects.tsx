import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import type { Project, ProjectDetail, PrintJob, ProjectReportOptions, ProjectReportSummary, ReportExtra } from '../types'
import { Plus, Pencil, Trash2, X, FolderOpen, ChevronDown, ChevronRight, Layers, FlaskConical, ExternalLink, FileDown, Loader2 } from 'lucide-react'
import { useHATZ, useCurrencyFormatter, useHACurrency } from '../hooks/useHATZ'
import { saveBlob, fileSlug } from '../utils/download'
import { formatDateTimeTZ } from '../utils/time'
import { fmtNum } from '../utils/number'
import Modal from '../components/Modal'

// ── Inline modal shell (matches Prints.tsx pattern) ───────────────────────────

function ModalShell({ title, onClose, wide, children }: {
  title: string
  onClose: () => void
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className={`bg-surface-2 border border-surface-3 rounded-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
        </div>
        <div className="p-5">
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Project Form ──────────────────────────────────────────────────────────────

function ProjectForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Project
  onSave: (data: { name: string; description: string | null; url: string | null }) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')

  return (
    <div className="space-y-4">
      <div>
        <label className="label">{t('projects.name')} *</label>
        <input
          className="input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('projects.namePlaceholder')}
          autoFocus
        />
      </div>
      <div>
        <label className="label">{t('projects.description')}</label>
        <textarea
          className="input h-20 resize-none"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t('projects.descriptionPlaceholder')}
        />
      </div>
      <div>
        <label className="label">{t('projects.url')}</label>
        <input
          className="input"
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder={t('projects.urlPlaceholder')}
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-ghost px-4 py-2" onClick={onCancel}>{t('common.cancel')}</button>
        <button
          className="btn-primary px-4 py-2"
          disabled={!name.trim()}
          onClick={() => onSave({ name: name.trim(), description: description.trim() || null, url: url.trim() || null })}
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}

// ── Cost report selection dialog ──────────────────────────────────────────────

const LS_REPORT_OPTS = 'fm_report_options'
const lsExtrasKey = (id: number) => `fm_report_extras_${id}`
const DEFAULT_REPORT_OPTS: Omit<ProjectReportOptions, 'extras'> = {
  material: true, energy: true, wear: true,
  include_tests: true, show_by_material: true, show_print_list: true,
}
type ExtraDraft = { name: string; amount: string }

function lsRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch { return fallback }
}
function lsWrite(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode etc. */ }
}
const parseAmount = (s: string) => {
  const n = parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function CostReportModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const fmtCurrency = useCurrencyFormatter()
  const currency = useHACurrency()
  const [opts, setOpts] = useState(() => lsRead(LS_REPORT_OPTS, DEFAULT_REPORT_OPTS))
  const [extras, setExtras] = useState<ExtraDraft[]>(() => {
    try {
      const raw = localStorage.getItem(lsExtrasKey(project.id))
      const list = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? list.map((e: ReportExtra) => ({ name: String(e.name ?? ''), amount: String(e.amount ?? '').replace('.', ',') })) : []
    } catch { return [] }
  })
  const [busy, setBusy] = useState(false)

  const validExtras: ReportExtra[] = extras
    .map(e => ({ name: e.name.trim().slice(0, 80), amount: parseAmount(e.amount) }))
    .filter((e): e is ReportExtra => e.name !== '' && e.amount !== null)
    .slice(0, 20)
  const body: ProjectReportOptions = { ...opts, extras: validExtras }

  const { data: sum, isError } = useQuery<ProjectReportSummary>({
    queryKey: ['report-summary', project.id, body],
    queryFn: () => api.projectReportSummary(project.id, body),
    placeholderData: prev => prev,
  })

  const set = (key: keyof typeof opts) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setOpts(o => ({ ...o, [key]: e.target.checked }))
  const setExtra = (i: number, patch: Partial<ExtraDraft>) =>
    setExtras(list => list.map((e, j) => (j === i ? { ...e, ...patch } : e)))

  const create = async () => {
    setBusy(true)
    lsWrite(LS_REPORT_OPTS, opts)
    lsWrite(lsExtrasKey(project.id), validExtras)
    try {
      const blob = await api.projectReportPdfWithOptions(project.id, body, i18n.resolvedLanguage ?? i18n.language ?? 'en', currency)
      saveBlob(blob, `${fileSlug(project.name)}_${new Date().toISOString().slice(0, 10)}.pdf`)
      onClose()
    } catch (e: unknown) {
      alert(t('common.pdfFailed') + ': ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  const Check = ({ k, label, hint }: { k: keyof typeof opts; label: string; hint?: string }) => (
    <label className="flex items-start gap-2 text-sm cursor-pointer py-0.5">
      <input type="checkbox" className="mt-0.5" checked={opts[k]} onChange={set(k)} />
      <span>{label}{hint && <span className="block text-xs text-gray-500">{hint}</span>}</span>
    </label>
  )
  const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className={`flex justify-between gap-3 ${strong ? 'font-semibold text-white border-t border-surface-3 pt-1 mt-1' : 'text-gray-300'}`}>
      <span className="truncate">{label}</span><span className="shrink-0 tabular-nums">{value}</span>
    </div>
  )

  return (
    <ModalShell title={t('projects.report.title', { name: project.name })} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="label">{t('projects.report.costs')}</div>
          <Check k="material" label={t('projects.report.material')} />
          <Check k="energy" label={t('projects.report.energy')} />
          <Check k="wear" label={t('projects.report.wear')} />
        </div>

        <div>
          <div className="label">{t('projects.report.extras')}</div>
          <div className="space-y-2">
            {extras.map((e, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className="input flex-1 min-w-0" value={e.name} maxLength={80}
                  placeholder={t('projects.report.extraName')} onChange={ev => setExtra(i, { name: ev.target.value })} />
                <input className="input w-24 text-right" inputMode="decimal" value={e.amount}
                  placeholder="0,00" onChange={ev => setExtra(i, { amount: ev.target.value })} />
                <button className="btn-ghost p-1.5 text-red-400 shrink-0" title={t('common.delete')}
                  aria-label={t('common.delete')} onClick={() => setExtras(list => list.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {extras.length < 20 && (
              <button className="btn-ghost px-2 py-1 text-sm flex items-center gap-1"
                onClick={() => setExtras(list => [...list, { name: '', amount: '' }])}>
                <Plus size={14} /> {t('projects.report.addExtra')}
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="label">{t('projects.report.content')}</div>
          <Check k="include_tests" label={t('projects.report.includeTests')}
            hint={project.test_print_count > 0 ? t('projects.report.testCount', { n: project.test_print_count }) : t('projects.report.noTests')} />
          <Check k="show_by_material" label={t('projects.report.byMaterial')} />
          <Check k="show_print_list" label={t('projects.report.printList')} />
        </div>

        <div className="rounded-xl bg-surface-3/40 p-3 text-sm space-y-0.5">
          <div className="label mb-1">{t('projects.report.preview')}</div>
          {isError && <div className="text-red-400 text-xs">{t('projects.report.previewFailed')}</div>}
          {sum && (
            <>
              <Row label={t('projects.prints')} value={`${sum.prints}${sum.test_prints_excluded ? ` (−${sum.test_prints_excluded} ${t('projects.testStats')})` : ''} · ${fmtNum(sum.grams, 1)} g · ${fmtNum(sum.hours, 1)} h`} />
              {sum.material !== null && <Row label={t('projects.report.material') + (sum.material_estimated ? ` (${t('projects.report.estimated')} ${fmtCurrency(sum.material_estimated)})` : '')} value={fmtCurrency(sum.material)} />}
              {sum.energy !== null && <Row label={t('projects.report.energy')} value={fmtCurrency(sum.energy)} />}
              {sum.wear !== null && <Row label={t('projects.report.wear')} value={fmtCurrency(sum.wear)} />}
              {validExtras.map((e, i) => <Row key={i} label={e.name} value={fmtCurrency(e.amount)} />)}
              <Row strong label={t('projects.report.total')} value={fmtCurrency(sum.total)} />
              {sum.per_print !== null && <Row label={t('projects.report.perPrint')} value={fmtCurrency(sum.per_print)} />}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost px-4 py-2" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn-primary px-4 py-2 flex items-center gap-2" disabled={busy} onClick={create}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            {t('projects.report.create')}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ── Assign prints modal ───────────────────────────────────────────────────────

function AssignPrintsModal({
  project,
  onClose,
}: {
  project: ProjectDetail
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const tz = useHATZ()

  const assignedIds = new Set(project.print_jobs.map(j => j.id))

  const { data: allPrints = [] } = useQuery<PrintJob[]>({
    queryKey: ['prints', 1000, 0],
    queryFn: () => api.getPrints(1000, 0),
  })

  const eligible = allPrints.filter(j => !j.fm_project_id || j.fm_project_id === project.id)

  const [selected, setSelected] = useState<Set<number>>(new Set(assignedIds))

  const assignMut = useMutation({
    mutationFn: async () => {
      const toAssign = [...selected].filter(id => !assignedIds.has(id))
      const toUnassign = [...assignedIds].filter(id => !selected.has(id))
      let latest: Project | undefined
      if (toAssign.length > 0) latest = await api.assignPrintsToProject(project.id, toAssign)
      if (toUnassign.length > 0) latest = await api.unassignPrintsFromProject(project.id, toUnassign)
      return latest
    },
    onSuccess: (latest) => {
      // Immediately patch the project in the list cache with the fresh server data
      // so the card stats update without waiting for a background refetch
      if (latest) {
        qc.setQueryData<Project[]>(['projects'], old =>
          old ? old.map(p => p.id === latest.id ? latest : p) : old
        )
      }
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['prints'] })
      onClose()
    },
  })

  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <ModalShell title={t('projects.assignPrints', { name: project.name })} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-gray-400">{t('projects.assignHint')}</p>
        <div className="max-h-96 overflow-y-auto space-y-1">
          {eligible.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">{t('common.noData')}</p>
          )}
          {eligible.map(job => (
            <label key={job.id} className="flex items-center gap-3 p-2 rounded hover:bg-surface-3 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(job.id)}
                onChange={() => toggle(job.id)}
                className="w-4 h-4 accent-accent"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white truncate">{job.name}</span>
                  {job.success
                    ? <span className="text-xs text-green-400">✓</span>
                    : <span className="text-xs text-red-400">✗</span>}
                </div>
                <div className="text-xs text-gray-400">
                  {formatDateTimeTZ(job.started_at, tz)}
                  {job.printer_name && ` · ${job.printer_name}`}
                  {job.total_grams > 0 && ` · ${fmtNum(job.total_grams, 1)}g`}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div className="flex justify-between items-center pt-2">
          <span className="text-xs text-gray-400">{selected.size} {t('projects.selected')}</span>
          <div className="flex gap-2">
            <button className="btn-ghost px-4 py-2" onClick={onClose}>{t('common.cancel')}</button>
            <button
              className="btn-primary px-4 py-2"
              onClick={() => assignMut.mutate()}
              disabled={assignMut.isPending}
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  )
}

// ── Project Card ──────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  onEdit,
  onDelete,
  onManagePrints,
}: {
  project: Project
  onEdit: () => void
  onDelete: () => void
  onManagePrints: () => void
}) {
  const { t } = useTranslation()
  const fmtCurrency = useCurrencyFormatter()
  const [expanded, setExpanded] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const { data: detail } = useQuery<ProjectDetail>({
    queryKey: ['projects', project.id],
    queryFn: () => api.getProject(project.id),
    enabled: expanded,
  })

  const durationH = project.total_duration_seconds > 0
    ? fmtNum((project.total_duration_seconds / 3600), 1)
    : null

  return (
    <div className="card">
      <div
        className="flex items-center gap-3 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-accent shrink-0">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <FolderOpen size={16} className="text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white truncate">{project.name}</span>
            <span className="text-xs text-gray-500 shrink-0">{project.print_count} {t('projects.prints')}</span>
            {project.test_print_count > 0 && (
              <span className="text-xs text-amber-500 shrink-0 flex items-center gap-0.5">
                <FlaskConical size={11} />
                {project.test_print_count}
              </span>
            )}
            {project.url && (
              <a
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-gray-500 hover:text-blue-400 shrink-0"
                title={project.url}
              >
                <ExternalLink size={11} />
              </a>
            )}
          </div>
          {project.description && (
            <p className="text-xs text-gray-400 truncate">{project.description}</p>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-4 text-xs text-gray-400 shrink-0">
          {project.total_grams > 0 && (
            <span>{fmtNum((project.total_grams / 1000), 2)} {t('common.kg')}</span>
          )}
          {project.total_cost > 0 && (
            <span>{fmtCurrency(project.total_cost)}</span>
          )}
          {project.total_energy_kwh != null && (
            <span>
              {fmtNum(project.total_energy_kwh, 2)} kWh
              {project.total_energy_cost != null && <> · {fmtCurrency(project.total_energy_cost)}</>}
            </span>
          )}
          {project.total_wear_cost != null && (
            <span>{t('prints.wearCost')} {fmtCurrency(project.total_wear_cost)}</span>
          )}
          {durationH && <span>{durationH}h</span>}
        </div>

        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            className="btn-ghost p-1.5"
            onClick={() => setReportOpen(true)}
            title={t('projects.pdfHint')}
            aria-label={t('projects.pdfHint')}
          >
            <FileDown size={14} />
          </button>
          {reportOpen && <Modal><CostReportModal project={project} onClose={() => setReportOpen(false)} /></Modal>}
          <button
            className="btn-ghost p-1.5"
            onClick={onManagePrints}
            title={t('projects.managePrints')}
          >
            <Layers size={14} />
          </button>
          <button className="btn-ghost p-1.5" onClick={onEdit} title={t('common.edit')}>
            <Pencil size={14} />
          </button>
          <button className="btn-ghost p-1.5 text-red-400" onClick={onDelete} title={t('common.delete')}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-surface-3">
          {project.material_usage.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap mb-3 pb-2 border-b border-surface-3">
              {project.material_usage.map((m, i) => (
                <span key={i} className="flex items-center gap-1 text-xs">
                  <span className="w-2 h-2 rounded-full shrink-0 ring-1 ring-white/10"
                        style={{ background: m.color_hex }} />
                  <span className="text-gray-400">{m.material}</span>
                  <span className="text-gray-500">{fmtNum(m.grams, 0)}g</span>
                </span>
              ))}
            </div>
          )}
          {!detail && (
            <p className="text-xs text-gray-500">{t('common.loading')}</p>
          )}
          {detail && detail.print_jobs.length === 0 && (
            <p className="text-xs text-gray-500">{t('projects.noPrints')}</p>
          )}
          {detail && detail.print_jobs.map(job => (
            <PrintJobRow key={job.id} job={job} projectId={project.id} />
          ))}
          {project.test_print_count > 0 && project.print_count > 0 && (() => {
            const prodEnergyKwh = project.total_energy_kwh != null && project.test_total_energy_kwh != null
              ? project.total_energy_kwh - project.test_total_energy_kwh : project.total_energy_kwh
            const prodEnergyCost = project.total_energy_cost != null && project.test_total_energy_cost != null
              ? project.total_energy_cost - project.test_total_energy_cost : project.total_energy_cost
            const prodWearCost = project.total_wear_cost != null && project.test_total_wear_cost != null
              ? project.total_wear_cost - project.test_total_wear_cost : project.total_wear_cost
            return (
              <div className="mt-2 pt-2 border-t border-surface-3 flex gap-6 text-xs flex-wrap">
                <div>
                  <span className="text-gray-500">{t('projects.normalStats')}: </span>
                  <span className="text-gray-300">
                    {project.print_count - project.test_print_count} {t('projects.prints')}
                    {' · '}{fmtNum(((project.total_grams - project.test_total_grams) / 1000), 2)} {t('common.kg')}
                    {' · '}{fmtCurrency(project.total_cost - project.test_total_cost)}
                    {prodEnergyKwh != null && <>{' · '}{fmtNum(prodEnergyKwh, 3)} kWh</>}
                    {prodEnergyCost != null && <>{' · '}{fmtCurrency(prodEnergyCost)}</>}
                    {prodWearCost != null && <>{' · '}{t('prints.wearCost')} {fmtCurrency(prodWearCost)}</>}
                  </span>
                </div>
                <div>
                  <span className="text-amber-500 flex items-center gap-1 inline-flex"><FlaskConical size={11} />{t('projects.testStats')}: </span>
                  <span className="text-gray-300">
                    {project.test_print_count} {t('projects.prints')}
                    {' · '}{fmtNum((project.test_total_grams / 1000), 2)} {t('common.kg')}
                    {' · '}{fmtCurrency(project.test_total_cost)}
                    {project.test_total_energy_kwh != null && <>{' · '}{fmtNum(project.test_total_energy_kwh, 3)} kWh</>}
                    {project.test_total_energy_cost != null && <>{' · '}{fmtCurrency(project.test_total_energy_cost)}</>}
                    {project.test_total_wear_cost != null && <>{' · '}{t('prints.wearCost')} {fmtCurrency(project.test_total_wear_cost)}</>}
                  </span>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function PrintJobRow({ job, projectId }: { job: PrintJob; projectId: number }) {
  const { t } = useTranslation()
  const tz = useHATZ()
  const fmtCurrency = useCurrencyFormatter()
  const qc = useQueryClient()

  const toggleTestMut = useMutation({
    mutationFn: (isTest: boolean) => api.updateProjectPrint(projectId, job.id, { is_test_print: isTest }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err) => alert(err instanceof Error ? err.message : 'Failed to update test print flag'),
  })

  return (
    <div className="flex items-center gap-3 py-1.5 text-sm border-b border-surface-3 last:border-0">
      <span className={job.success ? 'text-green-400' : 'text-red-400'}>
        {job.success ? '✓' : '✗'}
      </span>
      <span className="flex-1 truncate text-gray-200">{job.name}</span>
      <span className="text-xs text-gray-400 shrink-0">{formatDateTimeTZ(job.started_at, tz)}</span>
      {job.total_grams > 0 && (
        <span className="text-xs text-gray-400 shrink-0">{fmtNum(job.total_grams, 1)}g</span>
      )}
      {job.material_cost > 0 && (
        <span className="text-xs text-gray-400 shrink-0">{fmtCurrency(job.material_cost)}</span>
      )}
      {job.energy_kwh != null && (
        <span className="text-xs text-yellow-500 shrink-0">
          {fmtNum(job.energy_kwh, 2)} kWh
          {job.energy_cost != null && <> · {fmtCurrency(job.energy_cost)}</>}
        </span>
      )}
      {job.wear_cost != null && (
        <span className="text-xs text-gray-400 shrink-0">{t('prints.wearCost')} {fmtCurrency(job.wear_cost)}</span>
      )}
      {job.total_cost > 0 && (
        <span className="text-xs text-white shrink-0 font-medium">= {fmtCurrency(job.total_cost)}</span>
      )}
      {job.nozzle_diameter && (
        <span className="text-xs text-blue-400 shrink-0">⌀{job.nozzle_diameter}</span>
      )}
      <button
        title={job.is_test_print ? t('projects.unmarkTestPrint') : t('projects.markTestPrint')}
        className={`shrink-0 p-1 rounded transition-colors ${job.is_test_print ? 'text-amber-400 bg-amber-400/10' : 'text-gray-600 hover:text-amber-400'}`}
        onClick={() => toggleTestMut.mutate(!job.is_test_print)}
        disabled={toggleTestMut.isPending}
      >
        <FlaskConical size={13} />
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Projects() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const [managingPrints, setManagingPrints] = useState<Project | null>(null)

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: api.getProjects,
  })

  const { data: managingDetail } = useQuery<ProjectDetail>({
    queryKey: ['projects', managingPrints?.id],
    queryFn: () => api.getProject(managingPrints!.id),
    enabled: !!managingPrints,
  })

  const createMut = useMutation({
    mutationFn: (data: { name: string; description: string | null; url: string | null }) => api.createProject(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setShowForm(false) },
  })

  const updateMut = useMutation({
    mutationFn: (data: { name: string; description: string | null; url: string | null }) =>
      api.updateProject(editing!.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['prints'] })
      qc.invalidateQueries({ queryKey: ['prints-count'] })
      setEditing(null)
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => api.deleteProject(deleting!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['prints'] })
      qc.invalidateQueries({ queryKey: ['prints-count'] })
      setDeleting(null)
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">{t('projects.title')}</h1>
          <p className="text-sm text-gray-400">{t('projects.subtitle')}</p>
        </div>
        <button className="btn-primary flex items-center gap-2 px-3 py-2" onClick={() => setShowForm(true)}>
          <Plus size={16} />
          <span className="hidden sm:inline">{t('projects.new')}</span>
        </button>
      </div>

      {isLoading && <p className="text-sm text-gray-400">{t('common.loading')}</p>}
      {!isLoading && projects.length === 0 && (
        <div className="card text-center py-12">
          <FolderOpen size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400">{t('projects.empty')}</p>
          <button className="mt-4 btn-primary px-4 py-2" onClick={() => setShowForm(true)}>
            {t('projects.createFirst')}
          </button>
        </div>
      )}
      {projects.map(p => (
        <ProjectCard
          key={p.id}
          project={p}
          onEdit={() => setEditing(p)}
          onDelete={() => setDeleting(p)}
          onManagePrints={() => setManagingPrints(p)}
        />
      ))}

      {showForm && (
        <ModalShell title={t('projects.newTitle')} onClose={() => setShowForm(false)}>
          <ProjectForm
            onSave={data => createMut.mutate(data)}
            onCancel={() => setShowForm(false)}
          />
        </ModalShell>
      )}

      {editing && (
        <ModalShell title={t('projects.editTitle')} onClose={() => setEditing(null)}>
          <ProjectForm
            initial={editing}
            onSave={data => updateMut.mutate(data)}
            onCancel={() => setEditing(null)}
          />
        </ModalShell>
      )}

      {deleting && (
        <ModalShell title={t('projects.deleteTitle')} onClose={() => setDeleting(null)}>
          <p className="text-sm text-gray-300 mb-4">
            {t('projects.deleteConfirm', { name: deleting.name })}
          </p>
          <p className="text-xs text-gray-400 mb-6">{t('projects.deleteNote')}</p>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost px-4 py-2" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn-danger px-4 py-2"
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
            >
              {t('common.delete')}
            </button>
          </div>
        </ModalShell>
      )}

      {managingPrints && managingDetail && (
        <AssignPrintsModal
          project={managingDetail}
          onClose={() => setManagingPrints(null)}
        />
      )}
    </div>
  )
}
