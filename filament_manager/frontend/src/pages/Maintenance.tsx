import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, X, Wrench, Check, History, Wand2, Loader2 } from 'lucide-react'
import { api } from '../api'
import type { MaintenanceTask, MaintenanceTaskInput, MaintenanceLogEntry, PrinterConfig } from '../types'
import { useHATZ } from '../hooks/useHATZ'
import { formatDateTZ, formatDateTimeTZ, utcToLocalInput, localInputToUTC, nowInTZ } from '../utils/time'
import { fmtNum, parseDecimal } from '../utils/number'
import Modal from '../components/Modal'

const LEVEL_STYLE: Record<string, { bar: string; badge: string }> = {
  due:  { bar: 'bg-crit',     badge: 'bg-crit/15 text-crit' },
  soon: { bar: 'bg-warn',   badge: 'bg-warn/15 text-warn' },
  ok:   { bar: 'bg-ok', badge: 'bg-ok/15 text-ok' },
  off:  { bar: 'bg-gray-600',    badge: 'bg-surface-3 text-gray-400' },
  none: { bar: 'bg-gray-600',    badge: 'bg-surface-3 text-gray-400' },
}
const LEVEL_ORDER: Record<string, number> = { due: 0, soon: 1, ok: 2, none: 3, off: 4 }

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal>
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-surface-2 border border-surface-3 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-3">
            <h2 className="font-semibold">{title}</h2>
            <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
          </div>
          <div className="p-5">{children}</div>
        </div>
      </div>
    </Modal>
  )
}

// ── one limit: "12,3 / 50 h" ────────────────────────────────────────────────

function Limits({ task }: { task: MaintenanceTask }) {
  const { t } = useTranslation()
  const parts: string[] = []
  if (task.interval_hours) parts.push(`${fmtNum(task.hours_since, 1)} / ${fmtNum(task.interval_hours, 0)} ${t('maintenance.unitHours')}`)
  if (task.interval_days) parts.push(`${fmtNum(task.days_since, 0)} / ${task.interval_days} ${t('maintenance.unitDays')}`)
  if (task.interval_grams) parts.push(`${fmtNum(task.grams_since, 0)} / ${fmtNum(task.interval_grams, 0)} g`)
  if (!parts.length) return <span>{t('maintenance.noLimit')}</span>
  return <span>{parts.join(' · ')}</span>
}

function restText(task: MaintenanceTask, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (task.level === 'off') return t('maintenance.level.off')
  if (task.level === 'none') return ''
  // the limit closest to being reached decides
  const cand: { pct: number; text: string }[] = []
  if (task.interval_hours && task.hours_left != null)
    cand.push({ pct: task.hours_since / task.interval_hours, text: t(task.hours_left <= 0 ? 'maintenance.overHours' : 'maintenance.leftHours', { n: fmtNum(Math.abs(task.hours_left), 1) }) })
  if (task.interval_days && task.days_left != null)
    cand.push({ pct: task.days_since / task.interval_days, text: t(task.days_left <= 0 ? 'maintenance.overDays' : 'maintenance.leftDays', { n: fmtNum(Math.abs(task.days_left), 0) }) })
  if (task.interval_grams && task.grams_left != null)
    cand.push({ pct: task.grams_since / task.interval_grams, text: t(task.grams_left <= 0 ? 'maintenance.overGrams' : 'maintenance.leftGrams', { n: fmtNum(Math.abs(task.grams_left), 0) }) })
  cand.sort((a, b) => b.pct - a.pct)
  return cand[0]?.text ?? ''
}

// ── form ────────────────────────────────────────────────────────────────────

