import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import i18n, { applyDocLang } from './i18n'

// A lazily loaded chunk can vanish when the add-on is updated while the panel is
// open (file names carry a hash). Reload once to pick up the new index.html; the
// time stamp prevents a reload loop if the chunk is missing for another reason.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'fm_chunk_reload'
  let last = 0
  try { last = Number(sessionStorage.getItem(KEY) || 0) } catch { /* storage blocked */ }
  if (Date.now() - last < 30_000) return   // already tried: let ChunkErrorBoundary show the message
  try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* storage blocked */ }
  event.preventDefault()
  window.location.reload()
})

// Deep links: label QR code ".../spool-12" (or "?spool=12") → #/spools?spool=12,
// label dialog "open in browser" "?labels=12,15" → #/spools?labels=12,15.
// Inside Home Assistant the target is the add-on panel ("/<panel>/spool-12"),
// but HA does not pass that sub-path on to the ingress iframe, so the parent
// window (same origin) is checked as well and its address is reset to the panel.
{
  const spoolFrom = (loc: Location): { id: string; path: string } | null => {
    const m = loc.pathname.match(/\/spool-(\d+)\/?$/)
    const params = new URLSearchParams(loc.search)
    const q = params.get('spool')
    const labels = params.get('labels')
    const path = m ? loc.pathname.slice(0, m.index! + 1) : loc.pathname
    if (labels && /^\d+(,\d+)*$/.test(labels)) return { id: `labels=${labels}`, path }
    const id = m ? m[1] : (q && /^\d+$/.test(q) ? q : null)
    if (!id) return null
    return { id: `spool=${id}`, path }
  }
  let hit = spoolFrom(window.location)
  if (!hit) {
    try {
      const top = window.top
      if (top && top !== window) {
        hit = spoolFrom(top.location)
        if (hit) top.history.replaceState(top.history.state, '', hit.path.replace(/\/$/, '') || '/')
      }
    } catch { /* cross-origin parent */ }
    if (hit) hit = { id: hit.id, path: window.location.pathname }
  }
  if (hit) window.history.replaceState(null, '', `${hit.path}#/spools?${hit.id}`)
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

// ── HA theme sync ─────────────────────────────────────────────────────────────
// Reads HA's CSS variables from the parent frame and:
//  1. Applies the correct dark/light class (same logic as the inline bootstrap
//     script in index.html, but runs after React so it can react to HA theme
//     changes triggered after initial load).
//  2. Optionally maps HA's accent color to --fm-accent so the app follows the
//     user's configured HA theme color.

function hexToRgb(hex: string): string | null {
  hex = hex.replace(/^#/, '')
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
  if (hex.length !== 6) return null
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `${r} ${g} ${b}`
}

function syncHATheme() {
  try {
    if (window.parent === window) return   // not inside an iframe
    const parentRoot = window.parent.document.documentElement
    const cs = window.parent.getComputedStyle(parentRoot)
    const bg = cs.getPropertyValue('--primary-background-color').trim()
    if (!bg) return

    // Determine dark/light from HA background luminance
    const hex = bg.replace(/^#/, '')
    const padded = hex.length === 3
      ? hex.split('').map(c => c + c).join('')
      : hex
    const r = parseInt(padded.slice(0, 2), 16)
    const g = parseInt(padded.slice(2, 4), 16)
    const b = parseInt(padded.slice(4, 6), 16)
    const lum = (r * 299 + g * 587 + b * 114) / 1000
    const isLight = lum >= 128

    if (isLight) {
      document.documentElement.classList.remove('dark')
    } else {
      document.documentElement.classList.add('dark')
    }

    // Mirror HA's accent / primary color into our CSS variable
    const accent = cs.getPropertyValue('--primary-color').trim()
    if (accent) {
      const rgb = hexToRgb(accent)
      if (rgb) {
        document.documentElement.style.setProperty('--fm-accent', rgb)
        // readable text on accent surfaces: white on dark accents, near-black on light ones
        const [r, g, b] = rgb.split(' ').map(Number)
        const lum = (r * 299 + g * 587 + b * 114) / 1000
        document.documentElement.style.setProperty('--fm-on-accent', lum < 150 ? '255 255 255' : '4 18 26')
      }
    }
  } catch {
    // Cross-origin or security error — leave theme as-is
  }
}

// ── HTML lang sync ───────────────────────────────────────────────────────────
// applyDocLang (exported from i18n.ts) sets document.documentElement.lang to
// "{language}-{COUNTRY}" so browsers use the correct regional format (24h time,
// number separators) independently of the UI language.
//
// The HA locale fetch in i18n.ts sets it with the real country.  Here we handle
// two edge cases:
//   1. Initial load before the async HA fetch completes — use language only.
//   2. In-app language switch — preserve the country already set by HA.

applyDocLang(i18n.resolvedLanguage ?? 'en', '')

i18n.on('languageChanged', (lng: string) => {
  // Preserve the country part that may have been set by the HA locale fetch
  const current = document.documentElement.lang
  const country = current.includes('-') ? current.split('-')[1] : ''
  applyDocLang(lng, country)
})

// ─────────────────────────────────────────────────────────────────────────────

// Run once after mount, then keep in sync with any HA theme changes.
syncHATheme()

// For standalone usage (not in HA): respect OS preference changes in real time.
const osMQ = window.matchMedia('(prefers-color-scheme: dark)')
osMQ.addEventListener('change', (e) => {
  try {
    if (window.parent !== window) return   // HA handles its own theming
  } catch { return }
  if (e.matches) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
})

// ─────────────────────────────────────────────────────────────────────────────

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
