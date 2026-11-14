// Labelled key figure: small caption on top, big value, optional detail line.
export type StatTone = 'default' | 'ok' | 'warn' | 'crit' | 'info' | 'muted'

const TONE: Record<StatTone, string> = {
  default: 'text-white',
  ok: 'text-ok',
  warn: 'text-warn',
  crit: 'text-crit',
  info: 'text-info',
  muted: 'text-gray-400',
}

export default function StatTile({ label, value, detail, tone = 'default', className = '' }: {
  label: React.ReactNode
  value: React.ReactNode
  detail?: React.ReactNode
  tone?: StatTone
  className?: string
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide truncate">{label}</p>
      <p className={`text-base font-semibold tabular-nums leading-snug truncate ${TONE[tone]}`}>{value}</p>
      {detail && <p className="text-xs text-gray-500 tabular-nums truncate">{detail}</p>}
    </div>
  )
}
