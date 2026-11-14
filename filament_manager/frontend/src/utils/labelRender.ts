/**
 * Renders a spool label (QR code + chosen text fields) onto a canvas in the
 * printer's resolution: 8 dots per mm (203 dpi), pure black on white.
 * The canvas is landscape (label length × label width); niimbluelib rotates it
 * for printers that feed sideways (D110: printDirection "left").
 */
import QRCode from 'qrcode'
import type { Spool } from '../types'

export const LABEL_FIELD_GROUPS = {
  identity: ['qr', 'number', 'location'],
  material: ['material', 'color', 'brand', 'spoolsize', 'weight'],
  trade: ['price', 'purchased', 'article'],
} as const
export type LabelGroup = keyof typeof LABEL_FIELD_GROUPS
export const LABEL_FIELDS = [
  ...LABEL_FIELD_GROUPS.identity, ...LABEL_FIELD_GROUPS.material, ...LABEL_FIELD_GROUPS.trade,
] as const
export type LabelField = typeof LABEL_FIELDS[number]
export type LabelFontSize = 'auto' | 'small' | 'medium' | 'large'
export type LabelLayout = 'single' | 'grid'
export type LabelAlign = 'left' | 'center' | 'right'
export const LABEL_ALIGNS: LabelAlign[] = ['left', 'center', 'right']

export type LabelSettings = {
  fields: LabelField[]
  showText: boolean
  fontSize: LabelFontSize
  align: LabelAlign    // position of QR code + text block along the label
  customText: string
  widthMm: number      // along the feed (label length)
  heightMm: number     // across the printhead
  density: number
  copies: number
  layout: LabelLayout  // single = label printer / one page per label, grid = A4 sheet
  baseUrl: string      // link target of the QR code; "" = automatic
  profile: string      // name of the active profile ("" = none)
}

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  fields: ['qr', 'number', 'material', 'brand', 'color'],
  showText: true,
  fontSize: 'auto',
  align: 'center',
  customText: '',
  widthMm: 30,
  heightMm: 15,
  density: 2,
  copies: 1,
  layout: 'single',
  baseUrl: '',
  profile: '',
}

/** Settings that belong to a profile (everything except the active profile name). */
export function profileSettings(s: LabelSettings): Record<string, unknown> {
  const { profile: _p, ...rest } = s
  void _p
  return rest
}

export function normalizeSettings(v: Record<string, unknown> | null | undefined, base: LabelSettings = DEFAULT_LABEL_SETTINGS): LabelSettings {
  const out = { ...base, ...(v || {}) } as LabelSettings
  out.fields = Array.isArray(out.fields)
    ? (LABEL_FIELDS as readonly string[]).filter(f => (out.fields as string[]).includes(f)) as LabelField[]
    : [...base.fields]
  if (!['auto', 'small', 'medium', 'large'].includes(out.fontSize)) out.fontSize = 'auto'
  if (!['single', 'grid'].includes(out.layout)) out.layout = 'single'
  if (!LABEL_ALIGNS.includes(out.align)) out.align = base.align
  out.customText = String(out.customText ?? '').slice(0, 100)
  return out
}

const LS_KEY = 'fm_label_settings'

export function loadLabelSettings(): LabelSettings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return normalizeSettings(JSON.parse(raw))
  } catch { /* ignore */ }
  return { ...DEFAULT_LABEL_SETTINGS }
}

export function saveLabelSettings(s: LabelSettings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch { /* private mode etc. */ }
}

/**
 * Automatic QR target: the add-on panel in Home Assistant (same origin as the
 * ingress iframe), or the page itself when opened outside HA.
 */
export function autoBaseUrl(): string {
  try {
    const top = window.top?.location
    if (top && top !== window.location && top.pathname) {
      const panel = top.pathname.split('/').filter(Boolean)[0]
      if (panel) return `${top.origin}/${panel}`
    }
  } catch { /* cross-origin parent */ }
  return window.location.origin + window.location.pathname.replace(/\/(spool-\d+)?\/?$/, '')
}

