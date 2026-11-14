import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useToast, useConfirm } from '../components/ui/Feedback'
import Menu from '../components/ui/Menu'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import { api } from '../api'
import type { Project, ProjectDetail, PrintJob, ProjectReportOptions, ProjectReportSummary, ReportExtra } from '../types'
import { Plus, Pencil, Trash2, Ellipsis, X, FolderOpen, ChevronDown, ChevronRight, Layers, FlaskConical, ExternalLink, FileDown, Loader2 } from 'lucide-react'
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
  const toast = useToast()
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
      toast.error(t('common.pdfFailed') + ': ' + (e instanceof Error ? e.message : String(e)))
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
                <button className="btn-ghost p-1.5 text-crit shrink-0" title={t('common.delete')}
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
          {isError && <div className="text-crit text-xs">{t('projects.report.previewFailed')}</div>}
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
                    ? <span className="text-xs text-ok">✓</span>
                    : <span className="text-xs text-crit">✗</span>}
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

// Key figures of a project (all prints, or only production / test prints).
interface Totals {
  count: number
  grams: number
  cost: number
  kwh: number | null
  energyCost: number | null
  wear: number | null
  seconds?: number
}

function TotalsGrid({ x, showCount = true, testCount }: { x: Totals; showCount?: boolean; testCount?: number }) {
  const { t } = useTranslation()
  const fmtCurrency = useCurrencyFormatter()
  const hours = x.seconds && x.seconds > 0 ? fmtNum(x.seconds / 3600, 1) : null
  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 gap-x-3 gap-y-3">
      {showCount && (
        <StatTile
          label={t('projects.prints')}
          value={x.count}
          detail={testCount ? t('projects.testCount', { count: testCount }) : undefined}
        />
      )}
      <StatTile label={t('projects.weight')} value={`${fmtNum(x.grams / 1000, 2)} ${t('common.kg')}`} />
      <StatTile label={t('projects.cost')} value={fmtCurrency(x.cost)} tone={x.cost > 0 ? 'default' : 'muted'} />
      {x.kwh != null && (
        <StatTile
          label={t('prints.energy')}
          value={`${fmtNum(x.kwh, 2)} kWh`}
          detail={x.energyCost != null ? fmtCurrency(x.energyCost) : undefined}
        />
      )}
      {x.wear != null && <StatTile label={t('prints.wearCost')} value={fmtCurrency(x.wear)} />}
      {hours && <StatTile label={t('projects.duration')} value={`${hours} h`} />}
    </div>
  )
}

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
  const [expanded, setExpanded] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const { data: detail } = useQuery<ProjectDetail>({
    queryKey: ['projects', project.id],
    queryFn: () => api.getProject(project.id),
    enabled: expanded,
  })

  const all: Totals = {
    count: project.print_count,
    grams: project.total_grams,
    cost: project.total_cost,
    kwh: project.total_energy_kwh,
    energyCost: project.total_energy_cost,
    wear: project.total_wear_cost,
    seconds: project.total_duration_seconds,
  }

  const sub = (a: number | null, b: number | null) => (a != null && b != null ? a - b : a)
  const production: Totals = {
    count: project.print_count - project.test_print_count,
    grams: project.total_grams - project.test_total_grams,
    cost: project.total_cost - project.test_total_cost,
    kwh: sub(project.total_energy_kwh, project.test_total_energy_kwh),
    energyCost: sub(project.total_energy_cost, project.test_total_energy_cost),
    wear: sub(project.total_wear_cost, project.test_total_wear_cost),
  }
  const tests: Totals = {
    count: project.test_print_count,
    grams: project.test_total_grams,
    cost: project.test_total_cost,
    kwh: project.test_total_energy_kwh,
    energyCost: project.test_total_energy_cost,
    wear: project.test_total_wear_cost,
  }

  return (
    <div className="card">
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="flex items-start gap-2 flex-1 min-w-0 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded(e => !e)}
        >
          <span className="text-accent shrink-0 mt-0.5">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <FolderOpen size={15} className="text-accent shrink-0" />
              <span className="font-semibold text-white line-clamp-2 break-words">{project.name}</span>
            </span>
            {project.description && (
              <span className="block text-xs text-gray-400 mt-0.5 line-clamp-2 break-words">{project.description}</span>
            )}
          </span>
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          {project.url && (
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost !p-1.5 text-gray-400 hover:text-info"
              title={project.url}
              aria-label={project.url}
            >
              <ExternalLink size={14} />
            </a>
          )}
          <button
            className="btn-ghost !p-1.5"
            onClick={() => setReportOpen(true)}
            title={t('projects.pdfHint')}
            aria-label={t('projects.pdfHint')}
          >
            <FileDown size={15} />
          </button>
          {reportOpen && <Modal><CostReportModal project={project} onClose={() => setReportOpen(false)} /></Modal>}
          <button
            className="btn-ghost !p-1.5"
            onClick={onManagePrints}
            title={t('projects.managePrints')}
            aria-label={t('projects.managePrints')}
          >
            <Layers size={15} />
          </button>
          <Menu
            label={t('projects.actions')}
            triggerClassName="p-1.5 text-gray-400"
            trigger={<Ellipsis size={16} />}
            items={[
              { key: 'edit', label: t('common.edit'), icon: <Pencil size={14} />, onClick: onEdit },
              { key: 'delete', label: t('common.delete'), icon: <Trash2 size={14} />, onClick: onDelete, danger: true },
            ]}
          />
        </div>
      </div>

      <div className="mt-3">
        <TotalsGrid x={all} testCount={project.test_print_count} />
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-surface-3">
          {project.material_usage.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              {project.material_usage.map((m, i) => (
                <span key={i} className="pill">
                  <span className="w-2 h-2 rounded-full shrink-0 ring-1 ring-white/10" style={{ background: m.color_hex }} />
                  {m.material} <span className="text-gray-500 font-medium">{fmtNum(m.grams, 0)} {t('common.g')}</span>
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
          {project.test_print_count > 0 && project.print_count > 0 && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-surface-3 p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t('projects.normalStats')} · {production.count}
                </p>
                <TotalsGrid x={production} showCount={false} />
              </div>
              <div className="rounded-xl border border-warn/40 p-3 space-y-2">
                <p className="text-xs font-semibold text-warn uppercase tracking-wider flex items-center gap-1">
                  <FlaskConical size={11} /> {t('projects.testStats')} · {tests.count}
                </p>
                <TotalsGrid x={tests} showCount={false} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PrintJobRow({ job, projectId }: { job: PrintJob; projectId: number }) {
  const toast = useToast()
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
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to update test print flag'),
  })

  return (
    <div className="py-2 border-b border-surface-3 last:border-0">
      <div className="flex items-center gap-2 text-sm">
        <span className={job.success ? 'text-ok' : 'text-crit'}>
          {job.success ? '✓' : '✗'}
        </span>
        <span className="flex-1 min-w-0 line-clamp-2 break-words text-gray-200">{job.name}</span>
        {job.total_cost > 0 && (
          <span className="text-sm text-white shrink-0 font-medium tabular-nums">{fmtCurrency(job.total_cost)}</span>
        )}
        <button
          title={job.is_test_print ? t('projects.unmarkTestPrint') : t('projects.markTestPrint')}
          aria-label={job.is_test_print ? t('projects.unmarkTestPrint') : t('projects.markTestPrint')}
          aria-pressed={job.is_test_print}
          className={`shrink-0 p-1.5 rounded-full transition-colors ${job.is_test_print ? 'text-warn bg-warn/15' : 'text-gray-600 hover:text-warn hover:bg-surface-3'}`}
          onClick={() => toggleTestMut.mutate(!job.is_test_print)}
          disabled={toggleTestMut.isPending}
        >
          <FlaskConical size={14} />
        </button>
      </div>
      <p className="pl-6 mt-0.5 text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
        <span>{formatDateTimeTZ(job.started_at, tz)}</span>
        {job.total_grams > 0 && <span>{fmtNum(job.total_grams, 1)} {t('common.g')}</span>}
        {job.material_cost > 0 && <span>{t('prints.material')} {fmtCurrency(job.material_cost)}</span>}
        {job.energy_kwh != null && (
          <span>
            {fmtNum(job.energy_kwh, 2)} kWh
            {job.energy_cost != null && <> · {fmtCurrency(job.energy_cost)}</>}
          </span>
        )}
        {job.wear_cost != null && <span>{t('prints.wearCost')} {fmtCurrency(job.wear_cost)}</span>}
        {job.nozzle_diameter && <span className="text-info">⌀{job.nozzle_diameter}</span>}
      </p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Projects() {
  const { t } = useTranslation()
  const { confirm } = useConfirm()
  const qc = useQueryClient()

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
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
    mutationFn: (id: number) => api.deleteProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['prints'] })
      qc.invalidateQueries({ queryKey: ['prints-count'] })
    },
  })

  const askDelete = async (p: Project) => {
    if (await confirm({
      title: t('projects.deleteConfirm', { name: p.name }),
      message: t('projects.deleteNote'),
      danger: true,
    })) deleteMut.mutate(p.id)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('projects.title')}
        subtitle={t('projects.subtitle')}
        actions={
          <button className="btn-primary flex items-center gap-1.5" onClick={() => setShowForm(true)}>
            <Plus size={14} />
            <span className="hidden sm:inline">{t('projects.new')}</span>
          </button>
        }
      />

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
          onDelete={() => askDelete(p)}
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

      {managingPrints && managingDetail && (
        <AssignPrintsModal
          project={managingDetail}
          onClose={() => setManagingPrints(null)}
        />
      )}
    </div>
  )
}
