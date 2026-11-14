// Small pop-over menu ("⋯"): closes on outside click / Escape, never triggers the
// click handler of the element it sits in (tiles, rows).
import { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  key: string
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

export default function Menu({ trigger, items, label, up = false, align = 'right', triggerClassName = '' }: {
  trigger: React.ReactNode
  items: MenuItem[]
  label: string
  /** open upwards (for triggers at the bottom of a card) */
  up?: boolean
  align?: 'left' | 'right'
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className="relative" ref={ref} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen(v => !v)}
        className={`rounded-full transition-colors hover:bg-surface-3 ${open ? 'bg-surface-3' : ''} ${triggerClassName}`}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-30 ${up ? 'bottom-full mb-1' : 'top-full mt-1'} ${align === 'right' ? 'right-0' : 'left-0'}
            min-w-[170px] bg-surface-3 rounded-xl p-1 shadow-xl flex flex-col`}
        >
          {items.map(it => (
            <button
              key={it.key}
              role="menuitem"
              type="button"
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick() }}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap transition-colors
                disabled:opacity-40 hover:bg-surface-4 ${it.danger ? 'text-crit' : 'text-gray-100'}`}
            >
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
