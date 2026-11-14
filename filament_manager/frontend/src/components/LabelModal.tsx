import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bluetooth, BluetoothOff, Copy, ExternalLink, FileDown, Image as ImageIcon, Loader2, Printer, QrCode, X } from 'lucide-react'
import type { Spool } from '../types'
import { api } from '../api'
import { saveBlob, fileSlug } from '../utils/download'
import { fmtNum } from '../utils/number'
import { formatDateOnly } from '../utils/time'
import { useCurrencyFormatter } from '../hooks/useHATZ'
import {
  LABEL_FIELDS, type LabelField, type LabelSettings, type LabelTexts,
  autoBaseUrl, loadLabelSettings, renderLabel, saveLabelSettings,
} from '../utils/labelRender'
import { bluetoothAvailable, connectPrinter, disconnectPrinter, printCanvases, printerState, type PrinterState } from '../utils/niimbot'

const SIZE_PRESETS: [number, number][] = [[30, 15], [40, 12], [50, 15], [30, 12]]

function spoolTitle(s: Spool) {
  return `${s.custom_id != null ? `#${s.custom_id} ` : ''}${s.brand} ${s.material}${s.subtype ? ` ${s.subtype}` : ''} · ${s.color_name}`
}

export default function LabelModal({ spools, initialIds, onClose }: {
  spools: Spool[]          // spools to choose from
  initialIds: number[]     // preselected
  onClose: () => void
}) {
  const { t } = useTranslation()
  const fmtCurrency = useCurrencyFormatter()
  const [settings, setSettings] = useState<LabelSettings>(loadLabelSettings)
  const [selected, setSelected] = useState<number[]>(initialIds)
  const [filter, setFilter] = useState('')
  const [printer, setPrinter] = useState<PrinterState>(printerState)
  const [busy, setBusy] = useState<'' | 'connect' | 'print' | 'pdf'>('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const multi = spools.length > 1
  const hasBt = bluetoothAvailable()

  const update = (patch: Partial<LabelSettings>) => {
    setSettings(prev => { const next = { ...prev, ...patch }; saveLabelSettings(next); return next })
  }
  const toggleField = (f: LabelField) => {
    const fields = settings.fields.includes(f) ? settings.fields.filter(x => x !== f) : [...settings.fields, f]
    update({ fields: LABEL_FIELDS.filter(x => fields.includes(x)) })
  }

  const tx: LabelTexts = useMemo(() => ({
    remaining: g => t('labels.remainingG', { g: fmtNum(g, 0) }),
    purchased: iso => t('labels.purchasedOn', { date: formatDateOnly(iso) }),
    pricePerKg: v => `${fmtCurrency(v)}/kg`,
  }), [t, fmtCurrency])

  const chosen = useMemo(() => spools.filter(s => selected.includes(s.id)), [spools, selected])
  const canvases = useMemo(() => {
    const out: HTMLCanvasElement[] = []
    for (const s of chosen) {
      const c = renderLabel(s, settings, tx, printer.printheadPixels)
      for (let i = 0; i < Math.max(1, settings.copies); i++) out.push(c)
    }
    return out
  }, [chosen, settings, tx, printer.printheadPixels])
  const previews = useMemo(() => chosen.slice(0, 3).map(s => renderLabel(s, settings, tx, printer.printheadPixels).toDataURL('image/png')),
    [chosen, settings, tx, printer.printheadPixels])

  useEffect(() => { setError('') }, [settings, selected])

  const density = Math.min(printer.densityMax, Math.max(printer.densityMin, settings.density))

  const connect = async () => {
    setBusy('connect'); setError('')
    try { setPrinter(await connectPrinter()) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setBusy('')
  }
  const disconnect = async () => { await disconnectPrinter(); setPrinter(printerState()) }

  const print = async () => {
    setBusy('print'); setError(''); setProgress(0)
    try {
      await printCanvases(canvases, density, setProgress)
      setPrinter(printerState())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPrinter(printerState())
    }
    setBusy('')
  }

  const name = chosen.length === 1 ? `etikett_${fileSlug(String(chosen[0].custom_id ?? chosen[0].id))}` : 'etiketten'
  const downloadPng = () => {
    chosen.forEach(s => {
      renderLabel(s, settings, tx, printer.printheadPixels).toBlob(b => {
        if (b) saveBlob(b, `etikett_${fileSlug(String(s.custom_id ?? s.id))}.png`)
      }, 'image/png')
    })
  }
  const downloadPdf = async () => {
    setBusy('pdf'); setError('')
    try {
      const blob = await api.labelsPdf({
        width_mm: settings.widthMm, height_mm: settings.heightMm,
        images: canvases.map(c => c.toDataURL('image/png')),
      })
      saveBlob(blob, `${name}.pdf`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setBusy('')
  }

  const openUrl = autoBaseUrl()
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(openUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
  }

  const shownList = spools.filter(s => !filter || spoolTitle(s).toLowerCase().includes(filter.toLowerCase()))
  const nothing = chosen.length === 0

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-2 border border-surface-3 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-3">
          <h2 className="font-semibold flex items-center gap-2"><QrCode size={16} /> {t('labels.title')}</h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Printer */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-300">{t('labels.printer')}</h3>
            {!hasBt ? (
              <div className="rounded-lg border border-amber-700/60 bg-amber-900/20 p-3 text-xs text-amber-300 space-y-2">
                <p className="flex items-start gap-1.5"><BluetoothOff size={14} className="shrink-0 mt-0.5" /> {t('labels.noBluetooth')}</p>
                <div className="flex flex-wrap gap-2">
                  <a className="btn-ghost px-2.5 py-1.5 text-xs flex items-center gap-1 text-amber-200" href={openUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={13} /> {t('labels.openInBrowser')}
                  </a>
                  <button className="btn-ghost px-2.5 py-1.5 text-xs flex items-center gap-1 text-amber-200" onClick={copyLink}>
                    <Copy size={13} /> {copied ? t('labels.copied') : t('labels.copyLink')}
                  </button>
                </div>
              </div>
            ) : printer.connected ? (
              <div className="flex items-center justify-between gap-2 text-sm flex-wrap">
                <span className="flex items-center gap-1.5 text-emerald-400">
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
                <h3 className="text-sm font-semibold text-gray-300">{t('labels.spools')} ({chosen.length})</h3>
                <div className="flex gap-1">
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setSelected(Array.from(new Set([...selected, ...shownList.map(s => s.id)])))}>{t('labels.all')}</button>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setSelected([])}>{t('labels.none')}</button>
                </div>
              </div>
              <input className="input text-sm" placeholder={t('labels.search')} value={filter} onChange={e => setFilter(e.target.value)} />
              <div className="max-h-44 overflow-y-auto rounded-lg border border-surface-3 divide-y divide-surface-3">
                {shownList.map(s => (
                  <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-surface-3">
                    <input type="checkbox" checked={selected.includes(s.id)}
                      onChange={() => setSelected(sel => sel.includes(s.id) ? sel.filter(x => x !== s.id) : [...sel, s.id])} />
                    <span className="w-3 h-3 rounded-full shrink-0 ring-1 ring-white/10" style={{ background: s.color_hex }} />
                    <span className="truncate">{spoolTitle(s)}</span>
                  </label>
                ))}
              </div>
            </section>
          ) : chosen[0] && (
            <p className="text-sm text-white flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full shrink-0 ring-1 ring-white/10" style={{ background: chosen[0].color_hex }} />
              {spoolTitle(chosen[0])}
            </p>
          )}

          {/* Fields */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-300">{t('labels.fields')}</h3>
            <div className="flex flex-wrap gap-1.5">
              {LABEL_FIELDS.map(f => (
                <button key={f}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${settings.fields.includes(f) ? 'bg-accent border-accent text-white' : 'border-surface-3 text-gray-400 hover:text-white'}`}
                  onClick={() => toggleField(f)}>
                  {t(`labels.field.${f}`)}
                </button>
              ))}
            </div>
          </section>

          {/* Size, density, copies */}
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="label">{t('labels.size')}</label>
              <div className="flex items-center gap-1.5">
                <input className="input text-sm w-16" type="number" min={10} max={100} value={settings.widthMm}
                  onChange={e => update({ widthMm: Math.max(10, Math.min(100, Number(e.target.value) || 30)) })} />
                <span className="text-gray-500">×</span>
                <input className="input text-sm w-16" type="number" min={6} max={50} value={settings.heightMm}
                  onChange={e => update({ heightMm: Math.max(6, Math.min(50, Number(e.target.value) || 15)) })} />
                <span className="text-xs text-gray-500">mm</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {SIZE_PRESETS.map(([w, h]) => (
                  <button key={`${w}x${h}`} className={`px-2 py-0.5 rounded text-[11px] border ${settings.widthMm === w && settings.heightMm === h ? 'border-accent text-white' : 'border-surface-3 text-gray-400'}`}
                    onClick={() => update({ widthMm: w, heightMm: h })}>{w}×{h}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">{t('labels.density')}</label>
              <select className="input text-sm" value={density} onChange={e => update({ density: Number(e.target.value) })}>
                {Array.from({ length: printer.densityMax - printer.densityMin + 1 }, (_, i) => printer.densityMin + i).map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('labels.copies')}</label>
              <input className="input text-sm" type="number" min={1} max={20} value={settings.copies}
                onChange={e => update({ copies: Math.max(1, Math.min(20, Math.round(Number(e.target.value) || 1))) })} />
            </div>
          </section>

          {settings.fields.includes('qr') && (
            <section>
              <label className="label">{t('labels.qrTarget')}</label>
              <input className="input text-xs" placeholder={openUrl} value={settings.baseUrl} onChange={e => update({ baseUrl: e.target.value })} />
              <p className="text-[11px] text-gray-500 mt-1">{t('labels.qrTargetHint')}</p>
            </section>
          )}

          {/* Preview */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-300">{t('labels.preview')}</h3>
            {nothing ? <p className="text-xs text-gray-500">{t('labels.nothingSelected')}</p> : (
              <div className="flex flex-wrap gap-3">
                {previews.map((src, i) => (
                  <img key={i} src={src} alt="" className="rounded border border-surface-3 bg-white"
                    style={{ imageRendering: 'pixelated', width: Math.min(settings.widthMm * 8 * 1.5, 360) }} />
                ))}
                {chosen.length > 3 && <span className="text-xs text-gray-500 self-center">+{chosen.length - 3}</span>}
              </div>
            )}
          </section>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-surface-3 flex-wrap">
          <button className="btn-ghost px-3 py-1.5 text-sm flex items-center gap-1.5" onClick={downloadPng} disabled={nothing}>
            <ImageIcon size={14} /> PNG
          </button>
          <button className="btn-ghost px-3 py-1.5 text-sm flex items-center gap-1.5" onClick={downloadPdf} disabled={nothing || busy !== ''}>
            {busy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} PDF
          </button>
          <button className="btn-primary flex items-center gap-1.5" onClick={print} disabled={nothing || !printer.connected || busy !== ''}>
            {busy === 'print' ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
            {busy === 'print' ? `${progress}/${canvases.length}` : t('labels.print', { n: canvases.length })}
          </button>
        </div>
      </div>
    </div>
  )
}
