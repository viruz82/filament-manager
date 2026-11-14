import { Component, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw } from 'lucide-react'

// Placeholder while a lazily loaded page or dialog is being fetched.
export function Spinner({ className = 'py-16' }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <div className={`flex justify-center text-gray-400 ${className}`} role="status" aria-label={t('common.loading')}>
      <Loader2 size={24} className="animate-spin" />
    </div>
  )
}

function LoadFailed() {
  const { t } = useTranslation()
  return (
    <div className="card flex flex-col items-center gap-3 py-10 text-center">
      <p className="text-sm text-gray-300">{t('common.loadFailed')}</p>
      <button className="btn-primary" onClick={() => window.location.reload()}>
        <RefreshCw size={14} /> {t('common.reload')}
      </button>
    </div>
  )
}

const RELOAD_KEY = 'fm_chunk_reload'
const isChunkError = (e: unknown) =>
  /dynamically imported module|module script failed|Importing a module script|Unable to preload/i.test(String((e as Error)?.message ?? e))

// Catches render errors of lazily loaded parts so the app does not go blank.
// Typical case: the add-on was updated while the panel stayed open, so the old
// chunk file names are gone. Then reload once to pick up the new index.html; the
// time stamp prevents a reload loop when the chunk is missing for another reason.
// Only a part the user actually opens ends up here; the idle prefetch swallows
// its own errors, so a network hiccup there never reloads the page.
// `resetKey` (e.g. the route) clears the error when the user navigates elsewhere.
export class ChunkErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    if (!isChunkError(error)) return
    let last = 0
    try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0) } catch { /* storage blocked */ }
    if (Date.now() - last < 30_000) return   // already tried once: show the message
    try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* storage blocked */ }
    window.location.reload()
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render() {
    return this.state.failed ? <LoadFailed /> : this.props.children
  }
}
