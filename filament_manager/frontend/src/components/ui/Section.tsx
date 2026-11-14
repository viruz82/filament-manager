// Titled group inside a form or card. With `collapsible` the title is a toggle button
// (aria-expanded); the content stays mounted so form state is never lost.
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export default function Section({ title, hint, children, collapsible = false, defaultOpen = true }: {
  title: React.ReactNode
  /** small text right of the title (e.g. "3 filled") */
  hint?: React.ReactNode
  children: React.ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const shown = !collapsible || open

  const head = (
    <>
      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</span>
      {hint && <span className="text-xs text-gray-500 normal-case tracking-normal">{hint}</span>}
      {collapsible && (
        <ChevronDown size={14} className={`ml-auto text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      )}
    </>
  )

  return (
    <section className="rounded-xl border border-surface-3 bg-surface-3/20">
      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
        >
          {head}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-3 pt-3">{head}</div>
      )}
      <div className={shown ? `px-3 pb-3 space-y-3 ${collapsible ? '' : 'pt-2'}` : 'hidden'}>{children}</div>
    </section>
  )
}
