/**
 * Renders a spool label (QR code + chosen text fields) onto a canvas in the
 * printer's resolution: 8 dots per mm (203 dpi), pure black on white.
 * The canvas is landscape (label length × label width); niimbluelib rotates it
 * for printers that feed sideways (D110: printDirection "left").
 */
import QRCode from 'qrcode'
import type { Spool } from '../types'

export const LABEL_FIELDS = ['qr', 'number', 'material', 'brand', 'color', 'weight', 'location', 'purchased', 'price', 'article'] as const
export type LabelField = typeof LABEL_FIELDS[number]

export type LabelSettings = {
  fields: LabelField[]
  widthMm: number      // along the feed (label length)
  heightMm: number     // across the printhead
  density: number
  copies: number
  baseUrl: string      // link target of the QR code; "" = automatic
}

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  fields: ['qr', 'number', 'material', 'brand', 'color'],
  widthMm: 30,
  heightMm: 15,
  density: 2,
  copies: 1,
  baseUrl: '',
}

const LS_KEY = 'fm_label_settings'

export function loadLabelSettings(): LabelSettings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const v = JSON.parse(raw)
      return {
        ...DEFAULT_LABEL_SETTINGS, ...v,
        fields: Array.isArray(v.fields) ? v.fields.filter((f: string) => (LABEL_FIELDS as readonly string[]).includes(f)) : DEFAULT_LABEL_SETTINGS.fields,
      }
    }
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

/** Spool id from a deep link path ".../spool-12", or null. */
export function spoolIdFromPath(pathname: string): number | null {
  const m = pathname.match(/\/spool-(\d+)\/?$/)
  return m ? parseInt(m[1], 10) : null
}

export type LabelTexts = {
  remaining: (g: number) => string
  purchased: (iso: string) => string
  pricePerKg: (v: number) => string
}

export function labelLines(spool: Spool, fields: LabelField[], tx: LabelTexts): { text: string; bold: boolean }[] {
  const on = (f: LabelField) => fields.includes(f)
  const lines: { text: string; bold: boolean }[] = []
  const head = [
    on('number') && spool.custom_id != null ? `#${spool.custom_id}` : '',
    on('material') ? [spool.material, spool.subtype].filter(Boolean).join(' ') : '',
  ].filter(Boolean).join(' ')
  if (head) lines.push({ text: head, bold: true })
  if (on('brand') && spool.brand) lines.push({ text: spool.brand, bold: false })
  if (on('color') && spool.color_name) lines.push({ text: spool.color_name, bold: false })
  if (on('weight')) lines.push({ text: tx.remaining(spool.current_weight_g), bold: false })
  if (on('location') && spool.storage_location) lines.push({ text: spool.storage_location, bold: false })
  if (on('purchased') && spool.purchased_at) lines.push({ text: tx.purchased(spool.purchased_at), bold: false })
  if (on('price') && spool.price_per_kg != null) lines.push({ text: tx.pricePerKg(spool.price_per_kg), bold: false })
  if (on('article') && spool.article_number) lines.push({ text: spool.article_number, bold: false })
  return lines
}

const DOTS_PER_MM = 8
const FONT = 'Arial, Helvetica, sans-serif'

export function renderLabel(spool: Spool, settings: LabelSettings, tx: LabelTexts, printheadPixels = 96): HTMLCanvasElement {
  const W = Math.round(settings.widthMm * DOTS_PER_MM)
  const H = Math.min(Math.round(settings.heightMm * DOTS_PER_MM), printheadPixels)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#000'

  const pad = 3
  let x0 = pad
  if (settings.fields.includes('qr')) {
    // Low error correction keeps the code small enough for 2–3 dot modules
    const qr = QRCode.create(spoolLink(settings.baseUrl, spool), { errorCorrectionLevel: 'L' })
    const n = qr.modules.size
    const mod = Math.max(1, Math.floor((H - 2 * pad) / n))
    const size = n * mod
    const top = Math.floor((H - size) / 2)
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.get(r, c)) ctx.fillRect(pad + c * mod, top + r * mod, mod, mod)
      }
    }
    x0 = pad + size + 6
  }

  const lines = labelLines(spool, settings.fields, tx)
  if (!lines.length) return canvas
  const maxW = W - x0 - pad
  if (maxW < 20) return canvas
  const slot = (H - 2 * pad) / lines.length
  const base = Math.max(10, Math.min(30, Math.floor(slot * 0.82)))
  ctx.textBaseline = 'middle'
  lines.forEach((ln, i) => {
    let size = ln.bold ? base : Math.max(10, Math.floor(base * 0.9))
    const font = (s: number) => `${ln.bold ? 'bold ' : ''}${s}px ${FONT}`
    ctx.font = font(size)
    while (size > 10 && ctx.measureText(ln.text).width > maxW) { size--; ctx.font = font(size) }
    let text = ln.text
    if (ctx.measureText(text).width > maxW) {
      while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1)
      text += '…'
    }
    ctx.fillText(text, x0, pad + slot * i + slot / 2)
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
