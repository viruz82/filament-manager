import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, Layers, Printer, Settings, FolderOpen, Wrench,
  ChevronLeft, ChevronRight, Ellipsis, X, Globe,
} from 'lucide-react'
import { api } from '../api'

function AppIcon({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
      <path d="M20 6h-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h3v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2h3a1 1 0 0 0 1-1V8a2 2 0 0 0-2-2M10 4h4v2h-4zm-2 16v-5h8v5zm10-7H6v-1h12zm0-3H6V8h12z" />
    </svg>
  )
}

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'de', label: 'DE' },
  { code: 'es', label: 'ES' },
]

function LanguageSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)

  const current = LANGUAGES.find(l => l.code === i18n.resolvedLanguage) ?? LANGUAGES[0]

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Language"
        className={`flex items-center gap-1.5 text-gray-400 hover:text-white hover:bg-surface-3 rounded-lg transition-colors
          ${collapsed ? 'justify-center px-2 py-2' : 'px-2.5 py-1.5'}`}
      >
        <Globe size={14} className="shrink-0" />
        {!collapsed && <span className="text-xs font-medium">{current.label}</span>}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-1 z-50 bg-surface-2 border border-surface-3 rounded-lg shadow-xl overflow-hidden min-w-[80px]">
            {LANGUAGES.map(lang => (
              <button
                key={lang.code}
                onClick={() => { i18n.changeLanguage(lang.code); setOpen(false) }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors
                  ${i18n.resolvedLanguage === lang.code
                    ? 'bg-accent text-white'
                    : 'text-gray-300 hover:bg-surface-3 hover:text-white'}`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ChangelogModal({ version, onClose }: { version: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ changelog: string }>({
    queryKey: ['changelog'],
    queryFn: api.getChangelog,
    staleTime: Infinity,
  })

  const sections: { heading: string; body: string }[] = data?.changelog
    ? data.changelog.split(/^## /m).filter(Boolean).map((block: string) => {
        const [heading, ...rest] = block.split('\n')
        return { heading: heading.trim(), body: rest.join('\n').trim() }
      })
    : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-2 border border-surface-3 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-3 shrink-0">
          <div>
            <p className="font-semibold text-white">Changelog</p>
            <p className="text-xs text-gray-500">v{version}</p>
          </div>
          <button className="p-1.5 text-gray-400 hover:text-white hover:bg-surface-3 rounded-lg transition-colors" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5 text-sm">
          {isLoading && <p className="text-xs text-gray-500">Loading…</p>}
          {!isLoading && sections.length === 0 && <p className="text-xs text-gray-500">No changelog available.</p>}
          {sections.map(({ heading, body }) => (
            <div key={heading}>
              <p className="font-semibold text-accent mb-2">{heading}</p>
              <ul className="space-y-1">
                {body.split('\n').filter((l: string) => l.trim().startsWith('-')).map((line: string, i: number) => (
                  <li key={i} className="text-gray-300 text-xs flex gap-2">
                    <span className="text-gray-500 shrink-0">·</span>
                    <span>{line.replace(/^-\s*(?:New:|Fix:|New\s|Fix\s)?/, '')}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function VersionButton({ collapsed }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false)
  const { data } = useQuery<{ version: string }>({
    queryKey: ['version'],
    queryFn: api.getVersion,
    staleTime: Infinity,
  })
  const version = data?.version ?? '…'

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`v${version} — view changelog`}
        className={`flex items-center gap-1.5 text-gray-500 hover:text-gray-300 hover:bg-surface-3 rounded-lg transition-colors text-xs
          ${collapsed ? 'justify-center px-2 py-2' : 'px-2.5 py-1.5'}`}
      >
        {collapsed ? <span className="font-mono text-[10px]">v</span> : <span>v{version}</span>}
      </button>
      {open && <ChangelogModal version={version} onClose={() => setOpen(false)} />}
    </>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()

  const nav = [
    { to: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard') },
    { to: '/spools',    icon: Layers,          label: t('nav.spools') },
    { to: '/prints',    icon: Printer,         label: t('nav.prints') },
    { to: '/projects',  icon: FolderOpen,      label: t('nav.projects') },
    { to: '/maintenance', icon: Wrench,        label: t('nav.maintenance') },
    { to: '/settings',  icon: Settings,        label: t('nav.settings') },
  ]
  // Phone: the first four stay in the bottom bar, the rest lives under "More".
  const mainNav = nav.slice(0, 4)
  const moreNav = nav.slice(4)
  const moreActive = moreNav.some(n => location.pathname.startsWith(n.to))

  useEffect(() => {
    setMoreOpen(false)
  }, [location.pathname])

  return (
    <div className="flex h-screen overflow-hidden bg-surface text-gray-100" style={{ height: '100dvh' }}>

      {/* ── Desktop sidebar (≥768px) ─────────────────────────────────────────── */}
      <aside
        style={{ width: collapsed ? 56 : 192 }}
        className="hidden md:flex flex-col shrink-0 bg-surface-2 transition-all duration-200"
      >
        {/* Logo */}
        <div className={`py-4 flex items-center ${collapsed ? 'justify-center px-2' : 'px-4 gap-2'}`}>
          {collapsed ? (
            <span className="text-accent" title={t('nav.appName')}>
              <AppIcon size={22} />
            </span>
          ) : (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-accent shrink-0"><AppIcon size={20} /></span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-white leading-tight truncate">{t('nav.appName')}</p>
                <p className="text-xs text-gray-500">{t('nav.appSub')}</p>
              </div>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg text-sm transition-colors
                 ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}
                 ${isActive
                   ? 'bg-accent/15 text-accent font-semibold'
                   : 'text-gray-400 hover:text-white hover:bg-surface-3'
                 }`
              }
            >
              <Icon size={16} className="shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Language switcher + version */}
        <div className={`border-t border-surface-3 px-2 py-2 flex ${collapsed ? 'flex-col items-center gap-1' : 'items-center justify-between'}`}>
          <LanguageSwitcher collapsed={collapsed} />
          <VersionButton collapsed={collapsed} />
        </div>

        {/* Collapse toggle */}
        <button
          className="flex items-center justify-center py-3 border-t border-surface-3
                     text-gray-500 hover:text-white hover:bg-surface-3 transition-colors shrink-0"
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </aside>

      {/* ── Main content area ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Phone top bar: app name (the page itself shows its title) */}
        <header className="flex items-center gap-2 px-4 py-3 bg-surface-2 shrink-0 md:hidden">
          <span className="text-accent shrink-0"><AppIcon size={18} /></span>
          <p className="text-base font-semibold text-white truncate">{t('nav.appName')}</p>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>

        {/* Phone bottom navigation (<768px) */}
        <nav
          className="md:hidden shrink-0 grid grid-cols-5 bg-surface-2 border-t border-surface-3"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          aria-label={t('nav.appName')}
        >
          {mainNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 pt-2 pb-1.5 min-w-0 text-[10.5px] transition-colors
                 ${isActive ? 'text-accent font-semibold' : 'text-gray-400'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`rounded-full px-4 py-1 transition-colors ${isActive ? 'bg-accent/15' : ''}`}>
                    <Icon size={18} />
                  </span>
                  <span className="max-w-full truncate px-1">{label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            className={`flex flex-col items-center gap-0.5 pt-2 pb-1.5 min-w-0 text-[10.5px] transition-colors
              ${moreActive ? 'text-accent font-semibold' : 'text-gray-400'}`}
          >
            <span className={`rounded-full px-4 py-1 transition-colors ${moreActive ? 'bg-accent/15' : ''}`}>
              <Ellipsis size={18} />
            </span>
            <span className="max-w-full truncate px-1">{t('nav.more')}</span>
          </button>
        </nav>
      </div>

      {/* ── Phone "More" sheet ───────────────────────────────────────────────── */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t('nav.more')}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setMoreOpen(false)} />
          <div
            className="absolute inset-x-0 bottom-0 bg-surface-2 rounded-t-2xl shadow-2xl px-3 pt-2"
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
          >
            <div className="w-9 h-1 rounded-full bg-surface-4 mx-auto mb-2" />
            <div className="flex items-center justify-between px-2 pb-1">
              <p className="text-sm font-semibold text-white">{t('nav.more')}</p>
              <button
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-surface-3 transition-colors"
                onClick={() => setMoreOpen(false)}
                aria-label={t('common.close')}
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-0.5">
              {moreNav.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl text-sm px-3 py-3 transition-colors
                     ${isActive ? 'bg-accent/15 text-accent font-semibold' : 'text-gray-300 hover:bg-surface-3'}`
                  }
                >
                  <Icon size={18} className="shrink-0" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
            <div className="border-t border-surface-3 mt-2 pt-2 px-1 flex items-center justify-between">
              <LanguageSwitcher />
              <VersionButton />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
