import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bluetooth, BluetoothOff, ChevronLeft, ChevronRight, Copy, ExternalLink, FileDown, Grid3x3, Image as ImageIcon,
  Loader2, Pencil, Plus, Printer, QrCode, RotateCcw, Save, Tag, Trash2, X,
} from 'lucide-react'
import type { Spool } from '../types'
import { api } from '../api'
import { saveBlob, fileSlug } from '../utils/download'
import { fmtNum } from '../utils/number'
import { formatDateOnly, formatDateTimeTZ } from '../utils/time'
import { useCurrencyFormatter, useHATZ } from '../hooks/useHATZ'
import {
  A4, DEFAULT_LABEL_SETTINGS, LABEL_FIELD_GROUPS, LABEL_FIELDS,
  type LabelField, type LabelFontSize, type LabelGroup, type LabelSettings, type LabelTexts,
  LABEL_ALIGNS, autoBaseUrl, browserPrint, gridDims, loadLabelSettings, normalizeSettings, profileSettings,
  renderLabel, saveLabelSettings,
} from '../utils/labelRender'
import { bluetoothAvailable, connectPrinter, disconnectPrinter, printCanvases, printerState, type PrinterState } from '../utils/niimbot'

const SIZE_PRESETS: [number, number][] = [[30, 15], [40, 12], [50, 15], [40, 30], [50, 30], [62, 30]]
const FONT_SIZES: LabelFontSize[] = ['auto', 'small', 'medium', 'large']
type Profile = { name: string; settings: Record<string, unknown> }
type LabelFilter = 'all' | 'without' | 'with'

