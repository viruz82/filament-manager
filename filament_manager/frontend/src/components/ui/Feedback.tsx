// Shared feedback building blocks: confirmation dialog (replaces the browser's
// confirm()) and toast messages with an optional "Undo" action (replaces alert()).
//
//   const { confirm, choose } = useConfirm()
//   if (await confirm({ title, message, confirmLabel, danger: true })) …
//   const r = await choose({ …, altLabel: 'Archive' })   // 'confirm' | 'alt' | 'cancel'
//
//   const toast = useToast()
//   toast({ message: 'Archived', actionLabel: 'Undo', onAction: () => … })   // 8 s
//   toast('Saved')   /   toast.error(err.message)
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import Modal from '../Modal'

// ── Confirmation dialog ───────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string
  message?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Third button on the left (e.g. "Archive" next to "Delete"). */
  altLabel?: string
  /** Red confirm button; the safe button gets the initial focus. */
  danger?: boolean
}
export type ConfirmChoice = 'confirm' | 'alt' | 'cancel'

interface Pending extends ConfirmOptions { resolve: (c: ConfirmChoice) => void }

function ConfirmDialog({ p, onDone }: { p: Pending; onDone: (c: ConfirmChoice) => void }) {
  const { t } = useTranslation()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    (p.danger ? cancelRef : confirmRef).current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onDone('cancel') } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [p, onDone])

  return (
    <Modal>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60" onClick={() => onDone('cancel')} />
        <div role="alertdialog" aria-modal="true" aria-labelledby="fm-confirm-title"
          className="relative w-full max-w-sm bg-surface-2 rounded-2xl shadow-2xl p-5 flex flex-col gap-3">
          <h3 id="fm-confirm-title" className="text-base font-semibold text-white">{p.title}</h3>
          {p.message && <div className="text-sm text-gray-400 whitespace-pre-line break-words">{p.message}</div>}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {p.altLabel && (
              <button className="btn-ghost text-accent font-semibold mr-auto" onClick={() => onDone('alt')}>{p.altLabel}</button>
            )}
            <button ref={cancelRef} className="btn-ghost" onClick={() => onDone('cancel')}>{p.cancelLabel ?? t('common.cancel')}</button>
            <button ref={confirmRef} className={p.danger ? 'btn-danger' : 'btn-primary'} onClick={() => onDone('confirm')}>
              {p.confirmLabel ?? (p.danger ? t('common.delete') : 'OK')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── Toasts ────────────────────────────────────────────────────────────────────

export interface ToastOptions {
  message: React.ReactNode
  kind?: 'info' | 'error'
  actionLabel?: string
  onAction?: () => void
  /** Milliseconds until it disappears (default 8000). */
  duration?: number
}
interface ToastItem extends ToastOptions { id: number }

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const { t } = useTranslation()
  const [paused, setPaused] = useState(false)
  const dur = item.duration ?? 8000
  return (
    <div
      role={item.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      className="relative overflow-hidden pointer-events-auto flex items-center gap-3 rounded-xl bg-surface-4 text-gray-100 shadow-xl pl-4 pr-2 py-2.5 text-sm max-w-full"
    >
      {item.kind === 'error' && <span className="w-2 h-2 rounded-full bg-crit shrink-0" />}
      <span className="min-w-0 break-words flex-1">{item.message}</span>
      {item.actionLabel && (
        <button className="shrink-0 font-semibold text-accent px-2 py-1 rounded-lg hover:bg-surface-3"
          onClick={() => { item.onAction?.(); onClose() }}>
          {item.actionLabel}
        </button>
      )}
      <button className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-surface-3" onClick={onClose} aria-label={t('common.close')}>
        <X size={14} />
      </button>
      <span
        className={`absolute left-0 bottom-0 h-[3px] ${item.kind === 'error' ? 'bg-crit' : 'bg-accent'}`}
        style={{ animation: `fm-shrink ${dur}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' }}
        onAnimationEnd={onClose}
      />
    </div>
  )
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface Ctx {
  choose: (o: ConfirmOptions) => Promise<ConfirmChoice>
  confirm: (o: ConfirmOptions) => Promise<boolean>
  toast: ToastFn
}
export type ToastFn = ((o: ToastOptions | React.ReactNode) => void) & { error: (message: React.ReactNode) => void }
const FeedbackContext = createContext<Ctx | null>(null)

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const choose = useCallback((o: ConfirmOptions) => new Promise<ConfirmChoice>(resolve => setPending({ ...o, resolve })), [])
  const confirm = useCallback((o: ConfirmOptions) => choose(o).then(c => c === 'confirm'), [choose])
  const toast = useMemo<ToastFn>(() => {
    const add = (o: ToastOptions) => setToasts(list => [...list.slice(-2), { ...o, id: nextId.current++ }])
    const isOptions = (o: unknown): o is ToastOptions => typeof o === 'object' && o !== null && 'message' in o
    return Object.assign(
      (o: ToastOptions | React.ReactNode) => add(isOptions(o) ? o : { message: o }),
      { error: (message: React.ReactNode) => add({ message, kind: 'error' as const }) },
    )
  }, [])

  const done = useCallback((c: ConfirmChoice) => {
    setPending(p => { p?.resolve(c); return null })
  }, [])
  const close = useCallback((id: number) => setToasts(list => list.filter(x => x.id !== id)), [])

  const value = useMemo(() => ({ choose, confirm, toast }), [choose, confirm, toast])

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {pending && <ConfirmDialog p={pending} onDone={done} />}
      <Modal>
        {/* above the bottom navigation on phones */}
        <div className="fixed inset-x-0 z-[80] flex flex-col items-center gap-2 px-3 pointer-events-none
                        bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6">
          {toasts.map(item => <ToastView key={item.id} item={item} onClose={() => close(item.id)} />)}
        </div>
      </Modal>
    </FeedbackContext.Provider>
  )
}

function useFeedback(): Ctx {
  const c = useContext(FeedbackContext)
  if (!c) throw new Error('FeedbackProvider missing')
  return c
}
export function useConfirm() {
  const { confirm, choose } = useFeedback()
  return { confirm, choose }
}
export function useToast() {
  return useFeedback().toast
}