export function spoolLink(baseUrl: string, spool: Spool): string {
  const base = (baseUrl.trim() || autoBaseUrl()).replace(/\/+$/, '')
  return `${base}/spool-${spool.id}`
}

export type LabelTexts = {
  remaining: (g: number) => string
  spoolSize: (g: number) => string
  purchased: (iso: string) => string
  pricePerKg: (v: number) => string
}

export function labelLines(spool: Spool, s: Pick<LabelSettings, 'fields' | 'showText' | 'customText'>, tx: LabelTexts): { text: string; bold: boolean }[] {
  if (!s.showText) return []
  const on = (f: LabelField) => s.fields.includes(f)
  const lines: { text: string; bold: boolean }[] = []
  const head = [
    on('number') && spool.custom_id != null ? `#${spool.custom_id}` : '',
    on('material') ? [spool.material, spool.subtype].filter(Boolean).join(' ') : '',
  ].filter(Boolean).join(' ')
  if (head) lines.push({ text: head, bold: true })
  if (on('brand') && spool.brand) lines.push({ text: spool.brand, bold: false })
  if (on('color') && spool.color_name) lines.push({ text: spool.color_name, bold: false })
  if (on('spoolsize')) lines.push({ text: tx.spoolSize(spool.initial_weight_g), bold: false })
  if (on('weight')) lines.push({ text: tx.remaining(spool.current_weight_g), bold: false })
  if (on('location') && spool.storage_location) lines.push({ text: spool.storage_location, bold: false })
  if (on('purchased') && spool.purchased_at) lines.push({ text: tx.purchased(spool.purchased_at), bold: false })
  if (on('price') && spool.price_per_kg != null) lines.push({ text: tx.pricePerKg(spool.price_per_kg), bold: false })
  if (on('article') && spool.article_number) lines.push({ text: spool.article_number, bold: false })
  if (s.customText.trim()) lines.push({ text: s.customText.trim(), bold: false })
  return lines
}

const DOTS_PER_MM = 8
const FONT = 'Arial, Helvetica, sans-serif'
// Fixed font sizes in dots (8 dots = 1 mm): small ≈ 1.8 mm, medium ≈ 2.5 mm, large ≈ 3.3 mm cap
const FIXED_SIZE: Record<Exclude<LabelFontSize, 'auto'>, number> = { small: 14, medium: 20, large: 26 }

export function labelPixelSize(settings: LabelSettings, printheadPixels = 96, forPrinter = true): { w: number; h: number } {
  const w = Math.round(settings.widthMm * DOTS_PER_MM)
  const h = Math.round(settings.heightMm * DOTS_PER_MM)
  return { w, h: forPrinter ? Math.min(h, printheadPixels) : h }
}

/**
 * forPrinter: clip the height to the printhead (label printer); false = full
 * label height (PDF/browser print on a normal printer).
 */