function spoolTitle(s: Spool) {
  return `${s.custom_id != null ? `#${s.custom_id} ` : ''}${s.brand} ${s.material}${s.subtype ? ` ${s.subtype}` : ''} · ${s.color_name}`
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-surface-3'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

export default function LabelModal({ spools, initialIds, onClose }: {
  spools: Spool[]          // spools to choose from
  initialIds: number[]     // preselected
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const tz = useHATZ()
  const fmtCurrency = useCurrencyFormatter()
  const [settings, setSettings] = useState<LabelSettings>(loadLabelSettings)
  const [selected, setSelected] = useState<number[]>(initialIds)
  const [filter, setFilter] = useState('')
  const [labelFilter, setLabelFilter] = useState<LabelFilter>('all')
  const [printer, setPrinter] = useState<PrinterState>(printerState)
  const [busy, setBusy] = useState<'' | 'connect' | 'print' | 'pdf' | 'profile'>('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [profileEdit, setProfileEdit] = useState<'' | 'new' | 'rename'>('')
  const [profileName, setProfileName] = useState('')
  const [page, setPage] = useState(0)
  const multi = spools.length > 1
  const hasBt = bluetoothAvailable()

  const { data: profiles = [] } = useQuery<Profile[]>({ queryKey: ['label-profiles'], queryFn: api.getLabelProfiles })

  const update = (patch: Partial<LabelSettings>) => {
    setSettings(prev => { const next = { ...prev, ...patch }; saveLabelSettings(next); return next })
  }
  const toggleField = (f: LabelField) => {
    const fields = settings.fields.includes(f) ? settings.fields.filter(x => x !== f) : [...settings.fields, f]
    update({ fields: LABEL_FIELDS.filter(x => fields.includes(x)) })
  }
  const resetFields = () => update({
    fields: [...DEFAULT_LABEL_SETTINGS.fields], showText: true, fontSize: 'auto', customText: '',
  })

  // ── profiles (stored in the add-on, shared by all devices) ──────────────
  const saveProfiles = async (list: Profile[]) => {
    setBusy('profile'); setError('')
    try {
      const saved = await api.saveLabelProfiles(list)
      qc.setQueryData(['label-profiles'], saved)
      return true
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false }
    finally { setBusy('') }
  }
  const applyProfile = (name: string) => {
    const p = profiles.find(x => x.name === name)
    if (!p) { update({ profile: '' }); return }
    const next = normalizeSettings(p.settings, settings)
    next.profile = p.name
    setSettings(next); saveLabelSettings(next)
  }
  const createProfile = async () => {
    const name = profileName.trim()
    if (!name) return
    const list = [...profiles.filter(p => p.name.toLowerCase() !== name.toLowerCase()), { name, settings: profileSettings(settings) }]
    if (await saveProfiles(list)) { update({ profile: name }); setProfileEdit(''); setProfileName('') }
  }
  const renameProfile = async () => {
    const name = profileName.trim()
    if (!name || !settings.profile) return
    const list = profiles.map(p => p.name === settings.profile ? { ...p, name } : p)
    if (await saveProfiles(list)) { update({ profile: name }); setProfileEdit(''); setProfileName('') }
  }
  const overwriteProfile = async () => {
    if (!settings.profile) return
    await saveProfiles(profiles.map(p => p.name === settings.profile ? { ...p, settings: profileSettings(settings) } : p))
  }
  const deleteProfile = async () => {
    if (!settings.profile || !confirm(t('labels.profileDeleteConfirm', { name: settings.profile }))) return
    if (await saveProfiles(profiles.filter(p => p.name !== settings.profile))) update({ profile: '' })
  }
  const activeProfile = profiles.find(p => p.name === settings.profile)
  const profileDirty = !!activeProfile &&
    JSON.stringify(normalizeSettings(activeProfile.settings, settings)) !== JSON.stringify(settings)

  // ── rendering ────────────────────────────────────────────────────────────
  const tx: LabelTexts = useMemo(() => ({
    remaining: g => t('labels.remainingG', { g: fmtNum(g, 0) }),
    spoolSize: g => t('labels.spoolSizeG', { g: fmtNum(g, 0) }),
    purchased: iso => t('labels.purchasedOn', { date: formatDateOnly(iso) }),
    pricePerKg: v => `${fmtCurrency(v)}/kg`,
  }), [t, fmtCurrency])

  const chosen = useMemo(() => spools.filter(s => selected.includes(s.id)), [spools, selected])
  const copies = Math.max(1, settings.copies)
  const total = chosen.length * copies
  // what the label printer gets (height clipped to the printhead)
  const printerCanvases = () => chosen.flatMap(s => {
    const c = renderLabel(s, settings, tx, printer.printheadPixels, true, true)
    return Array.from({ length: copies }, () => c)
  })
  // full label for PNG / PDF / normal printer
  const fullImages = () => chosen.flatMap(s => {
    const src = renderLabel(s, settings, tx, printer.printheadPixels, false).toDataURL('image/png')
    return Array.from({ length: copies }, () => src)
  })

  const grid = settings.layout === 'grid'
  const { cols, rows } = gridDims(settings.widthMm, settings.heightMm)
  const perPage = cols * rows
  const pages = grid ? Math.max(1, Math.ceil(total / perPage)) : 1
  useEffect(() => { if (page >= pages) setPage(0) }, [page, pages])

  const previews = useMemo(() => {
    if (!grid) {
      return chosen.slice(0, 3).map(s => renderLabel(s, settings, tx, printer.printheadPixels, true).toDataURL('image/png'))
    }
    // one rendering per spool, repeated for the copies, only the current page
    const urls = new Map<number, string>()
    const out: string[] = []
    for (let i = page * perPage; i < Math.min(total, (page + 1) * perPage); i++) {
      const s = chosen[Math.floor(i / copies)]
      if (!urls.has(s.id)) urls.set(s.id, renderLabel(s, settings, tx, printer.printheadPixels, false).toDataURL('image/png'))
      out.push(urls.get(s.id)!)
    }
    return out
  }, [grid, chosen, settings, tx, printer.printheadPixels, page, perPage, total, copies])

  useEffect(() => { setError('') }, [settings, selected])

  const density = Math.min(printer.densityMax, Math.max(printer.densityMin, settings.density))
  const clipped = settings.heightMm * 8 > printer.printheadPixels

  // ── actions ──────────────────────────────────────────────────────────────
  const markPrinted = async (ids: number[], printed = true) => {
    try {
      await api.markLabelPrinted(ids, printed)
      qc.invalidateQueries({ queryKey: ['spools'] })
    } catch { /* the label itself is done; the mark is optional */ }
  }

  const connect = async () => {
    setBusy('connect'); setError('')
    try { setPrinter(await connectPrinter()) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setBusy('')
  }
  const disconnect = async () => { await disconnectPrinter(); setPrinter(printerState()) }

  const printNiimbot = async () => {
    setError(''); setProgress(0)
    // not connected yet: open the Bluetooth chooser first, then print
    if (!printerState().connected) {
      setBusy('connect')
      try { setPrinter(await connectPrinter()) } catch (e) {
        setError(e instanceof Error ? e.message : String(e)); setBusy(''); return
      }
    }
    setBusy('print')
    try {
      await printCanvases(printerCanvases(), density, setProgress)
      await markPrinted(chosen.map(s => s.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setPrinter(printerState())
    setBusy('')
  }

  const name = chosen.length === 1 ? `etikett_${fileSlug(String(chosen[0].custom_id ?? chosen[0].id))}` : 'etiketten'
  const downloadPng = () => {
    chosen.forEach(s => {
      renderLabel(s, settings, tx, printer.printheadPixels, false).toBlob(b => {
        if (b) saveBlob(b, `etikett_${fileSlug(String(s.custom_id ?? s.id))}.png`)
      }, 'image/png')
    })
    markPrinted(chosen.map(s => s.id))
  }
  const downloadPdf = async () => {
    setBusy('pdf'); setError('')
    try {
      const blob = await api.labelsPdf({
        width_mm: settings.widthMm, height_mm: settings.heightMm, images: fullImages(), layout: settings.layout,
      })
      saveBlob(blob, `${name}.pdf`)
      await markPrinted(chosen.map(s => s.id))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setBusy('')
  }
  const printBrowser = () => {
    browserPrint(fullImages(), settings)
    markPrinted(chosen.map(s => s.id))
  }

  // "open in browser": straight back into this dialog with the same spools
  const openUrl = selected.length ? `${autoBaseUrl()}?labels=${selected.join(',')}` : autoBaseUrl()
  // The Home Assistant Android app opens links to its own server inside the app;
  // only "intent:" links are handed to Android, so Chrome is started explicitly.
  const browserUrl = (() => {
    if (!/Android/i.test(navigator.userAgent)) return openUrl
    try {
      const u = new URL(openUrl)
      return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};`
        + `package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(openUrl)};end`
    } catch { return openUrl }
  })()
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(openUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
  }

  const counts = {
    all: spools.length,
    with: spools.filter(s => s.label_printed_at).length,
    without: spools.filter(s => !s.label_printed_at).length,
  }
  const shownList = spools.filter(s =>
    (labelFilter === 'all' || (labelFilter === 'with') === !!s.label_printed_at) &&
    (!filter || spoolTitle(s).toLowerCase().includes(filter.toLowerCase())))
  const nothing = chosen.length === 0
  const single = !multi ? chosen[0] : undefined

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-surface-2 border border-surface-3 rounded-2xl w-full max-w-4xl max-h-[94vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-3">
          <div className="min-w-0">
            <h2 className="font-semibold flex items-center gap-2"><QrCode size={16} /> {multi ? t('labels.titleMulti') : t('labels.title')}</h2>
            {single && (
              <p className="text-[11px] text-gray-500">
                {single.label_printed_at
                  ? t('labels.lastPrinted', { date: formatDateTimeTZ(single.label_printed_at, tz) })
                  : t('labels.neverPrinted')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {single && (
              <label className="flex items-center gap-1.5 text-xs text-gray-400" title={t('labels.hasLabelHint')}>
                <Tag size={13} className={single.label_printed_at ? 'text-ok' : ''} />
                <span className="hidden sm:inline">{t('labels.hasLabel')}</span>
                <Switch on={!!single.label_printed_at} onChange={v => markPrinted([single.id], v)} label={t('labels.hasLabel')} />
              </label>
            )}
            <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
          </div>
        </div>

        <div className="overflow-y-auto grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-5 p-5">
          {/* ── left: preview, profile, printer, spools ── */}
          <div className="space-y-4 min-w-0">
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('labels.preview')}</h3>
                <span className="text-[11px] text-gray-500">{settings.widthMm} × {settings.heightMm} mm{total > 0 ? ` · ${t('labels.count', { n: total })}` : ''}</span>
              </div>
              {nothing ? <p className="text-xs text-gray-500 py-6 text-center rounded-lg bg-surface-1">{t('labels.nothingSelected')}</p> : grid ? (
                <div className="space-y-1.5">
                  <div className="relative mx-auto bg-white rounded shadow" style={{ width: '100%', maxWidth: 260, aspectRatio: `${A4.w} / ${A4.h}` }}>
                    {previews.map((src, i) => {
                      const c = i % cols, r = Math.floor(i / cols)
                      return <img key={i} src={src} alt="" className="absolute outline outline-1 outline-gray-300"
                        style={{
                          left: `${(A4.margin + c * (settings.widthMm + A4.gap)) / A4.w * 100}%`,
                          top: `${(A4.margin + r * (settings.heightMm + A4.gap)) / A4.h * 100}%`,
                          width: `${settings.widthMm / A4.w * 100}%`, height: `${settings.heightMm / A4.h * 100}%`,
                        }} />
                    })}
                  </div>
                  <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                    <button className="btn-ghost p-1" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></button>
                    {t('labels.page', { page: page + 1, pages })} · {t('labels.perPage', { cols, rows })}
                    <button className="btn-ghost p-1" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-lg bg-surface-1 p-3">
                  {previews.map((src, i) => (
                    <img key={i} src={src} alt="" className="rounded border border-surface-3 bg-white max-w-full"
                      style={{ imageRendering: 'pixelated', width: Math.min(settings.widthMm * 8 * 1.6, 380) }} />
                  ))}
                  {chosen.length > 3 && <span className="text-xs text-gray-500">+{chosen.length - 3}</span>}
                </div>
              )}
              {!grid && clipped && (
                <p className="text-[11px] text-warn">{t('labels.clipped', { mm: Math.floor(printer.printheadPixels / 8) })}</p>
              )}
            </section>

            {/* Profile */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('labels.profile')}</h3>
              <div className="flex items-center gap-1.5 flex-wrap">
                <select className="input text-sm py-1.5 flex-1 min-w-[8rem]" value={settings.profile} onChange={e => applyProfile(e.target.value)}>
                  <option value="">{t('labels.noProfile')}</option>
                  {profiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
                <button className="btn-ghost px-2 py-1.5 text-xs flex items-center gap-1" onClick={() => { setProfileEdit('new'); setProfileName('') }}>
                  <Plus size={13} /> {t('labels.newProfile')}
                </button>
              </div>
              {settings.profile && !profileEdit && (
                <div className="flex items-center gap-1 flex-wrap text-xs">
                  {profileDirty && <span className="text-warn mr-1">{t('labels.profileChanged')}</span>}
                  <button className="btn-ghost px-2 py-1 flex items-center gap-1" disabled={busy !== ''} onClick={overwriteProfile}><Save size={12} /> {t('labels.overwriteProfile')}</button>
                  <button className="btn-ghost px-2 py-1 flex items-center gap-1" onClick={() => { setProfileEdit('rename'); setProfileName(settings.profile) }}><Pencil size={12} /> {t('labels.renameProfile')}</button>
                  <button className="btn-ghost px-2 py-1 flex items-center gap-1 text-crit" disabled={busy !== ''} onClick={deleteProfile}><Trash2 size={12} /> {t('labels.deleteProfile')}</button>
                </div>
              )}
              {profileEdit && (
                <div className="flex items-center gap-1.5">
                  <input className="input text-sm py-1.5 flex-1" autoFocus maxLength={60} placeholder={t('labels.profileName')} value={profileName}
                    onChange={e => setProfileName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { if (profileEdit === 'new') { createProfile() } else { renameProfile() } } }} />
                  <button className="btn-primary px-3 py-1.5 text-xs" disabled={!profileName.trim() || busy !== ''}
                    onClick={profileEdit === 'new' ? createProfile : renameProfile}>{t('common.save')}</button>
                  <button className="btn-ghost p-1.5" onClick={() => setProfileEdit('')}><X size={14} /></button>
                </div>
              )}
            </section>

            {/* Printer */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('labels.printer')}</h3>
              {!hasBt ? (
                <div className="rounded-lg border border-warn/40 bg-warn/15 p-3 text-xs text-warn space-y-2">
                  <p className="flex items-start gap-1.5"><BluetoothOff size={14} className="shrink-0 mt-0.5" /> {t(window.isSecureContext ? 'labels.noBluetooth' : 'labels.noBluetoothHttp')}</p>
                  <div className="flex flex-wrap gap-2">
                    <a className="btn-ghost px-2.5 py-1.5 text-xs flex items-center gap-1 text-warn" href={browserUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={13} /> {t('labels.openInBrowser')}
                    </a>
                    <button className="btn-ghost px-2.5 py-1.5 text-xs flex items-center gap-1 text-warn" onClick={copyLink}>
                      <Copy size={13} /> {copied ? t('labels.copied') : t('labels.copyLink')}
                    </button>
                  </div>
                </div>
              ) : printer.connected ? (
                <div className="flex items-center justify-between gap-2 text-sm flex-wrap">
                  <span className="flex items-center gap-1.5 text-ok">
                    <Bluetooth size={14} /> {printer.model ?? 'Niimbot'}
                    {printer.labelsLeft != null && <span className="text-gray-400 text-xs">· {t('labels.labelsLeft', { n: printer.labelsLeft })}</span>}
                  </span>
                  <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={disconnect}>{t('labels.disconnect')}</button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <button className="btn-primary flex items-center gap-1.5" onClick={connect} disabled={busy !== ''}>
                    {busy === 'connect' ? <Loader2 size={14} className="animate-spin" /> : <Bluetooth size={14} />} {t('labels.connect')}
                  </button>
                  <span className="text-xs text-gray-500">{t('labels.connectHint')}</span>
                </div>
              )}
            </section>

            {/* Spools */}
            {multi ? (
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('labels.spools')} ({chosen.length})</h3>
                  <div className="flex gap-1">
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setSelected(Array.from(new Set([...selected, ...shownList.map(s => s.id)])))}>{t('labels.addAll', { n: shownList.length })}</button>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setSelected([])}>{t('labels.none')}</button>
                  </div>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {(['all', 'without', 'with'] as LabelFilter[]).map(f => (
                    <button key={f} onClick={() => setLabelFilter(f)}
                      className={`px-2.5 py-1 rounded-full text-xs border ${labelFilter === f ? 'bg-accent border-accent text-white' : 'border-surface-3 text-gray-400 hover:text-white'}`}>
                      {t(`labels.filter.${f}`)} {counts[f]}
                    </button>
                  ))}
                </div>
                <input className="input text-sm" placeholder={t('labels.search')} value={filter} onChange={e => setFilter(e.target.value)} />
                <div className="max-h-56 overflow-y-auto rounded-lg border border-surface-3 divide-y divide-surface-3">
                  {shownList.map(s => (
                    <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-surface-3">
                      <input type="checkbox" checked={selected.includes(s.id)}
                        onChange={() => setSelected(sel => sel.includes(s.id) ? sel.filter(x => x !== s.id) : [...sel, s.id])} />
                      <span className="w-3 h-3 rounded-full shrink-0 ring-1 ring-white/10" style={{ background: s.color_hex }} />
                      <span className="truncate flex-1">{spoolTitle(s)}</span>
                      {s.label_printed_at && <Tag size={12} className="text-ok shrink-0" aria-label={t('labels.hasLabel')} />}
                    </label>
                  ))}
                  {shownList.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">{t('labels.noMatch')}</p>}
                </div>
              </section>
            ) : single && (
              <div className="rounded-lg bg-surface-1 p-3 flex items-center gap-3">
                <span className="w-8 h-8 rounded-full shrink-0 ring-1 ring-white/10" style={{ background: single.color_hex }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{single.custom_id != null && <span className="text-accent">#{single.custom_id} </span>}{single.color_name}</p>
                  <p className="text-xs text-gray-400 truncate">{single.material}{single.subtype ? ` ${single.subtype}` : ''} · {single.brand}{single.article_number ? ` · Art: ${single.article_number}` : ''}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm text-white">{fmtNum(single.current_weight_g, 0)} g</p>
                  {single.purchase_price != null && <p className="text-[11px] text-gray-500">{fmtCurrency(single.purchase_price)}</p>}
                </div>
              </div>
            )}
          </div>

          {/* ── right: size, fields, font, text, output ── */}
          <div className="space-y-4 min-w-0">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('labels.size')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {SIZE_PRESETS.map(([w, h]) => (
                  <button key={`${w}x${h}`} className={`px-2.5 py-1 rounded-full text-xs border ${settings.widthMm === w && settings.heightMm === h ? 'bg-accent border-accent text-white' : 'border-surface-3 text-gray-400 hover:text-white'}`}
                    onClick={() => update({ widthMm: w, heightMm: h })}>{w}×{h}</button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">{t('labels.custom')}</span>
                <input className="input text-sm w-16 py-1" type="number" min={10} max={100} value={settings.widthMm}
                  onChange={e => update({ widthMm: Math.max(10, Math.min(100, Number(e.target.value) || 30)) })} />
                <span className="text-gray-500">×</span>
                <input className="input text-sm w-16 py-1" type="number" min={6} max={60} value={settings.heightMm}
                  onChange={e => update({ heightMm: Math.max(6, Math.min(60, Number(e.target.value) || 15)) })} />
                <span className="text-xs text-gray-500">mm</span>
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white">{t('labels.showText')}</span>
                <Switch on={settings.showText} onChange={v => update({ showText: v })} label={t('labels.showText')} />
              </div>
              <div className="grid sm:grid-cols-2 gap-x-5 gap-y-3">
                {(Object.keys(LABEL_FIELD_GROUPS) as LabelGroup[]).map(g => {
                  const fields = LABEL_FIELD_GROUPS[g] as readonly LabelField[]
                  const onCount = fields.filter(f => settings.fields.includes(f)).length
                  return (
                    <div key={g} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-500">
                        <span>{t(`labels.group.${g}`)}</span><span>{onCount} / {fields.length}</span>
                      </div>
                      {fields.map(f => {
                        const disabled = f !== 'qr' && !settings.showText
                        return (
                          <div key={f} className={`flex items-center justify-between py-0.5 text-sm ${disabled ? 'opacity-40' : ''}`}>
                            <span className="text-gray-300">{t(`labels.field.${f}`)}</span>
                            <Switch on={settings.fields.includes(f)} onChange={() => toggleField(f)} label={t(`labels.field.${f}`)} />
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('labels.fontSize')}</h3>
              <div className="flex rounded-lg border border-surface-3 overflow-hidden w-fit">
                {FONT_SIZES.map(f => (
                  <button key={f} onClick={() => update({ fontSize: f })}
                    className={`px-3 py-1.5 text-xs ${settings.fontSize === f ? 'bg-accent text-white' : 'text-gray-400 hover:text-white hover:bg-surface-3'}`}>
                    {t(`labels.font.${f}`)}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-500">{t('labels.fontSizeHint')}</p>
            </section>

            <section className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('labels.align')}</h3>
              <div className="flex rounded-lg border border-surface-3 overflow-hidden w-fit">
                {LABEL_ALIGNS.map(a => (
                  <button key={a} onClick={() => update({ align: a })}
                    className={`px-3 py-1.5 text-xs ${settings.align === a ? 'bg-accent text-white' : 'text-gray-400 hover:text-white hover:bg-surface-3'}`}>
                    {t(`labels.alignOpt.${a}`)}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="label">{t('labels.margin')}</label>
                  <input className="input text-sm" type="number" min={0} max={5} step={0.5} value={settings.marginMm}
                    onChange={e => update({ marginMm: Math.min(5, Math.max(0, Math.round((Number(e.target.value) || 0) * 2) / 2)) })} />
                </div>
                <div>
                  <label className="label">{t('labels.offset')}</label>
                  <input className="input text-sm" type="number" min={-3} max={3} step={0.5} value={settings.offsetMm}
                    onChange={e => update({ offsetMm: Math.min(3, Math.max(-3, Math.round((Number(e.target.value) || 0) * 2) / 2)) })} />
                </div>
              </div>
              <p className="text-[11px] text-gray-500">{t('labels.offsetHint')}</p>
            </section>

            <section className="space-y-1">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('labels.customText')}</h3>
                <span className="text-[11px] text-gray-500">{settings.customText.length}/100</span>
              </div>
              <input className="input text-sm" maxLength={100} placeholder={t('labels.customTextPlaceholder')}
                value={settings.customText} onChange={e => update({ customText: e.target.value.slice(0, 100) })} disabled={!settings.showText} />
            </section>

            <button className="btn-ghost px-2 py-1 text-xs flex items-center gap-1 text-gray-400" onClick={resetFields}>
              <RotateCcw size={12} /> {t('labels.resetFields')}
            </button>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('labels.output')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {(['single', 'grid'] as const).map(l => (
                  <button key={l} onClick={() => update({ layout: l })}
                    className={`rounded-lg border px-3 py-2 text-left ${settings.layout === l ? 'border-accent bg-accent/10' : 'border-surface-3 hover:bg-surface-3'}`}>
                    <span className="flex items-center gap-1.5 text-sm text-white">{l === 'grid' ? <Grid3x3 size={14} /> : <Tag size={14} />}{t(`labels.layout.${l}`)}</span>
                    <span className="block text-[11px] text-gray-500">{l === 'grid' ? t('labels.layoutGridHint', { cols, rows }) : t('labels.layoutSingleHint')}</span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('labels.copies')}</label>
                  <input className="input text-sm" type="number" min={1} max={50} value={settings.copies}
                    onChange={e => update({ copies: Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 1))) })} />
                </div>
                <div>
                  <label className="label">{t('labels.density')}</label>
                  <select className="input text-sm" value={density} onChange={e => update({ density: Number(e.target.value) })}>
                    {Array.from({ length: printer.densityMax - printer.densityMin + 1 }, (_, i) => printer.densityMin + i).map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            {settings.fields.includes('qr') && (
              <section>
                <label className="label">{t('labels.qrTarget')}</label>
                <input className="input text-xs" placeholder={openUrl} value={settings.baseUrl} onChange={e => update({ baseUrl: e.target.value })} />
                <p className="text-[11px] text-gray-500 mt-1">{t('labels.qrTargetHint')}</p>
              </section>
            )}
          </div>
        </div>

        {error && <p className="px-5 pb-2 text-xs text-crit">{error}</p>}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-3 flex-wrap">
          <button className="btn-ghost px-3 py-1.5 text-sm flex items-center gap-1.5" onClick={downloadPng} disabled={nothing}>
            <ImageIcon size={14} /> PNG
          </button>
          <button className="btn-ghost px-3 py-1.5 text-sm flex items-center gap-1.5" onClick={downloadPdf} disabled={nothing || busy !== ''}>
            {busy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} PDF
          </button>
          <button className="btn-ghost px-3 py-1.5 text-sm flex items-center gap-1.5" onClick={printBrowser} disabled={nothing}>
            <Printer size={14} /> {t('labels.printBrowser')}
          </button>
          {hasBt && (
          <button className="btn-primary flex items-center gap-1.5" onClick={printNiimbot} disabled={nothing || busy !== ''}>
            {busy === 'print' || busy === 'connect' ? <Loader2 size={14} className="animate-spin" /> : <Bluetooth size={14} />}
            {busy === 'print' ? `${progress}/${total}` : t('labels.printNiimbot', { n: total })}
          </button>
          )}
        </div>
      </div>
    </div>
  )
}