function TaskForm({ initial, printers, onSave, onCancel, busy }: {
  initial?: MaintenanceTask
  printers: PrinterConfig[]
  onSave: (data: MaintenanceTaskInput) => void
  onCancel: () => void
  busy: boolean
}) {
  const { t } = useTranslation()
  const tz = useHATZ()
  const num = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','))
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [printerId, setPrinterId] = useState<string>(
    initial ? (initial.printer_id != null ? String(initial.printer_id) : '') : (printers[0] ? String(printers[0].id) : ''))
  const [hours, setHours] = useState(num(initial?.interval_hours))
  const [days, setDays] = useState(num(initial?.interval_days))
  const [grams, setGrams] = useState(num(initial?.interval_grams))
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [since, setSince] = useState(initial ? utcToLocalInput(initial.last_done_at, tz) : nowInTZ(tz))

  const h = parseDecimal(hours), d = parseDecimal(days), g = parseDecimal(grams)
  const bad = (raw: string, v: number | null) => raw.trim() !== '' && (v == null || v <= 0)
  const invalid = !name.trim() || bad(hours, h) || bad(days, d) || bad(grams, g) || (d != null && !Number.isInteger(d)) || !since

  return (
    <div className="space-y-4">
      <div>
        <label className="label">{t('maintenance.name')} *</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus />
      </div>
      <div>
        <label className="label">{t('maintenance.description')}</label>
        <textarea className="input h-20 resize-none" value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      {printers.length > 0 && (
        <div>
          <label className="label">{t('maintenance.printer')}</label>
          <select className="input" value={printerId} onChange={e => setPrinterId(e.target.value)}>
            <option value="">{t('maintenance.allPrinters')}</option>
            {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <div className="label">{t('maintenance.limits')}</div>
        <p className="text-xs text-gray-500 mb-2">{t('maintenance.limitsHint')}</p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs text-gray-400">{t('maintenance.everyHours')}</label>
            <input className="input" inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-400">{t('maintenance.everyDays')}</label>
            <input className="input" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-400">{t('maintenance.everyGrams')}</label>
            <input className="input" inputMode="decimal" value={grams} onChange={e => setGrams(e.target.value)} />
          </div>
        </div>
      </div>
      <div>
        <label className="label">{t('maintenance.since')}</label>
        <input className="input" type="datetime-local" value={since} onChange={e => setSince(e.target.value)} />
        <p className="text-xs text-gray-500 mt-1">{t('maintenance.sinceHint')}</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        {t('maintenance.enabled')}
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-ghost px-4 py-2" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn-primary px-4 py-2" disabled={invalid || busy}
          onClick={() => onSave({
            name: name.trim(), description: description.trim() || null,
            printer_id: printerId ? Number(printerId) : null,
            interval_hours: h, interval_days: d, interval_grams: g, enabled,
            last_done_at: localInputToUTC(since, tz),
          })}>
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}

// ── history ─────────────────────────────────────────────────────────────────

function LogModal({ task, onClose }: { task: MaintenanceTask; onClose: () => void }) {
  const { t } = useTranslation()
  const tz = useHATZ()
  const qc = useQueryClient()
  const { data: log = [], isLoading } = useQuery<MaintenanceLogEntry[]>({
    queryKey: ['maintenance-log', task.id],
    queryFn: () => api.getMaintenanceLog(task.id),
  })
  const del = useMutation({
    mutationFn: (id: number) => api.deleteMaintenanceLog(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance-log', task.id] })
      qc.invalidateQueries({ queryKey: ['maintenance'] })
    },
  })
  return (
    <ModalShell title={`${t('maintenance.history')}: ${task.name}`} onClose={onClose}>
      {isLoading && <p className="text-sm text-gray-400">{t('common.loading')}</p>}
      {!isLoading && log.length === 0 && <p className="text-sm text-gray-400">{t('maintenance.noHistory')}</p>}
      <ul className="space-y-2">
        {log.map(e => (
          <li key={e.id} className="rounded-xl bg-surface-3/40 p-3 text-sm flex gap-2">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-white">{formatDateTimeTZ(e.done_at, tz)}</div>
              <div className="text-xs text-gray-400">
                {t('maintenance.afterValues', {
                  h: fmtNum(e.hours_since ?? 0, 1), d: fmtNum(e.days_since ?? 0, 0), g: fmtNum(e.grams_since ?? 0, 0),
                })}
              </div>
              {e.note && <div className="text-xs text-gray-300 mt-1 whitespace-pre-wrap break-words">{e.note}</div>}
            </div>
            <button className="btn-ghost p-1 self-start text-gray-500 hover:text-crit" title={t('common.delete')}
              onClick={() => del.mutate(e.id)} disabled={del.isPending}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      {log.length > 0 && <p className="text-xs text-gray-500 mt-3">{t('maintenance.deleteEntryNote')}</p>}
    </ModalShell>
  )
}

// ── card ────────────────────────────────────────────────────────────────────

function TaskCard({ task, onDone, onEdit, onDelete, onLog }: {
  task: MaintenanceTask
  onDone: () => void
  onEdit: () => void
  onDelete: () => void
  onLog: () => void
}) {
  const { t } = useTranslation()
  const tz = useHATZ()
  const style = LEVEL_STYLE[task.level] ?? LEVEL_STYLE.none
  const pct = Math.min(100, Math.max(0, task.pct ?? 0))
  const rest = restText(task, t)
  return (
    <div className={`card ${task.enabled ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-3">
        <Wrench size={16} className="text-accent shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white break-words">{task.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${style.badge}`}>{t(`maintenance.level.${task.level}`)}</span>
          </div>
          {task.description && <p className="text-xs text-gray-400 mt-0.5 break-words">{task.description}</p>}
          <div className="h-1.5 rounded-full bg-surface-3 mt-2 overflow-hidden">
            <div className={`h-full ${style.bar}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-gray-400 mt-1">
            <Limits task={task} />
            {rest && <span className={task.level === 'due' ? 'text-crit' : task.level === 'soon' ? 'text-warn' : ''}>{rest}</span>}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {t('maintenance.lastDone', { date: formatDateTZ(task.last_done_at, tz) })}
            {task.printer_name && ` · ${task.printer_name}`}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 mt-2">
        <button className="btn-ghost p-1.5 flex items-center gap-1 text-xs" onClick={onLog} title={t('maintenance.history')}>
          <History size={14} />{task.log_count > 0 && <span>{task.log_count}</span>}
        </button>
        <button className="btn-ghost p-1.5" onClick={onEdit} title={t('common.edit')}><Pencil size={14} /></button>
        <button className="btn-ghost p-1.5 hover:text-crit" onClick={onDelete} title={t('common.delete')}><Trash2 size={14} /></button>
        {task.enabled && (
          <button className="btn-primary px-3 py-1.5 text-sm flex items-center gap-1 ml-1" onClick={onDone}>
            <Check size={14} /> {t('maintenance.done')}
          </button>
        )}
      </div>
    </div>
  )
}

// ── page ────────────────────────────────────────────────────────────────────

export default function Maintenance() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<MaintenanceTask | null>(null)
  const [deleting, setDeleting] = useState<MaintenanceTask | null>(null)
  const [doneTask, setDoneTask] = useState<MaintenanceTask | null>(null)
  const [logTask, setLogTask] = useState<MaintenanceTask | null>(null)
  const [note, setNote] = useState('')
  const [templateMsg, setTemplateMsg] = useState<string | null>(null)

  const { data: tasks = [], isLoading } = useQuery<MaintenanceTask[]>({
    queryKey: ['maintenance'],
    queryFn: api.getMaintenance,
    refetchInterval: 60_000,
  })
  const { data: printers = [] } = useQuery<PrinterConfig[]>({ queryKey: ['printers'], queryFn: api.getPrinters })

  const refresh = () => qc.invalidateQueries({ queryKey: ['maintenance'] })
  const createMut = useMutation({
    mutationFn: (d: MaintenanceTaskInput) => api.createMaintenance(d),
    onSuccess: () => { refresh(); setShowForm(false) },
  })
  const updateMut = useMutation({
    mutationFn: (d: MaintenanceTaskInput) => api.updateMaintenance(editing!.id, d),
    onSuccess: () => { refresh(); setEditing(null) },
  })
  const deleteMut = useMutation({
    mutationFn: () => api.deleteMaintenance(deleting!.id),
    onSuccess: () => { refresh(); setDeleting(null) },
  })
  const doneMut = useMutation({
    mutationFn: () => api.maintenanceDone(doneTask!.id, note.trim() || null),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['maintenance-log'] }); setDoneTask(null); setNote('') },
  })
  const templateMut = useMutation({
    mutationFn: () => api.addMaintenanceTemplate(i18n.resolvedLanguage ?? i18n.language ?? 'en'),
    onSuccess: r => { refresh(); setTemplateMsg(r.created ? t('maintenance.templateAdded', { n: r.created }) : t('maintenance.templateNothing')) },
  })

  const sorted = [...tasks].sort((a, b) =>
    (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || ((b.pct ?? 0) - (a.pct ?? 0)) || (a.sort_order - b.sort_order))
  const due = tasks.filter(x => x.level === 'due').length
  const soon = tasks.filter(x => x.level === 'soon').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white">{t('maintenance.title')}</h1>
          <p className="text-sm text-gray-400">{t('maintenance.subtitle')}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button className="btn-ghost flex items-center gap-2 px-3 py-2" onClick={() => templateMut.mutate()}
            disabled={templateMut.isPending} title={t('maintenance.template')}>
            {templateMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
            <span className="hidden sm:inline">{t('maintenance.template')}</span>
          </button>
          <button className="btn-primary flex items-center gap-2 px-3 py-2" onClick={() => setShowForm(true)}>
            <Plus size={16} /><span className="hidden sm:inline">{t('maintenance.new')}</span>
          </button>
        </div>
      </div>

      {templateMsg && (
        <div className="rounded-xl bg-surface-3/40 px-3 py-2 text-sm text-gray-300 flex items-center justify-between gap-2">
          <span>{templateMsg}</span>
          <button className="btn-ghost p-1" onClick={() => setTemplateMsg(null)}><X size={14} /></button>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          <span className={`px-3 py-1 rounded-full ${due ? LEVEL_STYLE.due.badge : 'bg-surface-3 text-gray-400'}`}>{t('maintenance.countDue', { n: due })}</span>
          <span className={`px-3 py-1 rounded-full ${soon ? LEVEL_STYLE.soon.badge : 'bg-surface-3 text-gray-400'}`}>{t('maintenance.countSoon', { n: soon })}</span>
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-400">{t('common.loading')}</p>}
      {!isLoading && tasks.length === 0 && (
        <div className="card text-center py-12 px-4">
          <Wrench size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400">{t('maintenance.empty')}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button className="btn-primary px-4 py-2" onClick={() => templateMut.mutate()} disabled={templateMut.isPending}>
              {t('maintenance.templateFirst')}
            </button>
            <button className="btn-ghost px-4 py-2" onClick={() => setShowForm(true)}>{t('maintenance.new')}</button>
          </div>
          <p className="text-xs text-gray-500 mt-3">{t('maintenance.templateHint')}</p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {sorted.map(task => (
          <TaskCard key={task.id} task={task}
            onDone={() => { setNote(''); setDoneTask(task) }}
            onEdit={() => setEditing(task)}
            onDelete={() => setDeleting(task)}
            onLog={() => setLogTask(task)} />
        ))}
      </div>

      {showForm && (
        <ModalShell title={t('maintenance.newTitle')} onClose={() => setShowForm(false)}>
          <TaskForm printers={printers} busy={createMut.isPending}
            onSave={d => createMut.mutate(d)} onCancel={() => setShowForm(false)} />
        </ModalShell>
      )}
      {editing && (
        <ModalShell title={t('maintenance.editTitle')} onClose={() => setEditing(null)}>
          <TaskForm initial={editing} printers={printers} busy={updateMut.isPending}
            onSave={d => updateMut.mutate(d)} onCancel={() => setEditing(null)} />
        </ModalShell>
      )}
      {doneTask && (
        <ModalShell title={t('maintenance.doneTitle')} onClose={() => setDoneTask(null)}>
          <p className="text-sm text-gray-300 mb-3">{t('maintenance.doneConfirm', { name: doneTask.name })}</p>
          <label className="label">{t('maintenance.note')}</label>
          <textarea className="input h-20 resize-none" value={note} onChange={e => setNote(e.target.value)}
            placeholder={t('maintenance.notePlaceholder')} autoFocus />
          {doneMut.isError && <p className="text-xs text-crit mt-2">{String(doneMut.error)}</p>}
          <div className="flex justify-end gap-2 pt-4">
            <button className="btn-ghost px-4 py-2" onClick={() => setDoneTask(null)}>{t('common.cancel')}</button>
            <button className="btn-primary px-4 py-2 flex items-center gap-1" onClick={() => doneMut.mutate()} disabled={doneMut.isPending}>
              <Check size={14} /> {t('maintenance.done')}
            </button>
          </div>
        </ModalShell>
      )}
      {deleting && (
        <ModalShell title={t('maintenance.deleteTitle')} onClose={() => setDeleting(null)}>
          <p className="text-sm text-gray-300 mb-6">{t('maintenance.deleteConfirm', { name: deleting.name })}</p>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost px-4 py-2" onClick={() => setDeleting(null)}>{t('common.cancel')}</button>
            <button className="btn-danger px-4 py-2" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}>
              {t('common.delete')}
            </button>
          </div>
        </ModalShell>
      )}
      {logTask && <LogModal task={logTask} onClose={() => setLogTask(null)} />}
    </div>
  )
}
