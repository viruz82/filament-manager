import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { FeedbackProvider } from './components/ui/Feedback'
import { Spinner, ChunkErrorBoundary } from './components/ui/Loading'

// Every page is its own chunk; the start bundle only carries the shell.
const pageLoaders = {
  dashboard:   () => import('./pages/Dashboard'),
  spools:      () => import('./pages/Spools'),
  prints:      () => import('./pages/Prints'),
  projects:    () => import('./pages/Projects'),
  maintenance: () => import('./pages/Maintenance'),
  settings:    () => import('./pages/Settings'),
}
const Dashboard   = lazy(pageLoaders.dashboard)
const Spools      = lazy(pageLoaders.spools)
const Prints      = lazy(pageLoaders.prints)
const Projects    = lazy(pageLoaders.projects)
const Maintenance = lazy(pageLoaders.maintenance)
const Settings    = lazy(pageLoaders.settings)

// Once the first page is up, fetch the remaining pages while the browser is idle
// so switching tabs does not wait for the network. Label printing (niimbluelib,
// qrcode) is not prefetched; it only loads when the label dialog opens.
function usePrefetchPages() {
  useEffect(() => {
    const run = () => Object.values(pageLoaders).forEach(load => { load().catch(() => {}) })
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run)
      return () => window.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(run, 2000)
    return () => window.clearTimeout(id)
  }, [])
}

export default function App() {
  const { pathname } = useLocation()
  usePrefetchPages()
  return (
    <FeedbackProvider>
    <Layout>
      <ChunkErrorBoundary resetKey={pathname}>
      <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/spools" element={<Spools />} />
        <Route path="/prints" element={<Prints />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/maintenance" element={<Maintenance />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      </Suspense>
      </ChunkErrorBoundary>
    </Layout>
    </FeedbackProvider>
  )
}