export function renderLabel(spool: Spool, settings: LabelSettings, tx: LabelTexts, printheadPixels = 96, forPrinter = true): HTMLCanvasElement {
  const { w: W, h: H } = labelPixelSize(settings, printheadPixels, forPrinter)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#000'

  const lines = labelLines(spool, settings, tx)
  const pad = 3
  const gap = 6

  // QR code: low error correction keeps it small enough for 2–3 dot modules
  let qr: ReturnType<typeof QRCode.create> | null = null
  let mod = 0
  let qrSize = 0
  if (settings.fields.includes('qr')) {
    qr = QRCode.create(spoolLink(settings.baseUrl, spool), { errorCorrectionLevel: 'L' })
    mod = Math.max(1, Math.floor((H - 2 * pad) / qr.modules.size))
    qrSize = qr.modules.size * mod
  }

  // Text: fit every line first, so the whole block can be aligned
  const maxW = W - 2 * pad - (qr ? qrSize + gap : 0)
  const fitted: { text: string; font: string }[] = []
  let textW = 0
  let y0 = 0
  let step = 0
  if (lines.length && maxW >= 20) {
    const slot = (H - 2 * pad) / lines.length
    const fit = Math.max(10, Math.min(30, Math.floor(slot * 0.82)))
    const base = settings.fontSize === 'auto' ? fit : Math.max(10, Math.min(FIXED_SIZE[settings.fontSize], Math.floor(slot * 0.95)))
    const blockH = settings.fontSize === 'auto' ? H - 2 * pad : Math.min(H - 2 * pad, lines.length * base * 1.15)
    y0 = pad + (H - 2 * pad - blockH) / 2
    step = blockH / lines.length
    lines.forEach(ln => {
      let size = ln.bold ? base : Math.max(10, Math.floor(base * 0.9))
      const font = (sz: number) => `${ln.bold ? 'bold ' : ''}${sz}px ${FONT}`
      ctx.font = font(size)
      while (size > 10 && ctx.measureText(ln.text).width > maxW) { size--; ctx.font = font(size) }
      let text = ln.text
      if (ctx.measureText(text).width > maxW) {
        while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1)
        text += '…'
      }
      fitted.push({ text, font: font(size) })
      textW = Math.max(textW, ctx.measureText(text).width)
    })
  }

  // Alignment of the block (QR code + text) along the label
  const contentW = Math.ceil((qr ? qrSize : 0) + (qr && fitted.length ? gap : 0) + textW)
  const align = settings.align ?? 'center'
  const left = align === 'left' ? pad
    : align === 'right' ? Math.max(pad, W - pad - contentW)
    : Math.max(pad, Math.floor((W - contentW) / 2))

  if (qr) {
    const n = qr.modules.size
    const top = Math.floor((H - qrSize) / 2)
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.get(r, c)) ctx.fillRect(left + c * mod, top + r * mod, mod, mod)
      }
    }
  }
  const x0 = left + (qr ? qrSize + gap : 0)
  ctx.textBaseline = 'middle'
  fitted.forEach((ln, i) => {
    ctx.font = ln.font
    ctx.fillText(ln.text, x0, y0 + step * i + step / 2)
  })

  // Thermal printers have no grey: snap anti-aliased pixels to black/white
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) < 150 ? 0 : 255
    d[i] = d[i + 1] = d[i + 2] = v
    d[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

// ── A4 sheet (same numbers as the backend PDF) ──────────────────────────────
export const A4 = { w: 210, h: 297, margin: 8, gap: 2 }

export function gridDims(widthMm: number, heightMm: number): { cols: number; rows: number } {
  const cols = Math.floor((A4.w - 2 * A4.margin + A4.gap) / (widthMm + A4.gap))
  const rows = Math.floor((A4.h - 2 * A4.margin + A4.gap) / (heightMm + A4.gap))
  return { cols: Math.max(1, cols), rows: Math.max(1, rows) }
}

/** Opens the browser's print dialog for the given label images (hidden iframe). */
export function browserPrint(images: string[], settings: LabelSettings) {
  const { widthMm: w, heightMm: h } = settings
  const css = settings.layout === 'grid'
    ? (() => {
        const { cols } = gridDims(w, h)
        return `@page{size:A4 portrait;margin:${A4.margin}mm}
          body{margin:0}.g{display:grid;grid-template-columns:repeat(${cols},${w}mm);gap:${A4.gap}mm}
          img{width:${w}mm;height:${h}mm;outline:0.1mm solid #ccc;break-inside:avoid}`
      })()
    : `@page{size:${w}mm ${h}mm;margin:0}body{margin:0}
       img{display:block;width:${w}mm;height:${h}mm;break-after:page}`
  const body = settings.layout === 'grid'
    ? `<div class="g">${images.map(src => `<img src="${src}">`).join('')}</div>`
    : images.map(src => `<img src="${src}">`).join('')
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`)
  doc.close()
  const imgs = Array.from(doc.images)
  Promise.all(imgs.map(im => im.complete ? Promise.resolve() : new Promise(r => { im.onload = im.onerror = () => r(null) })))
    .then(() => {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
      setTimeout(() => frame.remove(), 60_000)
    })
}
